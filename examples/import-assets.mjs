#!/usr/bin/env node
/* eslint-disable no-console -- CLI example: stdout is the interface */
/**
 * Import assets into AssetNest from a CSV file via the HTTP API.
 *
 *   ASSETNEST_URL=http://localhost:3000 \
 *   ASSETNEST_TOKEN=anst_... \
 *   ASSETNEST_WORKSPACE_ID=<uuid> \
 *   node examples/import-assets.mjs ./assets.csv [--commit]
 *
 * CSV headers are mapped to AssetNest fields in the MAP below (edit to your
 * file). Runs a dry-run first and prints per-row verdicts; pass --commit to
 * actually import. Duplicates (same assetTag) default to "skip".
 *
 * Get an API token from the Integrations UI (anst_...) with scopes
 * assets:read + assets:write. Token secrets are never logged.
 */
import { readFileSync } from 'node:fs';

const [csvPath, ...flags] = process.argv.slice(2);
const COMMIT = flags.includes('--commit');
const { ASSETNEST_URL, ASSETNEST_TOKEN, ASSETNEST_WORKSPACE_ID } = process.env;

if (!csvPath || !ASSETNEST_URL || !ASSETNEST_TOKEN || !ASSETNEST_WORKSPACE_ID) {
  console.error(
    'usage: ASSETNEST_URL=... ASSETNEST_TOKEN=anst_... ASSETNEST_WORKSPACE_ID=<uuid> node examples/import-assets.mjs ./assets.csv [--commit]',
  );
  process.exitCode = 1;
}

// Map CSV column headers (exact, case-insensitive) to AssetNest import fields.
const MAP = {
  tag: 'assetTag',
  'asset tag': 'assetTag',
  name: 'displayName',
  'display name': 'displayName',
  serial: 'serialNumber',
  status: 'status',
  condition: 'condition',
  notes: 'notes',
  amount: 'amount',
  currency: 'currency',
};

const csvText = readFileSync(csvPath, 'utf8');

async function call(path, body) {
  const response = await fetch(`${ASSETNEST_URL}/api/v1/workspaces/${ASSETNEST_WORKSPACE_ID}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ASSETNEST_TOKEN}`,
      connection: 'close',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

// Column mapping is required by the API; discover headers from the file.
const headerLine = csvText.split(/\r?\n/, 1)[0] ?? '';
const mapping = {};
for (const raw of headerLine.split(',')) {
  const header = raw.trim().toLowerCase();
  if (MAP[header]) mapping[raw.trim()] = MAP[header];
}
if (!Object.values(mapping).includes('assetTag') || !Object.values(mapping).includes('displayName')) {
  console.error(
    `CSV must provide columns mapping to assetTag and displayName (found headers: ${headerLine}). Edit MAP in this script.`,
  );
  process.exitCode = 1;
}

console.log(
  `→ dry-run against ${ASSETNEST_URL} (workspace ${ASSETNEST_WORKSPACE_ID})\n  mapping: ${JSON.stringify(mapping)}`,
);
const preview = await call('/imports', { csvText, mapping, onDuplicate: 'skip', dryRun: true });
if (preview.status >= 400) {
  console.error(`dry-run failed (HTTP ${preview.status}):`, JSON.stringify(preview.body, null, 2));
  process.exitCode = 1;
}
const summary = preview.body;
const errors = Array.isArray(summary.errors) ? summary.errors : [];
for (const error of errors) {
  console.log(`  row ${error.row}: INVALID — ${error.field ?? ''} ${error.message ?? ''}`.trim());
}
console.log(
  `\n→ dry-run summary: ${JSON.stringify({ total: summary.total, imported: summary.imported, skippedDuplicate: summary.skippedDuplicate, failed: summary.failed })}`,
);

if (!COMMIT) {
  console.log('\nDry run only. Re-run with --commit to import.');
  process.exitCode = 0;
} else {
  const committed = await call('/imports', { csvText, mapping, onDuplicate: 'skip', dryRun: false });
  if (committed.status >= 400) {
    console.error(`import failed (HTTP ${committed.status}):`, JSON.stringify(committed.body, null, 2));
    process.exitCode = 1;
  } else {
    console.log('\n→ import complete:', JSON.stringify(committed.body, null, 2));
  }
}
