import 'dotenv/config';
import {
  ExecutorContext,
  readJsonFile,
  workspaceRoot,
  writeJsonFile,
} from '@nx/devkit';
import { createLockFile, createPackageJson, getLockFileName } from '@nx/js';
import build from 'next/dist/build';
import { join, resolve } from 'path';
import { copySync, existsSync, mkdir, writeFileSync } from 'fs-extra';
import { lt, gte } from 'semver';
import { directoryExists } from '@nx/workspace/src/utilities/fileutils';
import { checkAndCleanWithSemver } from '@nx/devkit/src/utils/semver';

import { updatePackageJson } from './lib/update-package-json';
import { createNextConfigFile } from './lib/create-next-config-file';
import { checkPublicDirectory } from './lib/check-project';
import { NextBuildBuilderOptions } from '../../utils/types';

export default async function buildExecutor(
  options: NextBuildBuilderOptions,
  context: ExecutorContext
) {
  // Cast to any to overwrite NODE_ENV
  (process.env as any).NODE_ENV ||= 'production';

  const root = resolve(context.root, options.root);

  checkPublicDirectory(root);

  // Set `__NEXT_REACT_ROOT` based on installed ReactDOM version
  const packageJsonPath = join(root, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? readJsonFile(packageJsonPath)
    : undefined;
  const rootPackageJson = readJsonFile(join(workspaceRoot, 'package.json'));
  const reactDomVersion =
    packageJson?.dependencies?.['react-dom'] ??
    rootPackageJson.dependencies?.['react-dom'];
  const hasReact18 =
    reactDomVersion &&
    gte(checkAndCleanWithSemver('react-dom', reactDomVersion), '18.0.0');
  if (hasReact18) {
    (process.env as any).__NEXT_REACT_ROOT ||= 'true';
  }

  // Get the installed Next.js version (will be removed after Nx 16 and Next.js update)
  const nextVersion = require('next/package.json').version;

  const debug = !!process.env.NX_VERBOSE_LOGGING || options.debug;

  // Check the major and minor version numbers
  if (lt(nextVersion, '13.2.0')) {
    // If the version is lower than 13.2.0, use the second parameter as the config object
    await build(root, null, false, debug);
  } else {
    // Otherwise, use the third parameter as a boolean flag for verbose logging
    // @ts-ignore
    await build(root, false, debug);
  }

  if (!directoryExists(options.outputPath)) {
    mkdir(options.outputPath);
  }

  const builtPackageJson = createPackageJson(
    context.projectName,
    context.projectGraph,
    {
      target: context.targetName,
      root: context.root,
      isProduction: !options.includeDevDependenciesInPackageJson, // By default we remove devDependencies since this is a production build.
    }
  );
  updatePackageJson(builtPackageJson, context);
  writeJsonFile(`${options.outputPath}/package.json`, builtPackageJson);

  if (options.generateLockfile) {
    const lockFile = createLockFile(builtPackageJson);
    writeFileSync(`${options.outputPath}/${getLockFileName()}`, lockFile, {
      encoding: 'utf-8',
    });
  }

  createNextConfigFile(options, context);

  copySync(join(root, 'public'), join(options.outputPath, 'public'), {
    dereference: true,
  });

  return { success: true };
}
