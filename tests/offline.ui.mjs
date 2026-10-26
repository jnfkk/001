import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

test('standalone HTML content works with no server or HTTP requests and supports consultation', async (t) => {
  execFileSync(process.execPath, ['scripts/export-offline.mjs'], { cwd: new URL('..', import.meta.url) });
  const systemChrome = await access('/usr/bin/chromium').then(() => '/usr/bin/chromium').catch(() => undefined);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || systemChrome, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors = [], outbound = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) outbound.push(request.url()); });
  const target = new URL('../artifacts/hair-lab-demo.html', import.meta.url);
  // The managed cloud Chromium blocks file:// navigation by administrator policy.
  // Load the same complete document through its supported content API instead.
  await page.setContent(await readFile(target, 'utf8'), { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.style-card').count(), 6);
  assert.match(await page.locator('#mode-pill').textContent(), /离线风格体验/);
  await page.screenshot({ path: new URL('../artifacts/offline-desktop.png', import.meta.url).pathname, fullPage: true });
  assert.equal(await page.locator('.brand').getAttribute('href'), '#');
  await page.locator('#photo-input').setInputFiles({ name: 'local-photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  await page.waitForFunction(() => !document.querySelector('#customer-photo').hidden);
  await page.locator('#generate-button').click();
  assert.match(await page.locator('#toast').textContent(), /未接入真实试发/);
  await page.locator('[data-compare="airy-bob"]').click(); await page.locator('[data-compare="french-lob"]').click();
  await page.locator('#compare-button').click(); assert.equal(await page.locator('#compare-dialog[open] .compare-item').count(), 2);
  await page.locator('#compare-dialog [data-send-stylist="french-lob"]').click();
  await page.locator('[data-plan-tab="color"]').click(); assert.match(await page.locator('#plan-content').textContent(), /焦糖栗棕/);
  const pending = page.waitForEvent('download'); await page.locator('#download-plan').click();
  const download = await pending; assert.match(await readFile(await download.path(), 'utf8'), /法式锁骨发/);
  await page.locator('[data-view="customer"]').click(); await page.locator('#remove-photo').click();
  assert.equal(await page.locator('img[src^="data:image/"]').count(), 0);
  await page.locator('#toast').evaluate((element) => { element.hidden = true; });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: new URL('../artifacts/offline-mobile.png', import.meta.url).pathname, fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(outbound, [], 'offline mode must not contact an API or asset server');
});
