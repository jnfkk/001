import { HAIRSTYLES } from './styles-data.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const OFFLINE_PREVIEW = document.documentElement.dataset.offline === 'true';
const HOSTED_PREVIEW = document.documentElement.dataset.preview === 'hosted';
const state = { photo: null, configured: false, filter: 'all', compare: new Set(), active: HAIRSTYLES[0].id, planTab: 'cut', images: new Map(), busy: false, stream: null, facing: 'user', generation: 0, abort: null, photoLoad: 0, cameraRequest: 0, view: 'customer' };
const positions = new Map(HAIRSTYLES.map((style, index) => [style.id, `--px:${(index % 3) * 50}%;--py:${Math.floor(index / 3) * 100}%`]));
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const label = (style) => state.images.has(style.id) ? '客户照片 · AI 试发效果' : '风格参考 · 示例模特';
const maintenance = (value) => ['', '轻松打理', '适度整理', '需要造型维护'][value];
const lengthName = (value) => ({ short: '利落短发', medium: '中长发', long: '长发' }[value]);
const findStyle = (id) => HAIRSTYLES.find((style) => style.id === id);
const picture = (style) => {
  if (state.images.has(style.id)) return `<img src="${state.images.get(style.id)}" alt="${style.name}：基于本次客户照片生成的试发效果">`;
  const index = HAIRSTYLES.findIndex((item) => item.id === style.id);
  return `<svg class="reference-portrait" viewBox="${index % 3} ${Math.floor(index / 3) * 1.5} 1 1.5" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${style.name}风格参考，示例模特"><image href="/assets/hairstyles.png" width="3" height="3"/></svg>`;
};
let toastTimer;

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5200);
}

function sortedStyles() {
  const length = $('#length-pref').value;
  const time = $('#time-pref').value;
  const score = (style) => (style.length === length ? 10 : 0) + (time === 'easy' ? 3 - style.maintenance : time === 'styled' ? style.maintenance : 0);
  return [...HAIRSTYLES].sort((a, b) => score(b) - score(a)).filter((style) => state.filter === 'all' || style.length === state.filter);
}

function renderCards() {
  const styles = sortedStyles();
  $('#style-grid').innerHTML = styles.map((style) => `
    <article class="style-card ${state.compare.has(style.id) ? 'selected' : ''}" data-style="${style.id}">
      <div class="style-visual" style="${positions.get(style.id)}">
        ${picture(style)}<button class="visual-open" data-detail="${style.id}" aria-label="查看${style.name}方案"></button>
        <span class="style-chip">${escapeHTML(style.tags[0])}</span>
        <button class="compare-toggle" data-compare="${style.id}" aria-label="${state.compare.has(style.id) ? '移出' : '加入'}对比：${style.name}" aria-pressed="${state.compare.has(style.id)}">${state.compare.has(style.id) ? '✓' : '+'}</button>
        <span class="visual-label">${label(style)}</span>
      </div>
      <div class="style-card-body"><div class="style-title-row"><h3>${style.name}</h3><span class="color-dot" style="--swatch:${style.color.hex}" title="${style.color.name}"></span></div><p class="style-english">${style.englishName}</p><p class="style-description">${escapeHTML(style.professionalSummary)}</p><div class="card-bottom"><span class="card-color">${style.color.name}</span><button class="card-more" data-detail="${style.id}">查看方案 <span>↗</span></button></div></div>
    </article>`).join('') || '<p class="empty-results">这个长度还没有参考方案，试试其他长度。</p>';
  const personal = state.images.size;
  $('#results-badge').textContent = personal ? `${personal} 款个人试发 · 其余为参考` : '风格灵感 · 示例模特';
  $('#results-footnote').textContent = personal ? `已生成 ${personal} 款基于客户照片的试发效果，每张均单独标注。仅作沟通参考，以现场发质与实际色卡为准。` : '当前为示例模特的风格参考，尚未替换成你的发型。选择一款，查看设计细节。';
  $('#results-title').innerHTML = state.filter === 'all' ? '发现你的 <span>6</span> 种可能' : `${lengthName(state.filter)}的 <span>${styles.length}</span> 种可能`;
  $('#sort-caption').textContent = $('#length-pref').value !== 'all' || $('#time-pref').value !== 'all' ? '已按你填写的偏好排序' : '为改变留一点想象';
}

