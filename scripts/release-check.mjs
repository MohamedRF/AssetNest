#!/usr/bin/env node
/**
 * Verify that a release is internally consistent.
 *
 *   node scripts/release-check.mjs
 *
 * Checks:
 *   - root and every workspace package.json share one version
 *   - the OpenAPI document, /version endpoint and MCP server report that version
 *   - CHANGELOG.md has a section for it
 *   - the working tree is clean (warn only)
 *
 * Exits non-zero on any inconsistency. This is intentionally offline and
 * read-only so it can gate a release before any registry or signing step.
 */
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function fail(message) {
  console.error(`[release-check] FAIL: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const rootPkg = await readJson(join(root, 'package.json'));
  const version = rootPkg.version;
  const problems = [];

  const manifests = [];
  for (const folder of ['apps', 'packages']) {
    const base = join(root, folder);
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const pkg = await readJson(join(base, entry.name, 'package.json'));
        manifests.push(pkg);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  for (const pkg of manifests) {
    if (pkg.version !== version) {
      problems.push(`${pkg.name} is ${pkg.version}, expected ${version}`);
    }
  }

  const sourceChecks = [
    ['apps/api/src/bootstrap.ts', `.setVersion('${version}')`],
    ['apps/api/src/version/version.controller.ts', `version: '${version}'`],
    ['apps/api/src/app.module.ts', `version: '${version}'`],
  ];
  for (const [file, needle] of sourceChecks) {
    const text = await readFile(join(root, file), 'utf8');
    if (!text.includes(needle)) {
      problems.push(`${file} does not report version ${version}`);
    }
  }

  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(`## [${version}]`)) {
    problems.push(`CHANGELOG.md has no section for ${version}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) fail(problem);
    return;
  }

  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    if (status.trim().length > 0) {
      console.warn('[release-check] warning: working tree has uncommitted changes');
    }
  } catch {
    console.warn('[release-check] warning: could not read git status');
  }

  console.log(`[release-check] OK: v${version} consistent across ${manifests.length + 1} packages`);
  console.log(`[release-check] tag: v${version}`);
}

main().catch((error) => {
  console.error('[release-check] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
