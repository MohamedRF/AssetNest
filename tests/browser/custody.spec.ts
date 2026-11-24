import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('finds a tagged asset, assigns it, and returns it with history', async ({ page }) => {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD for the disposable browser test stack.');
  }

  const tag = `E2E-${randomUUID().toUpperCase()}`;
  const name = `Browser test equipment ${tag}`;

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Assets', exact: true }).click();

  await page.getByRole('link', { name: 'New asset', exact: true }).click();
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Asset tag').fill(tag);
  await page.getByRole('button', { name: 'Create asset', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const assetPath = new URL(page.url()).pathname;
  expect(assetPath).toMatch(/^\/assets\/[0-9a-f-]{36}$/);
  const assetId = assetPath.slice('/assets/'.length);

  await page.getByRole('link', { name: 'Back to assets', exact: true }).click();
  const lookup = page.getByRole('search', { name: 'Asset code lookup' });
  await lookup.getByLabel('Find asset by QR code or asset ID').fill(`assetnest://asset/${assetId}`);
  await lookup.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === assetPath);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByTestId('asset-status-available')).toBeVisible();

  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const assignDialog = page.getByRole('dialog', { name: 'Assign asset' });
  await assignDialog.getByLabel('Member').selectOption({ label: 'AssetNest Admin (owner)' });
  await assignDialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByTestId('asset-status-assigned')).toBeVisible();

  await page.getByRole('button', { name: 'Return', exact: true }).click();
  const returnDialog = page.getByRole('dialog', { name: 'Return asset?' });
  await returnDialog.getByRole('button', { name: 'Return asset', exact: true }).click();
  await expect(page.getByTestId('asset-status-available')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('asset-status-available')).toBeVisible();
  const historyLabels = page.getByRole('listitem').getByRole('paragraph');
  await expect(historyLabels.filter({ hasText: /^assigned$/ })).toHaveCount(1);
  await expect(historyLabels.filter({ hasText: /^returned$/ })).toHaveCount(1);
});