function setFilter(filter) {
  state.filter = filter;
  $$('.filters button').forEach((button) => { button.classList.toggle('active', button.dataset.filter === filter); button.setAttribute('aria-pressed', String(button.dataset.filter === filter)); });
  renderCards();
}

function renderCompareTray() {
  $('#compare-tray').hidden = state.view !== 'customer' || state.compare.size === 0;
  $('#compare-count').textContent = `已选 ${state.compare.size} / 3 款`;
  $('#compare-thumbnails').innerHTML = [...state.compare].map((id) => `<div class="mini-visual" style="${positions.get(id)}" title="${findStyle(id).name}">${picture(findStyle(id))}</div>`).join('');
}

function toggleCompare(id) {
  if (state.compare.has(id)) state.compare.delete(id);
  else if (state.compare.size === 3) return toast('最多对比 3 款。先移除一款，再加入新的选择。');
  else state.compare.add(id);
  renderCards();
  renderCompareTray();
}

function showDetail(id) {
  const style = findStyle(id);
  $('#detail-content').innerHTML = `<div class="detail-layout"><div class="detail-photo" style="${positions.get(id)}">${picture(style)}<span class="visual-label">${label(style)}</span></div><div class="detail-info"><p class="eyebrow">MEET YOUR NEXT LOOK</p><h2>${style.name}</h2><p class="style-english">${style.englishName}</p><p class="detail-description">${escapeHTML(style.description)}</p><div class="detail-tags">${style.tags.map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div><dl class="detail-facts"><div><dt>意向色彩</dt><dd>${style.color.name} <span class="color-dot" style="--swatch:${style.color.hex};margin-left:7px"></span></dd></div><div><dt>日常打理</dt><dd>${maintenance(style.maintenance)}</dd></div><div><dt>服务时长参考</dt><dd>${escapeHTML(style.duration)}</dd></div></dl><button class="button button-green" data-send-stylist="${style.id}">就这款，和发型师聊聊 <span>↗</span></button><p class="detail-caution">${escapeHTML(style.caution)}</p></div></div>`;
  $('#detail-dialog').showModal();
}

function showComparison() {
  if (state.compare.size < 2) return toast('再选择一款，就能并排对比了。');
  $('#compare-content').style.setProperty('--columns', state.compare.size);
  $('#compare-content').innerHTML = [...state.compare].map((id) => {
    const style = findStyle(id);
    return `<article class="compare-item"><div class="reference-visual" style="${positions.get(id)}">${picture(style)}<span class="visual-label">${label(style)}</span></div><div class="compare-item-body"><h3>${style.name}</h3><p>${escapeHTML(style.professionalSummary)}</p><dl><div><dt>长度</dt><dd>${lengthName(style.length)}</dd></div><div><dt>目标色</dt><dd>${style.color.name}</dd></div><div><dt>日常打理</dt><dd>${maintenance(style.maintenance)}</dd></div><div><dt>烫发方向</dt><dd>${escapeHTML(style.perm.method)}</dd></div></dl><button class="button button-outline" data-send-stylist="${id}">和发型师讨论这款 ↗</button></div></article>`;
  }).join('');
  $('#compare-dialog').showModal();
}

