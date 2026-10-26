import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 12_000;
const IMAGE_ENDPOINT = 'https://api.openai.com/v1/images/edits';
const IMAGE_MODEL = 'gpt-image-1';
const EDIT_TIMEOUT_MS = 150_000;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

class RequestError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new RequestError(415, '请使用 JSON 格式提交照片。', 'UNSUPPORTED_CONTENT_TYPE');
  }
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RequestError(413, '提交内容过大，请选择 10 MB 以内的照片。', 'REQUEST_TOO_LARGE');
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new RequestError(413, '提交内容过大，请选择 10 MB 以内的照片。', 'REQUEST_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, '无法读取提交内容，请重试。', 'INVALID_JSON');
  }
}

function decodePhoto(value) {
  if (typeof value !== 'string') throw new RequestError(400, '请先拍摄或上传照片。', 'INVALID_IMAGE');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) {
    throw new RequestError(400, '请使用 PNG、JPEG 或 WebP 格式照片。', 'INVALID_IMAGE');
  }
  const [, mime, encoded] = match;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new RequestError(413, '照片超过 10 MB，请压缩后重试。', 'IMAGE_TOO_LARGE');
  if (!bytes.length || bytes.toString('base64') !== encoded) {
    throw new RequestError(400, '照片数据无效，请重新上传。', 'INVALID_IMAGE');
  }
  const signatureMatches = {
    'image/png': bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/webp': bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  };
  if (!signatureMatches[mime]) throw new RequestError(400, '照片内容与文件格式不符，请重新上传。', 'INVALID_IMAGE');
  return { bytes, mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] };
}

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

async function tryOn(req, res, { imageApiKey, imageFetch }) {
  if (!sameOrigin(req)) throw new RequestError(403, '请从本应用页面提交试发请求。', 'ORIGIN_NOT_ALLOWED');
  if (!imageApiKey) {
    throw new RequestError(503, '当前是演示模式，尚未接入真实图像编辑服务。', 'IMAGE_SERVICE_NOT_CONFIGURED');
  }
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['image', 'prompt'].includes(key))) {
    throw new RequestError(400, '请求仅支持照片和发型描述。', 'INVALID_REQUEST');
  }
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > MAX_PROMPT_LENGTH) {
    throw new RequestError(400, '请提供有效的发型描述。', 'INVALID_PROMPT');
  }
  const photo = decodePhoto(body.image);
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('image', new Blob([photo.bytes], { type: photo.mime }), `portrait.${photo.extension}`);
  form.append('prompt', [
    'Edit this consenting adult customer portrait for a hair salon consultation.',
    'Preserve the same person: facial identity, facial features, age, skin tone, expression, body, clothing, pose, and background.',
    'Only change the hairstyle and hair color according to the requested salon design.',
    'Make a realistic photographic hairstyle preview. Do not add text, labels, watermarks, makeup, beauty retouching, or medical claims.',
    'Requested hairstyle design:', body.prompt.trim(),
  ].join('\n'));
  form.append('size', '1024x1536');
  form.append('quality', 'medium');
  form.append('n', '1');
  const clientAbort = new AbortController();
  const onClientAbort = () => clientAbort.abort();
  const onResponseClose = () => {
    // IncomingMessage also emits close after a normally completed request body.
    // A prematurely closed response is the useful signal while generation runs.
    if (!res.writableEnded) onClientAbort();
  };
  req.once('aborted', onClientAbort);
  res.once('close', onResponseClose);
  if (req.aborted || res.destroyed) onClientAbort();
  try {
    if (clientAbort.signal.aborted) return;
    const response = await imageFetch(IMAGE_ENDPOINT, {
      method: 'POST', headers: { Authorization: `Bearer ${imageApiKey}` },
      body: form, signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(EDIT_TIMEOUT_MS)]),
    });
    if (clientAbort.signal.aborted || res.destroyed) return;
    if (!response.ok) {
      // Provider responses may contain account details; do not return or log them.
      throw new RequestError(502, '图像服务暂时无法完成试发，请稍后重试或检查服务配置。', 'IMAGE_SERVICE_ERROR');
    }
    const result = await response.json();
    const encoded = result?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new RequestError(502, '图像服务未返回可用图片，请重试。', 'INVALID_SERVICE_RESPONSE');
    }
    json(res, 200, { image: `data:image/png;base64,${encoded}` });
  } catch (error) {
    if (clientAbort.signal.aborted) return;
    if (error instanceof RequestError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new RequestError(504, '试发生成超时，请稍后重试。', 'IMAGE_SERVICE_TIMEOUT');
    }
    throw new RequestError(502, '暂时无法连接图像服务，请稍后重试。', 'IMAGE_SERVICE_ERROR');
  } finally {
    req.off('aborted', onClientAbort);
    res.off('close', onResponseClose);
  }
}

