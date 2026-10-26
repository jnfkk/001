import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hosted = process.argv.includes('--pages');
const [html, css, app, data, photo] = await Promise.all([
  readFile(path.join(root, 'public/index.html'), 'utf8'),
  readFile(path.join(root, 'public/app.css'), 'utf8'),
  readFile(path.join(root, 'public/app.js'), 'utf8'),
  readFile(path.join(root, 'public/styles-data.js'), 'utf8'),
  readFile(path.join(root, 'public/assets/hairstyles.png')),
]);
const embeddedImage = `data:image/png;base64,${photo.toString('base64')}`;
const styles = css.replaceAll("url('/assets/hairstyles.png')", 'none') + '\n.offline-notice{padding:11px 5%;background:#e8efdc;color:#4e633b;font-size:12px;line-height:1.8;border-bottom:1px solid #d8e3c7}';
const script = `${data.replace('export const HAIRSTYLES', 'const HAIRSTYLES')}\n${app.replace(/^import \{ HAIRSTYLES \} from '\.\/styles-data\.js';\s*/, '').replaceAll('/assets/hairstyles.png', embeddedImage)}`;
const output = html
  .replace('<html lang="zh-CN">', `<html lang="zh-CN" data-offline="true"${hosted ? ' data-preview="hosted"' : ''}>`)
  .replace('<title>HAIR LAB · 你的专属发型顾问</title>', `<title>HAIR LAB · ${hosted ? '美发智能体参考体验' : '离线体验版'}</title>`)
  .replace('<link rel="stylesheet" href="/app.css">', () => `<style>${styles}</style>`)
  .replace('  <script type="module" src="/app.js"></script>\n', '')
  .replace('class="brand" href="/"', 'class="brand" href="#"')
  .replace('</header>', hosted ? '</header><div class="offline-notice">在线参考体验版 · 可拍照、上传与对比发型。当前为示例模特参考；客户照片仅在本机浏览器会话中使用，不会发送至图像服务。</div>' : '</header><div class="offline-notice">离线体验版 · 下载后用 Chrome / Edge 浏览器打开。当前为示例模特参考；上传的照片只在本机页面中使用，不会发送到服务器。</div>')
  .replace('</body>', () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script></body>`);
const directory = path.join(root, hosted ? 'docs' : 'artifacts');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, hosted ? 'index.html' : 'hair-lab-demo.html'), output);
if (hosted) await writeFile(path.join(directory, '.nojekyll'), '');
console.log(hosted ? 'Static hosted demo exported: docs/index.html' : 'Offline single-file demo exported: artifacts/hair-lab-demo.html');