function setView(view) {
  state.view = view;
  $('#customer-view').hidden = view !== 'customer';
  $('#stylist-view').hidden = view !== 'stylist';
  $$('.view-tab').forEach((button) => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
  $('#compare-tray').hidden = view !== 'customer' || state.compare.size === 0;
  if (view === 'stylist') renderStylist();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStylist() {
  const style = findStyle(state.active);
  $('#stylist-options').innerHTML = HAIRSTYLES.map((option) => `<button class="stylist-option ${option.id === state.active ? 'active' : ''}" data-stylist="${option.id}" aria-pressed="${option.id === state.active}"><div class="mini-visual" style="${positions.get(option.id)}">${picture(option)}</div><div><h3>${option.name}</h3><p>${option.color.name}</p></div><span>↗</span></button>`).join('');
  $('#stylist-detail').innerHTML = `<div class="stylist-summary"><div class="stylist-portrait" style="${positions.get(style.id)}">${picture(style)}<span class="visual-label">${state.images.has(style.id) ? '个人试发' : '示例模特'}</span></div><div class="stylist-overview"><p class="eyebrow">DESIGN CONSULTATION · ${state.photo ? '已上传客户照片' : '参考方案'}</p><h2>${style.name}</h2><p>${escapeHTML(style.professionalSummary)}</p><div class="detail-tags"><span>${lengthName(style.length)}</span><span>${maintenance(style.maintenance)}</span><span>${style.color.name}</span></div><p>适合沟通的需求：${escapeHTML(style.suitable)}</p></div></div><div class="plan-tabs" role="group" aria-label="理发师方案类型"><button data-plan-tab="cut" class="${state.planTab === 'cut' ? 'active' : ''}" aria-pressed="${state.planTab === 'cut'}">剪裁方案</button><button data-plan-tab="perm" class="${state.planTab === 'perm' ? 'active' : ''}" aria-pressed="${state.planTab === 'perm'}">烫发设计</button><button data-plan-tab="color" class="${state.planTab === 'color' ? 'active' : ''}" aria-pressed="${state.planTab === 'color'}">染发与色彩对比</button></div><div class="plan-content" id="plan-content"></div><div class="stylist-actions"><button class="button button-outline" id="copy-plan">复制沟通方案 ↗</button></div>`;
  renderPlan();
}

function renderPlan() {
  const style = findStyle(state.active);
  const tab = state.planTab;
  const steps = tab === 'cut' ? style.cutSteps : tab === 'perm' ? style.perm.steps : style.colorPlan.steps;
  const intro = tab === 'cut' ? style.professionalSummary : tab === 'perm' ? style.perm.method : style.colorPlan.direction;
  const condition = $('#hair-condition').value;
  const conditionNote = condition === 'bleached' ? '客户补充：有漂发或明显受损记录。请先评估发束强度、弹性及项目兼容性，必要时调整目标或暂缓化学处理。' : condition === 'treated' ? '客户补充：有既往烫染记录。请先核实产品、时间、处理区域和当前发束状况。' : '先核实既往烫染记录、发束状态、实际底色与客户的日常打理习惯。';
  $('#plan-content').innerHTML = `${tab === 'color' ? `<div class="color-comparison"><div class="color-panel"><span class="swatch unknown-swatch"></span><div><p>当前底色</p><strong>待现场实测确认</strong></div></div><span class="color-arrow">→</span><div class="color-panel"><span class="swatch" style="--swatch:${style.color.hex}"></span><div><p>目标色方向 · 屏幕参考</p><strong>${style.color.name}</strong></div></div></div>` : ''}<p class="plan-intro">${escapeHTML(intro)}</p><ol class="plan-steps">${steps.map((step, index) => `<li><span>0${index + 1}</span><div>${escapeHTML(step)}</div></li>`).join('')}</ol><div class="plan-caution"><strong>落地前确认</strong><br>${escapeHTML(conditionNote)}<br>${escapeHTML(style.caution)}${tab === 'color' ? `<br>色阶方向：${escapeHTML(style.color.level)}。屏幕色块不代表染后实色。` : ''}<br>以上为预设咨询参考，不是针对当前客户生成的化学配方。具体比例、温度和停留时间需遵循品牌规范与现场测试。</div>`;
}

function planText() {
  const style = findStyle(state.active);
  const condition = $('#hair-condition').selectedOptions[0].textContent;
  return ['HAIR LAB · 发型设计沟通单', `方案：${style.name} / ${style.englishName}`, `图片类型：${label(style)}`, `目标色：${style.color.name}（${style.color.level}）`, `客户自述发况：${condition}`, `日常维护：${maintenance(style.maintenance)}`, `时长参考：${style.duration}`, '', '剪裁参考', ...style.cutSteps.map((step, index) => `${index + 1}. ${step}`), '', `烫发方向：${style.perm.method}`, ...style.perm.steps.map((step, index) => `${index + 1}. ${step}`), '', `染色方向：${style.colorPlan.direction}`, ...style.colorPlan.steps.map((step, index) => `${index + 1}. ${step}`), '', `注意：${style.caution}`, '预设咨询参考，不是当前客户的个性化化学配方。请由发型师结合底色、发质及品牌说明确定最终步骤。', '本沟通单不包含客户照片。'].join('\n');
}

async function copyPlan() {
  try { await navigator.clipboard.writeText(planText()); toast('方案已复制，可以整理成门店服务记录。'); }
  catch { downloadPlan(); toast('浏览器不支持复制，已改为下载沟通单。'); }
}

function downloadPlan() {
  const blob = new Blob(['\uFEFF', planText()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `HAIR-LAB-${findStyle(state.active).name}-沟通单.txt`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function loadImage(source) {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('照片无法解码，请重新选择 JPG、PNG 或 WebP 图片。')); image.src = source; });
}

async function acceptPhoto(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('请使用 JPG、PNG 或 WebP 图片。');
  if (file.size > 10 * 1024 * 1024) return toast('照片超过 10 MB，请压缩后再上传。');
  const request = ++state.photoLoad;
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (request !== state.photoLoad) return;
    const scale = Math.min(1, 1536 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', 0.9));
    toast('照片已载入。当前参考图不会自动替换为客户本人。');
  } catch (error) { if (request === state.photoLoad) toast(error.message); }
  finally { URL.revokeObjectURL(url); $('#photo-input').value = ''; }
}

function setPhoto(data) {
  state.photoLoad += 1;
  cancelGeneration();
  state.photo = data; state.images.clear();
  $('#customer-photo').hidden = !data;
  if (data) $('#customer-photo').src = data; else $('#customer-photo').removeAttribute('src');
  $('#empty-portrait').hidden = Boolean(data); $('#remove-photo').hidden = !data;
  $('#photo-badge').textContent = data ? '客户原照 · 本次会话' : '等待你的照片';
  $('#photo-consent').checked = false;
  $('#generation-status').hidden = true;
  ['#detail-dialog', '#compare-dialog'].forEach((selector) => { if ($(selector).open) $(selector).close(); });
  $('#detail-content').replaceChildren(); $('#compare-content').replaceChildren();
  renderCards(); renderCompareTray(); renderStylist();
}

function stopCamera() {
  state.cameraRequest += 1;
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null; $('#camera-video').srcObject = null;
  $('#capture-button').disabled = true;
}

async function startCamera() {
  if (!$('#camera-dialog').open) $('#camera-dialog').showModal();
  stopCamera();
  const request = state.cameraRequest;
  $('#camera-message').textContent = '正在请求摄像头权限…'; $('#camera-message').hidden = false;
  if (!navigator.mediaDevices?.getUserMedia) { $('#camera-message').textContent = '当前浏览器或连接不支持摄像头。请使用 HTTPS 安全连接，或直接上传照片。'; return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: state.facing }, width: { ideal: 1280 }, height: { ideal: 1600 } } });
    if (!$('#camera-dialog').open || request !== state.cameraRequest) { stream.getTracks().forEach((track) => track.stop()); return; }
    state.stream = stream; $('#camera-video').srcObject = stream;
    $('#camera-video').style.transform = state.facing === 'user' ? 'scaleX(-1)' : 'none';
    await $('#camera-video').play();
    if (request !== state.cameraRequest || !$('#camera-dialog').open) { stream.getTracks().forEach((track) => track.stop()); return; }
    $('#camera-message').hidden = true; $('#capture-button').disabled = false;
  } catch (error) {
    if (request !== state.cameraRequest) return;
    stopCamera();
    $('#camera-message').textContent = error.name === 'NotAllowedError' ? '未获得摄像头授权。你可以在浏览器中允许访问，或关闭此窗口后上传照片。' : error.name === 'NotFoundError' ? '没有找到可用的摄像头，请使用照片上传。' : '摄像头暂时不可用，可能正在被其他应用占用。请重试或上传照片。';
    $('#camera-message').hidden = false;
  }
}

