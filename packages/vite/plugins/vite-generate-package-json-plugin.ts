import { serializeJson, type ExecutorContext } from '@nrwl/devkit';
import { createPackageJson } from '@nrwl/js';
import type { EmittedAsset } from 'rollup';
import { PluginOption } from 'vite';
import path = require('node:path');

type ExternalConfig = string | RegExp | ((source: string, importer: string) => boolean | void)
type IsExternal = ReturnType<typeof createIsExternal>

export type GeneratePackageJsonOptions = {
  exclude?: ExternalConfig | ExternalConfig[];
}

export default function generatePackageJson(
  options: GeneratePackageJsonOptions,
  context: ExecutorContext): PluginOption {
  const dependencies = new Set<string>();


  let isExternal: IsExternal = () => { throw new Error('isExternal not initialized') };

  return {
    name: 'rollup-plugin-generate-package-json',
    options: {
      order: "post",
      handler() {
        if (!options.exclude) {
          isExternal = () => false;
          return;
        }

        const externalConfig = Array.isArray(options.exclude) ? options.exclude : [options.exclude]
        isExternal = createIsExternal(externalConfig);
      }
    },
    resolveId: {
      order: "post",
      handler(absolutePathSource, importer) {
        const source = path.relative(context.root, absolutePathSource);

        if (isExternal(source, importer)) {
          return null
        }

        const dependencyName = getPackageName(source);
        dependencies.add(dependencyName);

        return null;
      },
    },
    // don't know if this is the correct hook or if I should use `buildEnd` instead
    
    generateBundle() {
      const helperDependencies = [...dependencies].map((dep) => `npm:${dep}`);
      const packageJson = createPackageJson(
        context.projectName,
        context.projectGraph,
        {
          target: context.targetName,
          root: context.root,
          isProduction: true,
          helperDependencies,
        }
      );

      const insertedDependencies = new Set();
      const actualDependencies: Record<string, string> = {}
      for (const [name, version] of Object.entries(packageJson.dependencies)) {
        if (!dependencies.has(name)) {
          continue;
        }
        insertedDependencies.add(name);
        actualDependencies[name] = version;
      }
      packageJson.dependencies = actualDependencies;

      if (insertedDependencies.size !== dependencies.size) {
        this.warn(`Some dependencies were not added to the package.json. This probably happened, because it is a dev/peer dependency. The following dependencies were not added: ${[...dependencies].filter((dep) => !insertedDependencies.has(dep)).join(', ')}`);
      }

      const emittedAsset: EmittedAsset = {
        type: 'asset',
        fileName: 'package.json',
        source: serializeJson(packageJson),
        name: 'Generated package json'
      }
      this.emitFile(emittedAsset);
    }
  };
}

function getPackageName(source: string) {
  const [first, second] = source.split('/');
  if (first.startsWith('@')) {
    return `${first}/${second}`;
  }
  return first;
}

function createIsExternal(patterns: ExternalConfig[]) {
  return (source: string, importer: string) => {
    // this function is inspired by @rollup/plugin-alias
    for (const pattern of patterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(source)) {
          return true;
        }
        continue;
      }

      if (pattern instanceof Function) {
        if (pattern(source, importer)) {
          return true;
        }
        continue;
      }

      if (source.length < pattern.length) {
        continue;
      }
      if (source === pattern) {
        return true;
      }
      if (source.startsWith(pattern + '/')) {
        return true
      }
    }
    return false;
  }
}

