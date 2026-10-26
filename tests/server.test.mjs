import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createSalonServer } from '../server.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const photo = `data:image/png;base64,${PNG.toString('base64')}`;

async function running(t, options = {}) {
  const server = createSalonServer({ imageApiKey: '', ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function send(url, body, extra = {}) {
  return fetch(`${url}/api/try-on`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
}

test('unconfigured service reports demo and blocks a pretend generation', async (t) => {
  const url = await running(t);
  const status = await fetch(`${url}/api/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { imageEditingConfigured: false, mode: 'demo' });
  const response = await send(url, { image: photo, prompt: '柔雾长发' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'IMAGE_SERVICE_NOT_CONFIGURED');
});

test('static files load but parent traversal and escaping symlinks are inaccessible', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'salon-server-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const publicDirectory = path.join(directory, 'public');
  await mkdir(publicDirectory);
  await writeFile(path.join(publicDirectory, 'index.html'), '<main>Salon studio</main>');
  await writeFile(path.join(directory, 'private.txt'), 'do not expose');
  await symlink(path.join(directory, 'private.txt'), path.join(publicDirectory, 'escape.txt'));
  const url = await running(t, { publicDirectory });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Salon studio/);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${url}/..%2fprivate.txt`)).status, 403);
  assert.equal((await fetch(`${url}/escape.txt`)).status, 403);
  assert.equal((await fetch(`${url}/server.mjs`)).status, 404);
});

test('valid image is sent only to the fixed editing provider with private server credentials', async (t) => {
  let calls = 0;
  const url = await running(t, {
    imageApiKey: 'test-secret-not-a-real-key',
    imageFetch: async (endpoint, request) => {
      calls++;
      assert.equal(endpoint, 'https://api.openai.com/v1/images/edits');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.Authorization, 'Bearer test-secret-not-a-real-key');
      assert.equal(request.body.get('model'), 'gpt-image-1');
      assert.equal(request.body.get('size'), '1024x1536');
      assert.equal(request.body.get('quality'), 'medium');
      assert.equal(request.body.get('n'), '1');
      assert.match(request.body.get('prompt'), /Preserve the same person/);
      assert.match(request.body.get('prompt'), /法式锁骨发/);
      const uploaded = request.body.get('image');
      assert.equal(uploaded.type, 'image/png');
      assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), PNG);
      return Response.json({ data: [{ b64_json: PNG.toString('base64') }] });
    },
  });
  const status = await (await fetch(`${url}/api/status`)).json();
  assert.deepEqual(status, { imageEditingConfigured: true, mode: 'connected' });
  const response = await send(url, { image: photo, prompt: '法式锁骨发' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.image, photo);
  assert.equal(JSON.stringify(body).includes('test-secret'), false);
  assert.equal(calls, 1);
});

test('rejects invalid image format, tampered MIME, unknown fields, wrong origin and excessive image size', async (t) => {
  let calls = 0;
  const url = await running(t, {
    imageApiKey: 'test-only',
    imageFetch: async () => { calls++; throw new Error('must not call'); },
  });
  const cases = [
    [{ image: 'https://example.com/photo.jpg', prompt: '短发' }, 400, 'INVALID_IMAGE'],
    [{ image: photo.replace('image/png', 'image/jpeg'), prompt: '短发' }, 400, 'INVALID_IMAGE'],
    [{ image: photo, prompt: '' }, 400, 'INVALID_PROMPT'],
    [{ image: photo, prompt: '短发', endpoint: 'https://example.com' }, 400, 'INVALID_REQUEST'],
    [{ image: photo, prompt: '短发', key: 'client-secret' }, 400, 'INVALID_REQUEST'],
  ];
  for (const [body, status, code] of cases) {
    const response = await send(url, body);
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
  const crossOrigin = await send(url, { image: photo, prompt: '短发' }, { Origin: 'https://unrelated.example' });
  assert.equal(crossOrigin.status, 403);
  const oversize = Buffer.alloc(10 * 1024 * 1024 + 1);
  PNG.copy(oversize);
  const tooLarge = await send(url, { image: `data:image/png;base64,${oversize.toString('base64')}`, prompt: '短发' });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).code, 'IMAGE_TOO_LARGE');
  assert.equal(calls, 0);
});

test('provider errors never expose raw account or credential details', async (t) => {
  const url = await running(t, {
    imageApiKey: 'test-only',
    imageFetch: async () => Response.json({ error: { message: 'secret-account-detail' } }, { status: 401 }),
  });
  const response = await send(url, { image: photo, prompt: '短发' });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes('secret-account-detail'), false);
  assert.match(text, /IMAGE_SERVICE_ERROR/);
});

test('disconnecting the customer cancels the pending provider request', { timeout: 5000 }, async (t) => {
  let announceStarted;
  let announceAborted;
  const providerStarted = new Promise((resolve) => { announceStarted = resolve; });
  const providerAborted = new Promise((resolve) => { announceAborted = resolve; });
  const url = await running(t, {
    imageApiKey: 'test-only',
    imageFetch: async (_endpoint, request) => {
      assert.equal(request.signal.aborted, false);
      announceStarted();
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          announceAborted();
          reject(request.signal.reason);
        }, { once: true });
      });
    },
  });
  const client = new AbortController();
  const pending = fetch(`${url}/api/try-on`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: photo, prompt: '法式锁骨发' }), signal: client.signal,
  });
  const clientRejected = assert.rejects(pending, { name: 'AbortError' });
  await providerStarted;
  client.abort();
  await clientRejected;
  await providerAborted;
});

test('startup command enables the official Node environment proxy support', async () => {
  const { readFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.start, 'node --use-env-proxy server.mjs');
  assert.equal(manifest.engines.node, '>=24.5.0');
  const supported = spawnSync(process.execPath, ['--use-env-proxy', '-e', 'process.stdout.write("supported")'], {
    encoding: 'utf8',
  });
  assert.equal(supported.status, 0);
  assert.equal(supported.stdout, 'supported');
});