function capture() {
  const video = $('#camera-video');
  if (!video.videoWidth || !video.videoHeight) return toast('摄像头画面还未准备好，请稍后再拍。');
  const canvas = document.createElement('canvas'); const scale = Math.min(1, 1536 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (state.facing === 'user') { context.translate(canvas.width, 0); context.scale(-1, 1); }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  setPhoto(canvas.toDataURL('image/jpeg', 0.9));
  $('#camera-dialog').close(); stopCamera(); toast('照片拍好了。你可以重新拍摄，也可以继续挑选风格。');
}

function updateServiceUI() {
  $('#mode-pill').innerHTML = `<i></i> ${OFFLINE_PREVIEW ? HOSTED_PREVIEW ? '在线参考体验' : '离线风格体验' : state.configured ? '图像服务已配置' : '风格体验模式'}`;
  $('#generate-button').innerHTML = state.configured ? '生成我的 6 款试发 <span>✧</span>' : '查看我的风格推荐 <span>✧</span>';
  $('#service-status').textContent = state.configured ? '图像服务已配置。上传照片并同意使用后，可请求生成个人试发效果；生成会产生服务费用。配置状态不代表生成结果已经验证。' : '当前为风格体验模式：可拍照、看参考、对比与查看理发师方案。真实换发型需由管理员接入图像编辑服务，现有参考图不是对客户照片的编辑。';
  if (OFFLINE_PREVIEW) $('#service-status').textContent = '当前为离线体验版，无需服务器和账号。可以上传照片、对比发型和查看理发师方案；照片不会在此版本中上传。展示的是示例模特，不是对客户照片的换发型效果。';
  if (HOSTED_PREVIEW) $('#service-status').textContent = '当前为在线参考体验版。可以拍照、上传照片、对比发型和查看理发师方案；照片仅保留在本机浏览器的当前会话，不会发送至图像服务。展示的是示例模特，不是客户本人换发型的效果。';
}

function cancelGeneration() {
  state.generation += 1;
  state.abort?.abort(); state.abort = null;
  state.busy = false; $('#generate-button').disabled = false;
  $('#generation-status').classList.remove('busy');
}

async function generate() {
  if (state.busy) return;
  setFilter('all');
  if (!state.configured) {
    toast('已按偏好整理 6 款参考。当前未接入真实试发，展示的仍是示例模特。');
    if (window.innerWidth < 580) $('.recommendations').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (!state.photo) return toast('请先上传或拍摄客户照片。');
  if (!$('#photo-consent').checked) return toast('请先确认客户已同意照片用于试发，并知晓照片将发送至图像服务。');
  if (!window.confirm('将使用当前客户照片生成 6 款发型，照片会发送至图像服务，并产生 6 次图像生成费用。生成可能需要数分钟。是否开始？')) return;
  const token = ++state.generation; const original = state.photo;
  state.busy = true; $('#generate-button').disabled = true;
  state.images.clear(); renderCards(); renderCompareTray();
  const status = $('#generation-status'); status.hidden = false; status.classList.add('busy');
  let success = 0, failures = 0;
  const styles = sortedStyles();
  for (let index = 0; index < styles.length; index++) {
    if (token !== state.generation) return;
    const style = styles[index];
    status.textContent = `正在生成第 ${index + 1} / 6 款：${style.name}。已完成 ${success} 款，请保持页面打开。`;
    state.abort = new AbortController();
    try {
      const response = await fetch('/api/try-on', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: original, prompt: `${style.name} / ${style.englishName}. Hair length: ${style.length}; texture: ${style.texture}. Hair color: ${style.color.name}. ${style.description} ${style.professionalSummary} Preserve the original face and identity. Only change the hair. One single portrait, no grid, no text.` }), signal: state.abort.signal });
      const result = await response.json();
      if (token !== state.generation) return;
      if (!response.ok) {
        if (result.code === 'IMAGE_SERVICE_NOT_CONFIGURED') { state.configured = false; updateServiceUI(); throw new Error('图像服务未配置，已停止生成。'); }
        failures++; toast(result.error || '这一款生成失败，继续尝试下一款。'); continue;
      }
      if (typeof result.image !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(result.image)) throw new Error('图像服务没有返回可用图片。');
      await loadImage(result.image);
      if (token !== state.generation) return;
      state.images.set(style.id, result.image); success++;
      renderCards(); renderCompareTray(); if (state.view === 'stylist') renderStylist();
    } catch (error) {
      if (token !== state.generation || error.name === 'AbortError') return;
      failures++; toast(error.message || '网络暂时不可用，请稍后重试。');
      if (!state.configured) break;
    }
  }
  if (token !== state.generation) return;
  state.busy = false; state.abort = null; $('#generate-button').disabled = false; status.classList.remove('busy');
  status.textContent = success === 6 ? '6 款个人试发已生成。图像仅用于沟通，实际剪裁和染后色彩需与发型师确认。' : `已生成 ${success} / 6 款个人试发${failures ? `，${failures} 款请求失败` : ''}。没有生成的方案继续显示示例模特，并已单独标注。`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.detail) showDetail(button.dataset.detail);
  if (button.dataset.compare) toggleCompare(button.dataset.compare);
  if (button.dataset.filter) setFilter(button.dataset.filter);
  if (button.dataset.view) setView(button.dataset.view);
  if (button.dataset.close) $(`#${button.dataset.close}`).close();
  if (button.dataset.stylist) { state.active = button.dataset.stylist; renderStylist(); }
  if (button.dataset.planTab) { state.planTab = button.dataset.planTab; renderStylist(); }
  if (button.dataset.sendStylist) { state.active = button.dataset.sendStylist; $$('dialog[open]').forEach((dialog) => dialog.close()); setView('stylist'); }
  if (button.id === 'copy-plan') copyPlan();
});

