"use strict";
const $ = id => document.getElementById(id);
const view = $('view'), vctx = view.getContext('2d');
const paper = document.createElement('canvas'), pctx = paper.getContext('2d');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

let source = null, sourceKey = '', running = false, abort = false, skipFlag = false, genCtl = null;
let lastImageBlob = null, lastVideoBlob = null, lastVideoExt = 'webm';
let currentPlan = null;

/* ------------------------------------------------------------------ UI helpers */
function setStatus(t) { $('status').textContent = t; }
function setBar(f) { $('barfill').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
function setBusy(b) {
  $('skip').disabled = !b; $('stop').disabled = !b;
  ['shape', 'detail', 'colors', 'speed', 'oOutline', 'oFill', 'oBg', 'oRec', 'file', 'demo', 'prompt'].forEach(i => $(i).disabled = b);
  refreshStart();
}
function refreshStart() {
  const t = $('prompt').value.trim();
  $('start').textContent = t && sourceKey !== 'p:' + t ? 'Create & draw' : 'Start drawing';
  $('start').disabled = running || (!source && !t);
  $('renew').disabled = running || !t;
}
function readOpts() {
  return { colors: +$('colors').value, seconds: +$('speed').value, outlines: $('oOutline').checked,
           fill: $('oFill').checked, bg: $('oBg').checked, record: $('oRec').checked };
}

/* ------------------------------------------------------------------ creating a picture from words */
// One small function talks to the online image service. To use a different service, change only this part.
const STYLE = ', simple cartoon illustration, thick clean black outlines, flat solid colors, coloring book style, plain white background';
function promptDims() {
  const s = $('shape').value; let r = 1;
  if (s !== 'auto') { const [a, b] = s.split(':').map(Number); r = a / b; }
  let w, h; if (r >= 1) { w = 768; h = Math.round(768 / r); } else { h = 768; w = Math.round(768 * r); }
  return [w - (w % 8), h - (h % 8)];
}
async function fetchPicture(text) {
  const [w, h] = promptDims(), seed = Math.floor(Math.random() * 1e6);
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(text + STYLE) +
              '?width=' + w + '&height=' + h + '&seed=' + seed + '&nologo=true&safe=true';
  genCtl = new AbortController(); const sig = genCtl.signal, timer = setTimeout(() => genCtl.abort(), 120000);
  try {
    let res = null;
    try { res = await fetch(url, { signal: sig }); } catch (e) { if (sig.aborted) throw e; }
    if (res) {
      if (res.status === 402 || res.status === 429) throw new Error('busy');
      if (!res.ok) throw new Error('http ' + res.status);
      const blob = await res.blob(); if (!/^image\//.test(blob.type)) throw new Error('not an image');
      return await createImageBitmap(blob);
    }
    return await new Promise((ok, no) => {                      // the browser refused fetch(): try a plain image
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => ok(im); im.onerror = () => no(new Error('blocked'));
      sig.addEventListener('abort', () => no(new Error('aborted'))); im.src = url;
    });
  } finally { clearTimeout(timer); genCtl = null; }
}
function friendly(e) {
  const m = e && e.message ? e.message : String(e);
  if (abort) return 'Stopped.';
  if (m === 'busy') return 'The free picture service is busy right now (it allows about one picture every 45 seconds). Wait a moment and try again.';
  if (m === 'aborted' || (e && e.name === 'AbortError')) return 'Creating the picture took too long. Try again, or choose a picture instead.';
  if (m === 'blocked' || m === 'Failed to fetch' || m === 'not an image' || /^http/.test(m)) return "Couldn't create the picture. Check your internet connection, or choose a picture instead.";
  return 'Something went wrong: ' + m;
}

/* ------------------------------------------------------------------ canvas layout */
function layout() {
  const detail = +$('detail').value, shape = $('shape').value;
  const iw = source ? source.width : 4, ih = source ? source.height : 5;
  let r = iw / ih;
  if (shape !== 'auto') { const [a, b] = shape.split(':').map(Number); r = a / b; }
  let W, H;
  if (r >= 1) { W = detail; H = Math.round(detail / r); } else { H = detail; W = Math.round(detail * r); }
  W += W & 1; H += H & 1;
  const fit = Math.min(W / iw, H / ih) * (shape === 'auto' ? 1 : 0.94);
  const w = Math.max(8, Math.round(iw * fit)), h = Math.max(8, Math.round(ih * fit));
  return { W, H, w, h, ox: Math.floor((W - w) / 2), oy: Math.floor((H - h) / 2) };
}
function sizeCanvases(W, H) {
  for (const c of [view, paper]) { c.width = W; c.height = H; }
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, W, H);
}
function showPreview() {
  const L = layout();
  sizeCanvases(L.W, L.H);
  if (source) pctx.drawImage(source, L.ox, L.oy, L.w, L.h);
  else { pctx.fillStyle = '#9a978f'; pctx.font = '16px system-ui,sans-serif'; pctx.textAlign = 'center';
         pctx.fillText('Your drawing appears here', L.W / 2, L.H / 2); }
  vctx.drawImage(paper, 0, 0);
}

/* ------------------------------------------------------------------ loading a picture */
function setSource(el, iw, ih, key = 'file') {
  const s = Math.min(1, 1600 / Math.max(iw, ih));
  const c = mk(Math.max(1, Math.round(iw * s)), Math.max(1, Math.round(ih * s)));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high'; x.drawImage(el, 0, 0, c.width, c.height);
  source = c; sourceKey = key; if (key.slice(0, 2) !== 'p:') $('prompt').value = '';
  $('saves').hidden = true; clearPalette(); setBar(0);
  showPreview(); setStatus('Picture ready. Press Start drawing.'); refreshStart();
}
$('file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try { const b = await createImageBitmap(f); setSource(b, b.width, b.height); }
  catch (_) {
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => { setSource(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); };
    img.onerror = () => setStatus("That picture couldn't be opened.");
    img.src = url;
  }
  e.target.value = '';
});
['shape', 'detail'].forEach(id => $(id).addEventListener('change', () => { if (!running) showPreview(); }));
$('colors').addEventListener('input', () => $('colorsOut').textContent = $('colors').value);

