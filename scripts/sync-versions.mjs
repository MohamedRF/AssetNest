#!/usr/bin/env node
/**
 * Synchronize the AssetNest version across the monorepo.
 *
 *   node scripts/sync-versions.mjs 1.2.3
 *   node scripts/sync-versions.mjs --version=1.2.3
 *
 * Updates:
 *   - root package.json and every apps/* + packages/* package.json
 *   - apps/api/src/bootstrap.ts        (.setVersion("..."))
 *   - apps/api/src/version/version.controller.ts
 *   - apps/api/src/app.module.ts       (MCP server version)
 *
 * It does not run pnpm; run `pnpm install` afterwards so the lockfile and
 * editor state settle. Use `pnpm release:check` to verify consistency.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readJson(path) {
  return readFile(path, 'utf8').then((text) => JSON.parse(text));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function replaceInFile(path, pattern, replacement, label) {
  const text = await readFile(path, 'utf8');
  if (!pattern.test(text)) {
    throw new Error(`${label}: expected pattern not found in ${path}`);
  }
  await writeFile(path, text.replace(pattern, replacement), 'utf8');
}

async function main() {
  const arg = process.argv.slice(2).find((value) => value.startsWith('--version='));
  const version = arg ? arg.slice('--version='.length) : process.argv[2];
  if (!version || !SEMVER.test(version)) {
    throw new Error('Usage: node scripts/sync-versions.mjs <semver>  (e.g. 1.2.3)');
  }

  const rootPkg = await readJson(join(root, 'package.json'));
  rootPkg.version = version;
  await writeJson(join(root, 'package.json'), rootPkg);

  const manifests = [];
  for (const folder of ['apps', 'packages']) {
    const base = join(root, folder);
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(base, entry.name, 'package.json');
      try {
        const pkg = await readJson(manifest);
        pkg.version = version;
        await writeJson(manifest, pkg);
        manifests.push(pkg.name);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  await replaceInFile(
    join(root, 'apps/api/src/bootstrap.ts'),
    /\.setVersion\('[^']*'\)/,
    `.setVersion('${version}')`,
    'OpenAPI version',
  );
  await replaceInFile(
    join(root, 'apps/api/src/version/version.controller.ts'),
    /version: '[^']*'/,
    `version: '${version}'`,
    'version endpoint',
  );
  await replaceInFile(
    join(root, 'apps/api/src/app.module.ts'),
    /(name: 'assetnest',\s*\n\s*version: )'[^']*'/,
    `$1'${version}'`,
    'MCP server version',
  );

  console.log(`[sync-versions] set ${version}`);
  console.log(`[sync-versions] updated ${manifests.length + 1} package manifests`);
  console.log('[sync-versions] next: pnpm install  &&  pnpm release:check');
}

main().catch((error) => {
  console.error('[sync-versions] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