$('#upload-button').addEventListener('click', () => $('#photo-input').click());
$('#photo-input').addEventListener('change', (event) => acceptPhoto(event.target.files[0]));
$('#remove-photo').addEventListener('click', () => { setPhoto(null); toast('客户照片与本次生成效果已移除。'); });
$('#camera-button').addEventListener('click', startCamera);
$('#switch-camera').addEventListener('click', () => { state.facing = state.facing === 'user' ? 'environment' : 'user'; startCamera(); });
$('#capture-button').addEventListener('click', capture);
$('#camera-dialog').addEventListener('close', stopCamera);
$('#camera-dialog').addEventListener('cancel', stopCamera);
$('#generate-button').addEventListener('click', generate);
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#open-stylist').addEventListener('click', () => setView('stylist'));
$('#download-plan').addEventListener('click', downloadPlan);
$('#compare-button').addEventListener('click', showComparison);
$('#clear-compare').addEventListener('click', () => { state.compare.clear(); renderCards(); renderCompareTray(); });
['#length-pref', '#time-pref'].forEach((selector) => $(selector).addEventListener('change', () => { renderCards(); }));
$('#hair-condition').addEventListener('change', () => { if (!$('#stylist-view').hidden) renderStylist(); });
$('#photo-zone').addEventListener('dragover', (event) => { event.preventDefault(); });
$('#photo-zone').addEventListener('drop', (event) => { event.preventDefault(); acceptPhoto(event.dataTransfer.files[0]); });
window.addEventListener('pagehide', () => { stopCamera(); state.abort?.abort(); });

renderCards(); renderStylist(); updateServiceUI();
if (!OFFLINE_PREVIEW) fetch('/api/status').then((response) => response.ok ? response.json() : Promise.reject()).then((result) => { state.configured = result.imageEditingConfigured === true; updateServiceUI(); }).catch(() => { state.configured = false; updateServiceUI(); toast('暂时无法读取服务状态，当前仅展示风格参考。'); });