function makeDemo() {
  const c = mk(600, 750), x = c.getContext('2d');
  x.fillStyle = '#a9d6ea'; x.fillRect(0, 0, 600, 750);
  x.fillStyle = '#c9a074'; x.fillRect(0, 640, 600, 110);
  x.lineJoin = 'round'; x.lineCap = 'round'; x.strokeStyle = '#111'; x.lineWidth = 6;
  x.beginPath(); x.moveTo(0, 640); x.lineTo(600, 640); x.stroke();
  // window
  x.fillStyle = '#fff'; x.fillRect(380, 60, 190, 190); x.strokeRect(380, 60, 190, 190);
  x.fillStyle = '#7fc4d4'; x.fillRect(392, 72, 80, 80); x.fillRect(478, 72, 80, 80); x.fillRect(392, 158, 80, 80); x.fillRect(478, 158, 80, 80);
  x.lineWidth = 4; for (const [a, b] of [[392, 72], [478, 72], [392, 158], [478, 158]]) x.strokeRect(a, b, 80, 80);
  // trunk
  x.lineWidth = 6; x.fillStyle = '#8b5a2b'; x.fillRect(268, 560, 64, 80); x.strokeRect(268, 560, 64, 80);
  // tree tiers
  const tier = (cx, top, bot, hw) => {
    x.beginPath(); x.moveTo(cx, top);
    x.quadraticCurveTo(cx + hw * 0.45, (top + bot) / 2 - 10, cx + hw, bot - 26);
    for (let i = 0; i < 3; i++) {
      const x0 = cx + hw - (i * 2 * hw) / 3, x1 = cx + hw - ((i + 1) * 2 * hw) / 3;
      x.quadraticCurveTo((x0 + x1) / 2, bot + 24, x1, bot - 26);
    }
    x.quadraticCurveTo(cx - hw * 0.45, (top + bot) / 2 - 10, cx, top);
    x.closePath(); x.fillStyle = '#2fa84f'; x.fill(); x.stroke();
  };
  tier(300, 150, 360, 120); tier(300, 250, 470, 160); tier(300, 360, 590, 205);
  // star
  x.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 20 : 46, a = -Math.PI / 2 + (i * Math.PI) / 5; x.lineTo(300 + r * Math.cos(a), 128 + r * Math.sin(a)); }
  x.closePath(); x.fillStyle = '#ffd21f'; x.fill(); x.stroke();
  // ornaments
  const orb = (px, py, col) => { x.beginPath(); x.arc(px, py, 16, 0, 7); x.fillStyle = col; x.fill(); x.lineWidth = 4; x.stroke(); x.lineWidth = 6; };
  orb(262, 300, '#e5262f'); orb(340, 330, '#ffd21f'); orb(220, 430, '#ffd21f'); orb(310, 440, '#e5262f');
  orb(390, 500, '#e5262f'); orb(210, 540, '#e5262f'); orb(320, 560, '#ffd21f'); orb(280, 215, '#ffd21f');
  // gifts
  const gift = (gx, gy, gw, gh, col, rib) => {
    x.fillStyle = col; x.fillRect(gx, gy, gw, gh); x.strokeRect(gx, gy, gw, gh);
    x.fillStyle = rib; x.fillRect(gx + gw / 2 - 8, gy, 16, gh); x.lineWidth = 4; x.strokeRect(gx + gw / 2 - 8, gy, 16, gh); x.lineWidth = 6;
  };
  gift(60, 560, 110, 90, '#e5262f', '#2fa84f'); gift(440, 575, 90, 75, '#f4d21f', '#2fa84f'); gift(170, 600, 70, 55, '#2a9bd6', '#e5262f');
  setSource(c, c.width, c.height, 'demo');
}
$('demo').addEventListener('click', makeDemo);