function containedIn(directory, candidate) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

async function staticFile(req, res, pathname, publicDirectory) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch {
    throw new RequestError(400, '无效的请求路径。', 'INVALID_PATH');
  }
  if (decoded.includes('\0') || decoded.includes('\\')) throw new RequestError(400, '无效的请求路径。', 'INVALID_PATH');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = path.resolve(publicDirectory, relative);
  if (!containedIn(publicDirectory, candidate)) throw new RequestError(403, '无法访问该文件。', 'FORBIDDEN');
  let resolved;
  try {
    resolved = await realpath(candidate);
    const publicRoot = await realpath(publicDirectory);
    if (!containedIn(publicRoot, resolved)) throw new RequestError(403, '无法访问该文件。', 'FORBIDDEN');
    if (!(await stat(resolved)).isFile()) throw new RequestError(404, '未找到页面。', 'NOT_FOUND');
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new RequestError(404, '未找到页面。', 'NOT_FOUND');
    throw error;
  }
  const file = await readFile(resolved);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    'Content-Length': file.length, 'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : file);
}

export function createSalonServer({
  imageApiKey = process.env.SALON_IMAGE_API_KEY || '',
  imageFetch = globalThis.fetch,
  publicDirectory = PUBLIC,
} = {}) {
  const config = { imageApiKey, imageFetch };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/status') {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          return json(res, 405, { error: '该接口仅支持 GET。', code: 'METHOD_NOT_ALLOWED' });
        }
        return json(res, 200, { imageEditingConfigured: Boolean(imageApiKey), mode: imageApiKey ? 'connected' : 'demo' });
      }
      if (url.pathname === '/api/try-on') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return json(res, 405, { error: '该接口仅支持 POST。', code: 'METHOD_NOT_ALLOWED' });
        }
        await tryOn(req, res, config);
        return;
      }
      if (url.pathname.startsWith('/api/')) throw new RequestError(404, '接口不存在。', 'NOT_FOUND');
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return json(res, 405, { error: '该页面不支持此请求方式。', code: 'METHOD_NOT_ALLOWED' });
      }
      await staticFile(req, res, url.pathname, path.resolve(publicDirectory));
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof RequestError) json(res, error.status, { error: error.message, code: error.code });
      else json(res, 500, { error: '服务暂时出现问题，请重试。', code: 'INTERNAL_ERROR' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT 必须是 0–65535 范围内的整数。');
    process.exitCode = 1;
  } else {
    const server = createSalonServer();
    server.requestTimeout = 180_000;
    server.headersTimeout = 20_000;
    server.listen(port, host, () => {
      console.log(`Salon studio listening on ${host}:${server.address().port}`);
      console.log(process.env.SALON_IMAGE_API_KEY ? 'Image editing service configured.' : 'Demo mode: real image editing is not configured.');
    });
    server.on('error', () => {
      console.error('无法启动服务，请检查端口是否被占用以及 HOST / PORT 设置。');
      process.exitCode = 1;
    });
  }
}
