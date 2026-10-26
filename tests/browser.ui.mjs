import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSalonServer } from '../server.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let browser;
const allServers = [];

before(async () => {
  const systemChrome = await access('/usr/bin/chromium').then(() => '/usr/bin/chromium').catch(() => undefined);
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || systemChrome, headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
});

after(async () => {
  await browser?.close();
  await Promise.all(allServers.map((server) => new Promise((resolve) => server.close(resolve))));
});

async function session(t, { connected = false } = {}) {
  const calls = [];
  const server = createSalonServer({ imageApiKey: connected ? 'test-only-no-external-service' : '', imageFetch: async (endpoint, request) => { calls.push({ endpoint, prompt: request.body.get('prompt') }); return Response.json({ data: [{ b64_json: PNG }] }); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); allServers.push(server);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { assert.deepEqual(errors, [], 'no browser runtime errors'); await context.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url); await page.waitForLoadState('networkidle');
  return { page, context, calls };
}

test('demo clearly identifies six references, filters, sorts, and supports responsive layouts', async (t) => {
  const { page, calls } = await session(t);
  assert.equal(await page.locator('.style-card').count(), 6);
  assert.equal(await page.locator('.style-card .visual-label', { hasText: '示例模特' }).count(), 6);
  assert.equal((await page.request.get(new URL('/assets/hairstyles.png', page.url()).href)).status(), 200);
  await page.locator('[data-filter="short"]').click(); assert.equal(await page.locator('.style-card').count(), 1);
  await page.locator('[data-filter="medium"]').click(); assert.equal(await page.locator('.style-card').count(), 3);
  await page.locator('[data-filter="all"]').click();
  await page.locator('#length-pref').selectOption('long');
  assert.equal(await page.locator('.style-card').first().getAttribute('data-style'), 'layered-long');
  await page.locator('#generate-button').click();
  assert.match(await page.locator('#toast').textContent(), /未接入真实试发/);
  assert.equal(calls.length, 0);
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await page.locator('#length-pref').selectOption('all');
  await page.locator('#toast').evaluate((element) => { element.hidden = true; });
  await page.screenshot({ path: new URL('../artifacts/desktop.png', import.meta.url).pathname, fullPage: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('../artifacts/mobile.png', import.meta.url).pathname, fullPage: true });
});

test('comparison, stylist cut/perm/color plans, and downloadable consultation are functional', async (t) => {
  const { page } = await session(t);
  await page.locator('[data-compare="airy-bob"]').click();
  await page.locator('[data-compare="french-lob"]').click();
  await page.locator('[data-compare="layered-long"]').click();
  await page.locator('[data-compare="soft-curls"]').click();
  assert.equal(await page.locator('.compare-toggle[aria-pressed="true"]').count(), 3);
  await page.locator('#compare-button').click();
  assert.equal(await page.locator('#compare-dialog[open] .compare-item').count(), 3);
  await page.locator('#compare-dialog [data-send-stylist="french-lob"]').click();
  assert.equal(await page.locator('#stylist-view').isVisible(), true);
  assert.equal(await page.locator('#compare-tray').isVisible(), false);
  assert.match(await page.locator('.stylist-overview h2').textContent(), /法式锁骨发/);
  assert.equal(await page.locator('.plan-steps li').count(), 4);
  await page.locator('[data-plan-tab="perm"]').click(); assert.equal(await page.locator('.plan-steps li').count(), 3);
  await page.locator('[data-plan-tab="color"]').click(); assert.equal(await page.locator('.plan-steps li').count(), 3);
  assert.match(await page.locator('.color-comparison').textContent(), /待现场实测确认/);
  const pending = page.waitForEvent('download'); await page.locator('#download-plan').click();
  const download = await pending; const content = await readFile(await download.path(), 'utf8');
  assert.match(content, /法式锁骨发/); assert.match(content, /剪裁参考/); assert.match(content, /染色方向/); assert.equal(content.includes('data:image'), false);
  await page.locator('#toast').evaluate((element) => { element.hidden = true; });
  await page.screenshot({ path: new URL('../artifacts/stylist.png', import.meta.url).pathname, fullPage: true });
});

test('upload and camera capture use local images, and camera tracks stop on close', async (t) => {
  const { page, calls } = await session(t);
  await page.locator('#photo-input').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await page.waitForFunction(() => !document.querySelector('#customer-photo').hidden);
  assert.equal(calls.length, 0);
  await page.locator('#remove-photo').click(); assert.equal(await page.locator('#customer-photo').isVisible(), false);
  await page.locator('#camera-button').click();
  await page.waitForFunction(() => !document.querySelector('#capture-button').disabled);
  await page.evaluate(() => { window.__testTracks = document.querySelector('#camera-video').srcObject.getTracks(); });
  await page.locator('#capture-button').click();
  assert.equal(await page.locator('#customer-photo').isVisible(), true);
  assert.equal(await page.locator('#camera-dialog').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__testTracks.every((track) => track.readyState === 'ended')), true);
  await page.reload(); assert.equal(await page.locator('#customer-photo').isVisible(), false);
});

test('stale camera requests stop their own tracks after switching and closing', async (t) => {
  const { page } = await session(t);
  await page.evaluate(() => {
    window.__cameraPending = [];
    navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240; canvas.getContext('2d').fillRect(0, 0, 320, 240); const stream = canvas.captureStream(4); window.__cameraPending.push({ resolve: () => resolve(stream), stream }); });
  });
  await page.locator('#camera-button').click();
  await page.waitForFunction(() => window.__cameraPending.length === 1);
  await page.locator('#switch-camera').click();
  await page.waitForFunction(() => window.__cameraPending.length === 2);
  await page.evaluate(() => window.__cameraPending[1].resolve());
  await page.waitForFunction(() => !document.querySelector('#capture-button').disabled);
  await page.evaluate(() => window.__cameraPending[0].resolve());
  await page.waitForFunction(() => window.__cameraPending[0].stream.getTracks().every((track) => track.readyState === 'ended'));
  await page.locator('[data-close="camera-dialog"]').click();
  await page.waitForFunction(() => window.__cameraPending.every(({ stream }) => stream.getTracks().every((track) => track.readyState === 'ended')));
});

test('mocked personal generation produces six labeled images and removing the photo clears hidden views', async (t) => {
  const { page, calls } = await session(t, { connected: true });
  await page.locator('#photo-input').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await page.waitForFunction(() => !document.querySelector('#customer-photo').hidden);
  await page.locator('#photo-consent').check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#generate-button').click();
  await page.waitForFunction(() => document.querySelector('#generation-status').textContent.startsWith('6 款个人试发已生成'));
  assert.equal(calls.length, 6);
  assert.equal(await page.locator('.style-card .visual-label', { hasText: 'AI 试发效果' }).count(), 6);
  await page.locator('[data-compare="airy-bob"]').click(); await page.locator('[data-compare="french-lob"]').click();
  await page.locator('#compare-button').click(); await page.locator('[data-close="compare-dialog"]').click();
  await page.locator('[data-detail="airy-bob"]').first().click(); await page.locator('[data-close="detail-dialog"]').click();
  await page.locator('[data-view="stylist"]').click(); await page.locator('[data-view="customer"]').click();
  await page.locator('#remove-photo').click();
  assert.equal(await page.locator('img[src^="data:image/"]').count(), 0, 'removed photo must not survive in hidden dialogs or workbench');
  assert.equal(await page.locator('.style-card .visual-label', { hasText: '示例模特' }).count(), 6);
});