/* ------------------------------------------------------------------ color + geometry helpers */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const lf = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
function rgb2lab(r, g, b, out, o) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const fx = lf((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
  const fy = lf(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const fz = lf((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  out[o] = 116 * fy - 16; out[o + 1] = 500 * (fx - fy); out[o + 2] = 200 * (fy - fz);
}
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function getPixels(src, w, h) {
  let cur = src;
  while (cur.width > w * 2 && cur.height > h * 2) {            // step down for clean downscaling
    const half = mk(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2));
    const hc = half.getContext('2d'); hc.imageSmoothingQuality = 'high'; hc.drawImage(cur, 0, 0, half.width, half.height); cur = half;
  }
  const c = mk(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, w, h);
  return x.getImageData(0, 0, w, h).data;
}

function dilate(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) out[yy * w + xx] = 1; } }
  }
  return out;
}
function removeSmall(mask, w, h, minSize) {                    // 8-connected components below minSize are dropped
  const n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, size = 0; stack[sp++] = s; seen[s] = 1; const members = [];
    while (sp) {
      const p = stack[--sp]; size++; members.push(p);
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } } }
    }
    if (size < minSize) for (const p of members) mask[p] = 0;
  }
}
function sobelMask(gray, w, h) {
  const mag = new Uint16Array(w * h), hist = new Uint32Array(256);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const gx = -gray[p - w - 1] - 2 * gray[p - 1] - gray[p + w - 1] + gray[p - w + 1] + 2 * gray[p + 1] + gray[p + w + 1];
    const gy = -gray[p - w - 1] - 2 * gray[p - w] - gray[p - w + 1] + gray[p + w - 1] + 2 * gray[p + w] + gray[p + w + 1];
    const m = Math.min(1020, Math.abs(gx) + Math.abs(gy)); mag[p] = m; hist[m >> 2]++;
  }
  let acc = 0, thr = 60; const want = 0.07 * w * h;
  for (let b = 255; b >= 0; b--) { acc += hist[b]; if (acc >= want) { thr = Math.max(60, b * 4); break; } }
  const out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = mag[i] >= thr ? 1 : 0;
  return out;
}
function skeletonize(mask, w, h) {                              // Zhang-Suen thinning
  const m = Uint8Array.from(mask), rm = []; let changed = true, guard = 0;
  while (changed && guard++ < 60) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      rm.length = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const p = y * w + x; if (!m[p]) continue;
        const p2 = m[p - w], p3 = m[p - w + 1], p4 = m[p + 1], p5 = m[p + w + 1], p6 = m[p + w], p7 = m[p + w - 1], p8 = m[p - 1], p9 = m[p - w - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (step === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; } else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
        rm.push(p);
      }
      if (rm.length) { changed = true; for (const p of rm) m[p] = 0; }
    }
  }
  return m;
}
function distance(mask, w, h) {                                 // chamfer 3-4 distance to background
  const INF = 1e6, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (!d[p]) continue; let v = d[p];
    if (x > 0) v = Math.min(v, d[p - 1] + 3); if (y > 0) { v = Math.min(v, d[p - w] + 3);
      if (x > 0) v = Math.min(v, d[p - w - 1] + 4); if (x < w - 1) v = Math.min(v, d[p - w + 1] + 4); }
    d[p] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x; if (!d[p]) continue; let v = d[p];
    if (x < w - 1) v = Math.min(v, d[p + 1] + 3); if (y < h - 1) { v = Math.min(v, d[p + w] + 3);
      if (x < w - 1) v = Math.min(v, d[p + w + 1] + 4); if (x > 0) v = Math.min(v, d[p + w - 1] + 4); }
    d[p] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i], 30) / 3; // in pixels (edge pixel = 1)
  return d;
}
function simplify(p, eps) {                                     // Douglas-Peucker on flat [x,y,...]
  const n = p.length / 2; if (n < 3) return p;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1; const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const ax = p[2 * a], ay = p[2 * a + 1], dx = p[2 * b] - ax, dy = p[2 * b + 1] - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[2 * i] - ax) * dy - (p[2 * i + 1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]); return out;
}
function runsFromMask(mask, w, h) {                             // [y,x0,x1,...]
  const runs = [];
  for (let y = 0; y < h; y++) { let x = 0;
    while (x < w) { if (!mask[y * w + x]) { x++; continue; } const s = x; while (x < w && mask[y * w + x]) x++; runs.push(y, s, x - 1); } }
  return runs;
}

