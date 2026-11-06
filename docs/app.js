/* PHOTO DESTROYER - web UI */
(function () {
  'use strict';
  const D = self.PD_DATA, $ = (s) => document.querySelector(s);
  const view = $('#view'), vg = view.getContext('2d'), status = $('#status');
  const state = { params: {}, seed: 1, master: 100, tint: 'amber', backdrop: 'none', cut: 'strip', src: null, name: 'photo', orig: null, result: null, showOrig: false };
  const PREVIEW = 900;
  let lastPreset = 'Forgotten album', worker = null, jobId = 0, inflight = null, pending = false, waiters = new Map();

  // ---------- worker with main-thread fallback ----------
  try { worker = new Worker('worker.js'); worker.onerror = () => { worker = null; }; } catch (e) { worker = null; }
  if (worker) worker.onmessage = (e) => {
    const m = e.data, w = waiters.get(m.id); if (!w) return; waiters.delete(m.id);
    if (m.type === 'error') w.reject(new Error(m.message)); else w.resolve(m);
  };
  function callRender(maxSide) {
    const id = ++jobId, snap = { params: Object.assign({}, state.params, { tint: state.tint, backdrop: state.backdrop, cut: state.cut }), seed: state.seed, master: state.master, maxSide };
    return new Promise((resolve, reject) => {
      if (worker) { waiters.set(id, { resolve, reject }); worker.postMessage(Object.assign({ type: 'render', id }, snap)); }
      else setTimeout(() => { try { const r = self.PD.render(state.src, snap.params, snap.seed, snap.master, maxSide); resolve({ w: r.w, h: r.h, alpha: r.alpha, data: r.data }); } catch (e) { reject(e); } }, 10);
    });
  }

  // ---------- UI build ----------
  const sl = $('#sliders'), vals = {}, inputs = {}, marks = {}; let presetVals = {};
  function section(t) { const d = document.createElement('div'); d.className = 'sec'; d.textContent = t; d.dataset.group = t; sl.appendChild(d); return d; }
  function slider(key, label, tip, min, max, val, suffix) {
    const d = document.createElement('div'); d.className = 'sl'; d.title = tip || '';
    d.innerHTML = '<div><span>' + label + '</span><span></span></div><input type="range" min="' + min + '" max="' + max + '" value="' + val + '">';
    const inp = d.querySelector('input'), out = d.querySelectorAll('span')[1]; out.textContent = val + (suffix || '');
    const mark = () => d.classList.toggle('on', key === 'master' ? +inp.value !== 100 : +inp.value > 0);
    inp.addEventListener('input', () => { out.textContent = inp.value + (suffix || ''); if (key === 'master') state.master = +inp.value; else state.params[key] = +inp.value; mark(); request(); });
    d.addEventListener('dblclick', () => { const v = key === 'master' ? 100 : (presetVals[key] || 0); inp.value = v; inp.dispatchEvent(new Event('input')); });
    inputs[key] = inp; vals[key] = out; marks[key] = mark; sl.appendChild(d);
  }
  function select(label, opts, key) {
    const w = document.createElement('div'); w.innerHTML = '<div class="lbl" style="margin-top:0">' + label + '</div><select></select>';
    const s = w.querySelector('select'); opts.forEach((o) => { const op = document.createElement('option'); op.value = o.key; op.textContent = o.label; s.appendChild(op); });
    s.addEventListener('change', () => { state[key] = s.value; request(); }); w.select = s; return w;
  }
  section('OVERALL'); slider('master', 'Total decay', '', 0, 200, 100, '%');
  const o1 = document.createElement('div'); o1.className = 'opts';
  const tintSel = select('FADE TINT', D.tints, 'tint'), bdSel = select('BACKDROP', D.backdrops, 'backdrop'), cutSel = select('SHREDDER CUT', D.cuts, 'cut');
  o1.append(tintSel, bdSel); sl.appendChild(o1);
  let group = null;
  D.params.forEach((p) => {
    if (p.group !== group) { group = p.group; section(group); if (group === 'SHREDDER') { const o = document.createElement('div'); o.className = 'opts'; o.style.gridTemplateColumns = '1fr'; o.append(cutSel); sl.appendChild(o); } }
    slider(p.key, p.label, p.tip, 0, 100, 0);
  });
  const presetSel = $('#preset');
  Object.keys(D.presets).forEach((n) => { const o = document.createElement('option'); o.textContent = n; presetSel.appendChild(o); });

  function setUI() {
    D.keys.forEach((k) => { const v = state.params[k] || 0; inputs[k].value = v; vals[k].textContent = v; });
    inputs.master.value = state.master; vals.master.textContent = state.master + '%';
    Object.keys(marks).forEach((k) => marks[k]());
    tintSel.select.value = state.tint; bdSel.select.value = state.backdrop; cutSel.select.value = state.cut; $('#seedv').textContent = state.seed;
  }
  function applyPreset(name, doRequest) {
    const p = D.presets[name]; D.keys.forEach((k) => { state.params[k] = p[k] || 0; });
    state.tint = p.tint; state.backdrop = p.backdrop; state.cut = p.cut || 'strip'; state.master = 100; presetSel.value = name; presetVals = Object.assign({}, state.params); lastPreset = name; setUI();
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.preset === name));
    if (doRequest !== false) request();
  }
  presetSel.addEventListener('change', () => applyPreset(presetSel.value));
  document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => {
    applyPreset(b.dataset.preset);
    const g = sl.querySelector('.sec[data-group="' + b.dataset.group + '"]'); if (g) sl.scrollTo({ top: g.offsetTop - 8, behavior: 'smooth' });
  }));
  $('#btnSeed').onclick = () => { state.seed = 1 + Math.floor(Math.random() * 99999); $('#seedv').textContent = state.seed; request(); };
  $('#btnRand').onclick = () => {
    D.keys.forEach((k) => { state.params[k] = 0; });
    const keys = D.keys.filter((k) => k !== 'shred_w' && k !== 'shred_chaos').sort(() => Math.random() - 0.5).slice(0, 6 + Math.floor(Math.random() * 6));
    keys.forEach((k) => { state.params[k] = 25 + Math.floor(Math.random() * 70); });
    state.params.shred_w = 20 + Math.floor(Math.random() * 40); state.params.shred_chaos = 20 + Math.floor(Math.random() * 60);
    state.tint = D.tints[Math.floor(Math.random() * D.tints.length)].key; state.backdrop = ['none', 'dark', 'paper'][Math.floor(Math.random() * 3)]; state.cut = Math.random() < 0.5 ? 'strip' : 'cross';
    state.seed = 1 + Math.floor(Math.random() * 99999); presetSel.selectedIndex = -1; setUI(); request();
  };

  $('#btnReset').onclick = () => { applyPreset(lastPreset); toast('Back to preset: ' + lastPreset); };
  let toastT = null;
  function toast(msg) {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }
  // shareable settings: #s=<base64 json>
  function encodeState() { return btoa(JSON.stringify({ p: state.params, t: state.tint, b: state.backdrop, c: state.cut, s: state.seed, m: state.master })); }
  function decodeState(str) {
    try {
      const o = JSON.parse(atob(str)); D.keys.forEach((k) => { state.params[k] = Math.max(0, Math.min(100, +(o.p || {})[k] || 0)); });
      state.tint = o.t; state.backdrop = o.b; state.cut = o.c === 'cross' ? 'cross' : 'strip'; state.seed = o.s | 0 || 1; state.master = Math.max(0, Math.min(200, +o.m || 100));
      presetSel.selectedIndex = -1; presetVals = Object.assign({}, state.params); setUI(); return true;
    } catch (e) { return false; }
  }
  $('#btnLink').onclick = async () => {
    const url = location.origin + location.pathname + '#s=' + encodeState();
    try { await navigator.clipboard.writeText(url); toast('Link copied: opens with these exact settings'); }
    catch (e) { location.hash = 's=' + encodeState(); toast('Link is in the address bar'); }
  };

  const stage = $('#stage');
  // ---------- loading ----------
  function loadFile(f, isSample) {
    if (!f || !f.type.startsWith('image/')) return;
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight; const k = Math.min(1, 4200 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h);
      state.src = { data: data.data, w, h }; state.name = f.name.replace(/\.[^.]+$/, '') || 'photo'; state.orig = c; URL.revokeObjectURL(url);
      if (worker) worker.postMessage({ type: 'src', data: new Uint8ClampedArray(data.data), w, h });
      $('#drop').style.display = 'none'; view.hidden = false; $('#btnSave').disabled = false; $('#btnStrip').disabled = false; $('#btnCmp').disabled = false; stage.classList.remove('empty');
      status.textContent = (isSample ? 'sample photo (NASA, public domain) - drop your own' : f.name) + '  -  ' + img.naturalWidth + 'x' + img.naturalHeight; request();
    };
    img.onerror = () => { status.textContent = 'Cannot open this file'; };
    img.src = url;
  }
  $('#btnOpen').onclick = () => $('#file').click();
  $('#file').onchange = (e) => loadFile(e.target.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
  stage.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  window.addEventListener('paste', (e) => { const it = [...(e.clipboardData || {}).items || []].find((i) => i.type.startsWith('image/')); if (it) loadFile(it.getAsFile()); });

  // ---------- live preview ----------
  let timer = null;
  function request() { if (!state.src) return; clearTimeout(timer); timer = setTimeout(run, 90); }
  async function run() {
    if (inflight) { pending = true; return; }
    inflight = true; pending = false; $('#busy').style.display = 'block';
    try { const r = await callRender(PREVIEW); state.result = r; draw(); status.textContent = status.textContent.split('  |  ')[0] + '  |  ' + Math.round(r.ms || 0) + ' ms'; }
    catch (e) { status.textContent = 'render error: ' + e.message; }
    inflight = null; $('#busy').style.display = 'none'; if (pending) run();
  }
  function draw() {
    if (state.showOrig && state.orig) { view.width = state.orig.width; view.height = state.orig.height; vg.drawImage(state.orig, 0, 0); $('#badge').style.display = 'block'; return; }
    $('#badge').style.display = 'none'; const r = state.result; if (!r) return;
    view.width = r.w; view.height = r.h; vg.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
  }
  const holdOn = () => { if (state.src && !state.showOrig) { state.showOrig = true; $('#btnCmp').classList.add('hold'); draw(); } };
  const holdOff = () => { if (state.showOrig) { state.showOrig = false; $('#btnCmp').classList.remove('hold'); draw(); } };
  ['btnCmp', 'view'].forEach((id) => { const el = $('#' + id); el.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType === 'touch') { holdOn(); } }); });
  ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, holdOff));
  $('#view').addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (/select|input|textarea/i.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') $('#btnRand').click();
    else if (e.key === 's' || e.key === 'S') $('#btnSeed').click();
    else if (e.key >= '1' && e.key <= '3') document.querySelectorAll('#modes button')[+e.key - 1].click();
  });
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !state.showOrig && state.src && !/select|input/i.test(e.target.tagName)) { e.preventDefault(); state.showOrig = true; draw(); } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space' && state.showOrig) { state.showOrig = false; draw(); } });

  // ---------- exports ----------
  function download(canvasOrBlob, name) {
    const go = (blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    if (canvasOrBlob instanceof Blob) go(canvasOrBlob); else canvasOrBlob.toBlob(go, 'image/png');
  }
  function toCanvas(r) { const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0); return c; }
  $('#btnSave').onclick = async () => {
    const ms = +$('#exportSize').value; $('#btnSave').disabled = true; status.textContent = 'rendering full size...';
    try { const r = await callRender(ms || 0); download(toCanvas(r), state.name + '_destroyed.png'); status.textContent = 'saved ' + state.name + '_destroyed.png (' + r.w + 'x' + r.h + ')'; }
    catch (e) { status.textContent = 'export failed: ' + e.message; }
    $('#btnSave').disabled = false;
  };
  $('#btnStrip').onclick = async () => {
    const N = 6, keep = state.master, frames = []; $('#btnStrip').disabled = true;
    try {
      for (let i = 0; i < N; i++) { state.master = keep * i / (N - 1); status.textContent = 'decay stage ' + (i + 1) + '/' + N; frames.push(await callRender(640)); }
    } catch (e) { status.textContent = 'strip failed: ' + e.message; }
    state.master = keep;
    if (frames.length === N) {
      const W = Math.max(...frames.map((f) => f.w)), H = Math.max(...frames.map((f) => f.h)), c = document.createElement('canvas'); c.width = W * N; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = '#0e0e0e'; g.fillRect(0, 0, c.width, c.height);
      frames.forEach((f, i) => g.drawImage(toCanvas(f), i * W + (W - f.w) / 2, (H - f.h) / 2));
      download(c, state.name + '_decay_strip.png'); status.textContent = 'saved decay strip';
    }
    $('#btnStrip').disabled = false; request();
  };

  stage.classList.add('empty');
  stage.addEventListener('click', () => { if (stage.classList.contains('empty')) $('#file').click(); });
  const initial = location.hash.startsWith('#s=') ? decodeState(location.hash.slice(3)) : false;
  if (!initial) applyPreset('Forgotten album', false);
  // start alive: load the sample photo so the page is never an empty box
  fetch('examples/00_original.jpg').then((r) => { if (!r.ok) throw 0; return r.blob(); })
    .then((b) => loadFile(new File([b], 'sample.jpg', { type: 'image/jpeg' }), true)).catch(() => {});
})();
