import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

test('hosted preview works under a repository subpath and never calls paid services', async (t) => {
  execFileSync(process.execPath, ['scripts/export-offline.mjs', '--pages'], { cwd: new URL('..', import.meta.url) });
  const html = await readFile(new URL('../docs/index.html', import.meta.url));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/001/' || req.url === '/001/#') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
    else { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const systemChrome = await access('/usr/bin/chromium').then(() => '/usr/bin/chromium').catch(() => undefined);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || systemChrome, args: ['--no-sandbox'], headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/001/`); await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.style-card').count(), 6);
  assert.match(await page.locator('#mode-pill').textContent(), /在线参考体验/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#generate-button').click(); assert.match(await page.locator('#toast').textContent(), /未接入真实试发/);
  await page.locator('[data-compare="airy-bob"]').click(); await page.locator('[data-compare="french-lob"]').click();
  await page.locator('#compare-button').click(); assert.equal(await page.locator('#compare-dialog[open] .compare-item').count(), 2);
  await page.locator('#compare-dialog [data-send-stylist="french-lob"]').click();
  await page.locator('[data-plan-tab="color"]').click(); assert.match(await page.locator('#plan-content').textContent(), /焦糖栗棕/);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.equal(requests.some((url) => url.includes('/api/') || url.includes('/assets/') || url.includes('/app.js')), false);
});