/* ------------------------------------------------------------------ k-means palette */
function kmeans(pts, k, iters) {
  const m = pts.length / 3; let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const C = new Float32Array(3 * k), D = new Float32Array(m).fill(1e30);
  let first = Math.floor(rnd() * m); C.set(pts.subarray(3 * first, 3 * first + 3), 0);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const dl = pts[3 * i] - C[3 * (c - 1)], da = pts[3 * i + 1] - C[3 * (c - 1) + 1], db = pts[3 * i + 2] - C[3 * (c - 1) + 2];
      const d = dl * dl + da * da + db * db; if (d < D[i]) D[i] = d; sum += D[i];
    }
    let r = rnd() * sum, pick = m - 1; for (let i = 0; i < m; i++) { r -= D[i]; if (r <= 0) { pick = i; break; } }
    C.set(pts.subarray(3 * pick, 3 * pick + 3), 3 * c);
  }
  const asg = new Uint8Array(m);
  for (let it = 0; it < iters; it++) {
    const S = new Float64Array(3 * k), N = new Uint32Array(k);
    for (let i = 0; i < m; i++) {
      let best = 0, bd = 1e30;
      for (let c = 0; c < k; c++) { const dl = pts[3 * i] - C[3 * c], da = pts[3 * i + 1] - C[3 * c + 1], db = pts[3 * i + 2] - C[3 * c + 2];
        const d = dl * dl + da * da + db * db; if (d < bd) { bd = d; best = c; } }
      asg[i] = best; S[3 * best] += pts[3 * i]; S[3 * best + 1] += pts[3 * i + 1]; S[3 * best + 2] += pts[3 * i + 2]; N[best]++;
    }
    for (let c = 0; c < k; c++) if (N[c]) { C[3 * c] = S[3 * c] / N[c]; C[3 * c + 1] = S[3 * c + 1] / N[c]; C[3 * c + 2] = S[3 * c + 2] / N[c]; }
  }
  return C;
}

/* ------------------------------------------------------------------ the plan: outlines, palette, fills */
const NONE = 255, WHITE = 254;
function buildPlan(src, L, o) {
  const { w, h } = L, n = w * h;
  const rgba = getPixels(src, w, h);
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) gray[i] = (rgba[4 * i] * 77 + rgba[4 * i + 1] * 150 + rgba[4 * i + 2] * 29) >> 8;

  // 1) the picture's own dark lines (or edges, for photos)
  let line = new Uint8Array(n), cnt = 0;
  for (let i = 0; i < n; i++)                                   // dark in every channel, so red or brown never count as lines
    if (gray[i] < 100 && Math.max(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]) < 110) { line[i] = 1; cnt++; }
  let mode = 'lines';
  if (cnt / n < 0.004 || cnt / n > 0.35) { line = sobelMask(gray, w, h); mode = 'edges'; }
  removeSmall(line, w, h, Math.max(mode === 'lines' ? 5 : 8, Math.round(n / 50000)));
  let lr = 0, lg = 0, lb = 0, lc = 0;
  for (let i = 0; i < n; i++) if (line[i]) { lr += rgba[4 * i]; lg += rgba[4 * i + 1]; lb += rgba[4 * i + 2]; lc++; }
  let lineRGB = lc && mode === 'lines' ? [lr / lc, lg / lc, lb / lc] : [28, 28, 28];
  if (lineRGB[0] + lineRGB[1] + lineRGB[2] > 270) lineRGB = [28, 28, 28];
  const lineColor = hex(...lineRGB);
  const wide = dilate(line, w, h);

  // 2) palette from the non-line pixels
  const lab = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) rgb2lab(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2], lab, 3 * i);
  const idx = []; for (let i = 0; i < n; i++) if (!wide[i]) idx.push(i);
  const useAll = idx.length < 200; if (useAll) { idx.length = 0; for (let i = 0; i < n; i++) idx.push(i); }
  const step = Math.max(1, Math.floor(idx.length / 9000)), samp = [];
  for (let i = 0; i < idx.length; i += step) samp.push(idx[i]);
  const pts = new Float32Array(3 * samp.length);
  samp.forEach((p, j) => { pts[3 * j] = lab[3 * p]; pts[3 * j + 1] = lab[3 * p + 1]; pts[3 * j + 2] = lab[3 * p + 2]; });
  let K = Math.min(o.colors, Math.max(1, samp.length));
  let C = Array.from(kmeans(pts, K, 10));
  let cents = []; for (let c = 0; c < K; c++) cents.push([C[3 * c], C[3 * c + 1], C[3 * c + 2], 1]);
  // merge near-duplicates
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < cents.length && !again; i++) for (let j = i + 1; j < cents.length; j++)
      if (dist(cents[i], cents[j]) < 7) { cents.splice(j, 1); again = true; break; }
  }
  K = cents.length;

  // 3) label every pixel with its nearest palette color
  const labels = new Uint8Array(n).fill(NONE), count = new Float64Array(K), sum = new Float64Array(3 * K);
  for (let i = 0; i < n; i++) {
    if (!useAll && wide[i]) continue;
    const l = lab[3 * i], a = lab[3 * i + 1], b = lab[3 * i + 2]; let best = 0, bd = 1e30;
    for (let c = 0; c < K; c++) { const t = cents[c], d = (l - t[0]) ** 2 + (a - t[1]) ** 2 + (b - t[2]) ** 2; if (d < bd) { bd = d; best = c; } }
    labels[i] = best; count[best]++; sum[3 * best] += rgba[4 * i]; sum[3 * best + 1] += rgba[4 * i + 1]; sum[3 * best + 2] += rgba[4 * i + 2];
  }
  // pixels under / next to the lines take the nearest region color (so colors reach right up to the lines)
  { const q = new Int32Array(n); let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) if (labels[i] !== NONE) {
      const x = i % w, y = (i / w) | 0;
      if ((x > 0 && labels[i - 1] === NONE) || (x < w - 1 && labels[i + 1] === NONE) || (y > 0 && labels[i - w] === NONE) || (y < h - 1 && labels[i + w] === NONE)) q[qt++] = i;
    }
    while (qh < qt) { const p = q[qh++], x = p % w, y = (p / w) | 0, l = labels[p];
      if (x > 0 && labels[p - 1] === NONE) { labels[p - 1] = l; q[qt++] = p - 1; }
      if (x < w - 1 && labels[p + 1] === NONE) { labels[p + 1] = l; q[qt++] = p + 1; }
      if (y > 0 && labels[p - w] === NONE) { labels[p - w] = l; q[qt++] = p - w; }
      if (y < h - 1 && labels[p + w] === NONE) { labels[p + w] = l; q[qt++] = p + w; } }
    for (let i = 0; i < n; i++) if (labels[i] === NONE) labels[i] = 0;
  }
  // remove lonely specks
  for (let pass = 0; pass < 2; pass++) {
    const src2 = Uint8Array.from(labels), tally = new Uint16Array(K);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, me = src2[p]; let same = 0; tally.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const v = src2[p + dy * w + dx]; tally[v]++; if (v === me) same++; }
      if (same <= 1) { let b = me, bc = 0; for (let c = 0; c < K; c++) if (tally[c] > bc) { bc = tally[c]; b = c; } labels[p] = b; }
    }
  }
  // palette (sorted later by area); near-white colors are left as white paper
  const pal = [];
  for (let c = 0; c < K; c++) {
    const r = count[c] ? sum[3 * c] / count[c] : 255, g = count[c] ? sum[3 * c + 1] / count[c] : 255, b = count[c] ? sum[3 * c + 2] / count[c] : 255;
    const t = cents[c]; pal.push({ rgb: [r, g, b], hex: hex(r, g, b), skip: t[0] > 93 && Math.hypot(t[1], t[2]) < 8 });
  }
  for (let i = 0; i < n; i++) if (pal[labels[i]].skip) labels[i] = WHITE;
  if (!o.bg) {                                                  // leave the background white
    const bc = new Uint32Array(K + 1); const edge = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
    for (const p of edge) if (labels[p] < K) bc[labels[p]]++;
    let bl = -1, bm = 0; for (let c = 0; c < K; c++) if (bc[c] > bm) { bm = bc[c]; bl = c; }
    if (bl >= 0) { const st = []; for (const p of edge) if (labels[p] === bl) { labels[p] = WHITE; st.push(p); }
      while (st.length) { const p = st.pop(), x = p % w, y = (p / w) | 0;
        for (const [qx, qy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx; if (labels[q] === bl) { labels[q] = WHITE; st.push(q); } } } }
  }
  if (o.outlines) for (let i = 0; i < n; i++) if (line[i]) labels[i] = NONE;   // colors never cover the lines

  // 4) fill regions: connected same-color areas, biggest colors first
  const area = new Float64Array(K); for (let i = 0; i < n; i++) if (labels[i] < K) area[labels[i]]++;
  const order = [...Array(K).keys()].filter(c => area[c] > 0).sort((a, b) => area[b] - area[a]);
  const rank = new Int16Array(K).fill(-1); order.forEach((c, r) => rank[c] = r);
  const comp = new Int32Array(n), stack = new Int32Array(n), compInfo = []; let cc = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] || labels[s] >= K) continue;
    const lab0 = labels[s]; cc++; let sp = 0; stack[sp++] = s; comp[s] = cc; let size = 0;
    while (sp) { const p = stack[--sp]; size++; const x = p % w, y = (p / w) | 0;
      if (x > 0 && !comp[p - 1] && labels[p - 1] === lab0) { comp[p - 1] = cc; stack[sp++] = p - 1; }
      if (x < w - 1 && !comp[p + 1] && labels[p + 1] === lab0) { comp[p + 1] = cc; stack[sp++] = p + 1; }
      if (y > 0 && !comp[p - w] && labels[p - w] === lab0) { comp[p - w] = cc; stack[sp++] = p - w; }
      if (y < h - 1 && !comp[p + w] && labels[p + w] === lab0) { comp[p + w] = cc; stack[sp++] = p + w; } }
    compInfo[cc] = { label: lab0, size, runs: [] };
  }
  for (let y = 0; y < h; y++) { let x = 0;
    while (x < w) { const id = comp[y * w + x]; if (!id) { x++; continue; } const s0 = x; while (x < w && comp[y * w + x] === id) x++; compInfo[id].runs.push(y, s0, x - 1); } }
  const comps = compInfo.filter(Boolean).sort((a, b) => rank[a.label] - rank[b.label])
    .map(c => ({ rank: rank[c.label], color: pal[c.label].hex, px: c.size, runs: Int32Array.from(c.runs) }));

  // 5) outline strokes from the skeleton of the line mask
  let strokes = [], polish = [];
  if (o.outlines) {
    polish = runsFromMask(line, w, h);
    const skel = skeletonize(line, w, h), dt = distance(line, w, h), vis = new Uint8Array(n);
    const nb = p => { let c = 0; const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && skel[yy * w + xx]) c++; } return c; };
    const starts = [], rest = [];
    for (let p = 0; p < n; p++) if (skel[p]) (nb(p) === 1 ? starts : rest).push(p);
    const raw = [];
    const walk = s => {
      const pts = [s % w + 0.5, ((s / w) | 0) + 0.5]; let wsum = dt[s]; vis[s] = 1; let p = s, dx0 = 0, dy0 = 0;
      for (;;) {
        const x = p % w, y = (p / w) | 0; let best = -1, bs = -9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = yy * w + xx; if (!skel[q] || vis[q]) continue;
          const sc = (dx * dx0 + dy * dy0) / Math.hypot(dx, dy) - (dx && dy ? 0.05 : 0); if (sc > bs) { bs = sc; best = q; } }
        if (best < 0) break; const nx = best % w, ny = (best / w) | 0; dx0 = nx - x; dy0 = ny - y; vis[best] = 1; p = best;
        pts.push(nx + 0.5, ny + 0.5); wsum += dt[best];
      }
      return { pts: simplify(pts, 0.7), w: Math.min(14, Math.max(1.4, 2 * wsum / (pts.length / 2))) };
    };
    for (const s of starts) if (!vis[s]) raw.push(walk(s));
    for (const s of rest) if (!vis[s]) raw.push(walk(s));
    // order strokes so the pen travels as little as possible
    const left = raw.filter(s => s.pts.length >= 4 || s.w > 2); let cx = 0, cy = 0;
    while (left.length) {
      let bi = 0, br = false, bd = 1e30;
      for (let i = 0; i < left.length; i++) { const p = left[i].pts, e = p.length;
        const d1 = (p[0] - cx) ** 2 + (p[1] - cy) ** 2, d2 = (p[e - 2] - cx) ** 2 + (p[e - 1] - cy) ** 2;
        if (d1 < bd) { bd = d1; bi = i; br = false; } if (d2 < bd) { bd = d2; bi = i; br = true; } }
      const s = left.splice(bi, 1)[0];
      if (br) { const r = []; for (let i = s.pts.length - 2; i >= 0; i -= 2) r.push(s.pts[i], s.pts[i + 1]); s.pts = r; }
      let len = 0; for (let i = 2; i < s.pts.length; i += 2) len += Math.hypot(s.pts[i] - s.pts[i - 2], s.pts[i + 1] - s.pts[i - 1]);
      s.len = len; strokes.push(s); cx = s.pts[s.pts.length - 2]; cy = s.pts[s.pts.length - 1];
    }
  }
  const palette = order.map(c => ({ hex: pal[c].hex }));
  return { w, h, ox: L.ox, oy: L.oy, lineColor, strokes, polish, comps, palette, mode,
           strokeLen: strokes.reduce((a, s) => a + s.len, 0), fillPx: comps.reduce((a, c) => a + c.px, 0) };
}

/* ------------------------------------------------------------------ palette strip */
function clearPalette() { $('palette').replaceChildren(); }
function renderPalette(plan, withOutline) {
  const box = $('palette'); box.replaceChildren();
  const add = (color, cls, title) => { const d = document.createElement('div'); d.className = 'sw ' + cls; d.style.background = color; d.title = title; box.appendChild(d); return d; };
  const sw = [];
  if (withOutline) sw.push(add(plan.lineColor, 'line', 'Outline'));
  plan.palette.forEach((p, i) => sw.push(add(p.hex, '', 'Color ' + (i + 1))));
  return { sw, offset: withOutline ? 1 : 0 };
}
function highlight(pal, active) {                               // active index into pal.sw
  pal.sw.forEach((el, i) => { el.classList.toggle('done', i < active); el.classList.toggle('on', i === active); });
}

/* ------------------------------------------------------------------ the pen */
function drawPen(x, y, color) {
  const k = Math.max(1.1, view.width / 380);
  vctx.save(); vctx.translate(x, y); vctx.scale(k, k); vctx.lineJoin = 'round';
  const poly = (pts, fill) => { vctx.beginPath(); pts.forEach(([a, b], i) => i ? vctx.lineTo(a, b) : vctx.moveTo(a, b)); vctx.closePath(); vctx.fillStyle = fill; vctx.fill(); vctx.strokeStyle = 'rgba(0,0,0,.55)'; vctx.lineWidth = 0.8; vctx.stroke(); };
  poly([[0, 0], [3, -9], [9, -3]], '#f0cf9b');
  poly([[3, -9], [9, -3], [25, -19], [19, -25]], color);
  poly([[19, -25], [25, -19], [28, -22], [22, -28]], '#8a8a8a');
  poly([[0, 0], [1.6, -4.8], [4.8, -1.6]], '#222');
  vctx.restore();
}

/* ------------------------------------------------------------------ the two drawing phases */
function makeOutline(plan) {
  const S = plan.strokes;
  return { name: 'outline', total: Math.max(1, plan.strokeLen), done: 0, si: 0, pi: 0, x: 0, y: 0, finished: false, color: plan.lineColor,
    advance(b) {
      const c = pctx; c.strokeStyle = plan.lineColor; c.lineCap = 'round'; c.lineJoin = 'round'; let drawing = false;
      while (b > 0 && this.si < S.length) {
        const s = S[this.si], p = s.pts;
        if (this.pi === 0) { this.x = p[0]; this.y = p[1]; this.pi = 1; }
        if (!drawing) { c.lineWidth = s.w; c.beginPath(); c.moveTo(this.x, this.y); drawing = true; }
        if (this.pi * 2 >= p.length) { c.stroke(); drawing = false; this.si++; this.pi = 0; continue; }
        const tx = p[this.pi * 2], ty = p[this.pi * 2 + 1], dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
        if (d <= b) { c.lineTo(tx, ty); this.x = tx; this.y = ty; b -= d; this.done += d; this.pi++; }
        else { const f = b / d; this.x += dx * f; this.y += dy * f; c.lineTo(this.x, this.y); this.done += b; b = 0; }
      }
      if (drawing) c.stroke();
      this.finished = this.si >= S.length;
    },
    leave() {                                                   // make the outline match the picture exactly
      pctx.setTransform(1, 0, 0, 1, plan.ox, plan.oy); pctx.fillStyle = plan.lineColor;
      const R = plan.polish; for (let i = 0; i < R.length; i += 3) pctx.fillRect(R[i + 1], R[i], R[i + 2] - R[i + 1] + 1, 1);
      pctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    label() { return 'Drawing outlines… ' + Math.min(100, Math.round(100 * this.done / this.total)) + '%'; },
    paletteIndex() { return 0; }
  };
}
function makeFill(plan) {
  const C = plan.comps, nColors = plan.palette.length;
  return { name: 'fill', total: Math.max(1, plan.fillPx), done: 0, ci: 0, ri: 0, off: 0, x: 0, y: 0, finished: false, color: C.length ? C[0].color : '#000',
    advance(b) {
      const c = pctx;
      while (b > 0 && this.ci < C.length) {
        const comp = C[this.ci], R = comp.runs;
        if (this.ri * 3 >= R.length) { this.ci++; this.ri = 0; this.off = 0; continue; }
        c.fillStyle = comp.color; this.color = comp.color;
        const y = R[this.ri * 3], x0 = R[this.ri * 3 + 1] + this.off, len = R[this.ri * 3 + 2] - x0 + 1;
        if (len <= b) { c.fillRect(x0, y, len, 1); b -= len; this.done += len; this.ri++; this.off = 0; this.x = x0 + len; this.y = y + 0.5; }
        else { c.fillRect(x0, y, b, 1); this.off += b; this.done += b; this.x = x0 + b; this.y = y + 0.5; b = 0; }
      }
      this.finished = this.ci >= C.length;
    },
    leave() {},
    label() { const r = this.ci < C.length ? C[this.ci].rank : nColors - 1; return 'Coloring… color ' + (r + 1) + ' of ' + nColors; },
    paletteIndex() { return this.ci < C.length ? C[this.ci].rank : nColors; }
  };
}

/* ------------------------------------------------------------------ recording + saving */
function startRecording() {
  if (!window.MediaRecorder || !view.captureStream) return null;
  try {
    const stream = view.captureStream(30);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5e6 } : {});
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(250);
    return { rec, chunks, mime: rec.mimeType || mime || 'video/webm' };
  } catch (_) { return null; }
}
function stopRecording(r) {
  return new Promise(res => { r.rec.onstop = () => res(new Blob(r.chunks, { type: r.mime })); try { r.rec.stop(); } catch (_) { res(null); } });
}
const stamp = () => { const d = new Date(), p = v => String(v).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };
async function saveBlob(blob, name) {
  const cap = window.Capacitor, P = cap && cap.Plugins;
  try {                                                         // inside the Android app (needs @capacitor/filesystem + @capacitor/share)
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && P && P.Filesystem && P.Share) {
      const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
      const f = await P.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
      await P.Share.share({ title: name, url: f.uri }); return;
    }
  } catch (e) { console.warn('native save failed', e); }
  try {                                                         // share sheet where the browser supports files
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('saveImg').addEventListener('click', () => { if (lastImageBlob) saveBlob(lastImageBlob, 'drawing_' + stamp() + '.png'); });
$('saveVid').addEventListener('click', () => { if (lastVideoBlob) saveBlob(lastVideoBlob, 'drawing_' + stamp() + '.' + lastVideoExt); });

/* ------------------------------------------------------------------ run everything */
function animate(plan, o, pal, onFrame) {
  return new Promise(resolve => {
    const phases = [];
    if (o.outlines && plan.strokes.length) phases.push(makeOutline(plan));
    if (o.fill && plan.comps.length) phases.push(makeFill(plan));
    if (!phases.length) { resolve(); return; }
    const D = o.seconds * 1000;
    phases.forEach((p, i) => p.dur = D * (phases.length === 2 ? (i === 0 ? 0.4 : 0.6) : 1));
    let pi = 0, start = null;
    const frame = now => {
      if (abort) { resolve(); return; }
      const p = phases[pi]; if (start === null) start = now;
      const f = (D === 0 || skipFlag) ? 1 : Math.min(1, (now - start) / p.dur);
      pctx.setTransform(1, 0, 0, 1, plan.ox, plan.oy);
      p.advance(f >= 1 ? Infinity : Math.max(0, f * p.total - p.done));
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      const before = phases.slice(0, pi).reduce((a, q) => a + q.dur, 0);
      setBar(D === 0 ? (pi + f) / phases.length : (before + f * p.dur) / D);
      setStatus(p.label());
      highlight(pal, p.name === 'outline' ? 0 : pal.offset + p.paletteIndex());
      vctx.drawImage(paper, 0, 0);
      if (f >= 1 && p.finished) {
        p.leave(); pi++; start = null;
        if (pi >= phases.length) { vctx.drawImage(paper, 0, 0); resolve(); return; }
      } else drawPen(plan.ox + p.x, plan.oy + p.y, p.color);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function start(force = false) {
  const text = $('prompt').value.trim();
  if (running || (!source && !text)) return;
  running = true; abort = false; skipFlag = false; setBusy(true);
  $('saves').hidden = true; $('saveVid').hidden = true; lastImageBlob = lastVideoBlob = null;
  let rec = null, drew = false;
  try {
    if (text && (force || sourceKey !== 'p:' + text)) {
      setStatus('Creating your picture… this can take up to a minute.'); $('bar').classList.add('busy');
      try { const el = await fetchPicture(text); setSource(el, el.width || el.naturalWidth, el.height || el.naturalHeight, 'p:' + text); }
      finally { $('bar').classList.remove('busy'); }
    }
    setStatus('Studying the picture…'); setBar(0); await tick(60);
    const L = layout(), o = readOpts(), t0 = performance.now();
    const plan = buildPlan(source, L, o); currentPlan = plan;
    console.log('plan ms', Math.round(performance.now() - t0), 'mode', plan.mode, 'strokes', plan.strokes.length, 'regions', plan.comps.length, 'colors', plan.palette.length);
    sizeCanvases(L.W, L.H); vctx.drawImage(paper, 0, 0); drew = true;
    const pal = renderPalette(plan, o.outlines && plan.strokes.length > 0);
    pal.sw.forEach(el => el.classList.remove('done', 'on'));
    if (o.record) { rec = startRecording(); if (!rec) setStatus('Video recording is not available here. Drawing without it.'); await tick(200); }
    await animate(plan, o, pal);
    pal.sw.forEach(el => { el.classList.add('done'); el.classList.remove('on'); });
    if (rec) { for (let i = 0; i < 24; i++) { vctx.drawImage(paper, 0, 0); await tick(40); } }   // hold the finished picture
    setBar(abort ? 0 : 1);
    setStatus(abort ? 'Stopped. You can save what was drawn.' : 'Done! Your drawing is ready.');
  } catch (e) { console.error(e); setStatus(friendly(e)); }
  finally {
    if (rec) { const b = await stopRecording(rec); if (b && b.size) { lastVideoBlob = b; lastVideoExt = /mp4/.test(b.type) ? 'mp4' : 'webm'; $('saveVid').hidden = false; } }
    if (drew) { await new Promise(r => paper.toBlob(b => { lastImageBlob = b; r(); }, 'image/png')); $('saves').hidden = false; }
    running = false; setBusy(false);
  }
}
$('start').addEventListener('click', () => start());
$('renew').addEventListener('click', () => start(true));
$('prompt').addEventListener('input', refreshStart);
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !running) { e.preventDefault(); start(); } });
$('skip').addEventListener('click', () => { skipFlag = true; });
$('stop').addEventListener('click', () => { abort = true; if (genCtl) genCtl.abort(); });
window.__app = { get plan() { return currentPlan; }, get video() { return lastVideoBlob; }, get image() { return lastImageBlob; } };
showPreview(); refreshStart();
