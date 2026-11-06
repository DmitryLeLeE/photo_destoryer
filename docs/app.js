/* PHOTO DESTROYER 1.1 - web UI */
(function () {
  'use strict';
  const D = self.PD_DATA, $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const view = $('#view'), vg = view.getContext('2d'), status = $('#status'), machine = $('.machine'), stage = $('#stage'), strip = $('#strip');
  const state = { params: {}, seed: 1, master: 100, tint: 'amber', backdrop: 'none', cut: 'strip', src: null, name: 'photo', orig: null, result: null, showOrig: false, mode: 'aging', preset: null };
  const PREVIEW = 900, THUMB = 132;
  const MODEGROUP = { aging: 'AGING', shred: 'SHREDDER', digital: 'DIGITAL KILL', shatter: 'SHATTER', fire: 'FIRE', total: 'OBLITERATE' };
  const SHAPE = ['shred_w', 'shred_chaos', 'shard_size'];
  const OPEN = { aging: ['OVERALL', 'TIME', 'DAMAGE', 'PRESENTATION'], shred: ['OVERALL', 'SHREDDER', 'PRESENTATION'], digital: ['OVERALL', 'DIGITAL KILL', 'WIRED'], shatter: ['OVERALL', 'SHATTER', 'DAMAGE'], fire: ['OVERALL', 'FIRE', 'DAMAGE'], total: ['OVERALL', 'FIRE', 'SHATTER', 'DIGITAL KILL'] };
  const DEFAULT = { aging: 'Forgotten album', shred: 'Shredder: strip cut', digital: 'Digital kill', shatter: 'Broken glass', fire: 'Burning photo', total: 'Obliterate' };
  let worker = null, jobId = 0, inflight = null, pending = false, waiters = new Map(), photoId = 0, lastPreset = DEFAULT.aging;

  // ---------- worker with main-thread fallback ----------
  try { worker = new Worker('worker.js'); worker.onerror = () => { worker = null; }; } catch (e) { worker = null; }
  if (worker) worker.onmessage = (e) => {
    const m = e.data, w = waiters.get(m.id); if (!w) return; waiters.delete(m.id);
    if (m.type === 'error') w.reject(new Error(m.message)); else w.resolve(m);
  };
  function callRender(maxSide, over) {
    const id = ++jobId, o = over || {};
    const snap = { params: Object.assign({}, o.params || state.params, o.params ? {} : { tint: state.tint, backdrop: state.backdrop, cut: state.cut }), seed: o.seed || state.seed, master: o.master === undefined ? state.master : o.master, maxSide, thumb: !!o.thumb };
    return new Promise((resolve, reject) => {
      if (worker) { waiters.set(id, { resolve, reject }); worker.postMessage(Object.assign({ type: 'render', id }, snap)); }
      else setTimeout(() => { try { const r = self.PD.render(state.src, snap.params, snap.seed, snap.master, maxSide); resolve({ w: r.w, h: r.h, alpha: r.alpha, data: r.data }); } catch (e) { reject(e); } }, 10);
    });
  }

  // ---------- sliders: accordion groups ----------
  const sl = $('#sliders'), vals = {}, inputs = {}, marks = {}, groups = {}; let presetVals = {};
  function group(title) {
    const g = document.createElement('div'); g.className = 'grp'; g.dataset.group = title;
    const head = document.createElement('div'); head.className = 'sec'; head.tabIndex = 0; head.setAttribute('role', 'button');
    head.innerHTML = '<span class="chev">&#9662;</span><span class="nm">' + title + '</span><span class="cnt"></span>';
    const body = document.createElement('div'); body.className = 'body';
    const toggle = () => { g.classList.toggle('closed'); head.setAttribute('aria-expanded', !g.classList.contains('closed')); };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } });
    g.append(head, body); sl.appendChild(g); groups[title] = { el: g, body, head, keys: [] };
    return groups[title];
  }
  function slider(grp, key, label, tip, min, max, val, suffix) {
    const d = document.createElement('div'); d.className = 'sl'; d.title = tip || '';
    d.innerHTML = '<div><span>' + label + '</span><span></span></div><input type="range" min="' + min + '" max="' + max + '" value="' + val + '" aria-label="' + label + '">';
    const inp = d.querySelector('input'), out = d.querySelectorAll('span')[1]; out.textContent = val + (suffix || '');
    const mark = () => { d.classList.toggle('on', key === 'master' ? +inp.value !== 100 : +inp.value > 0); counts(); };
    inp.addEventListener('input', () => { out.textContent = inp.value + (suffix || ''); if (key === 'master') state.master = +inp.value; else state.params[key] = +inp.value; markCustom(); mark(); request(); });
    d.addEventListener('dblclick', () => { const v = key === 'master' ? 100 : (presetVals[key] || 0); inp.value = v; inp.dispatchEvent(new Event('input')); });
    inputs[key] = inp; vals[key] = out; marks[key] = mark; grp.body.appendChild(d); grp.keys.push(key);
  }
  function counts() {
    Object.values(groups).forEach((g) => {
      const n = g.keys.filter((k) => k !== 'master' && !SHAPE.includes(k) && +inputs[k].value > 0).length;
      g.head.querySelector('.cnt').textContent = n ? n : '';
    });
  }
  function select(label, opts, key) {
    const w = document.createElement('div'); w.innerHTML = '<div class="lbl" style="margin-top:0">' + label + '</div><select aria-label="' + label + '"></select>';
    const s = w.querySelector('select'); opts.forEach((o) => { const op = document.createElement('option'); op.value = o.key; op.textContent = o.label; s.appendChild(op); });
    s.addEventListener('change', () => { state[key] = s.value; markCustom(); request(); }); w.select = s; return w;
  }
  const gAll = group('OVERALL'); slider(gAll, 'master', 'Total decay', '', 0, 200, 100, '%');
  const tintSel = select('FADE TINT', D.tints, 'tint'), bdSel = select('BACKDROP', D.backdrops, 'backdrop'), cutSel = select('SHREDDER CUT', D.cuts, 'cut');
  const o1 = document.createElement('div'); o1.className = 'opts'; o1.append(tintSel, bdSel); gAll.body.appendChild(o1);
  let cur = null;
  D.params.forEach((p) => {
    if (!cur || p.group !== cur.el.dataset.group) { cur = group(p.group); if (p.group === 'SHREDDER') { const o = document.createElement('div'); o.className = 'opts one'; o.append(cutSel); cur.body.appendChild(o); } }
    slider(cur, p.key, p.label, p.tip, 0, 100, 0);
  });
  function openGroups(list, closeOthers) {
    Object.entries(groups).forEach(([n, g]) => { const on = list.includes(n); if (on) g.el.classList.remove('closed'); else if (closeOthers) g.el.classList.add('closed'); g.head.setAttribute('aria-expanded', !g.el.classList.contains('closed')); });
  }
  function openActive() { Object.values(groups).forEach((g) => { if (g.keys.some((k) => k !== 'master' && !SHAPE.includes(k) && +inputs[k].value > 0)) g.el.classList.remove('closed'); }); }

  // ---------- modes + preset filmstrip ----------
  function setMode(mode, scroll) {
    state.mode = mode; machine.dataset.mode = mode;
    $$('#modes button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('#striplbl').textContent = 'PRESETS / ' + MODEGROUP[mode];
    buildStrip(); openGroups(OPEN[mode], true);
    if (scroll) { const g = groups[{ shred: 'SHREDDER', digital: 'DIGITAL KILL', shatter: 'SHATTER', fire: 'FIRE', total: 'FIRE' }[mode] || 'TIME']; if (g && window.innerWidth > 900) sl.scrollTo({ top: g.el.offsetTop - 8, behavior: 'smooth' }); }
  }
  function modeOf(preset) { return Object.keys(MODEGROUP).find((m) => D.groups[MODEGROUP[m]].includes(preset)) || state.mode; }
  const thumbs = new Map(); let thumbToken = 0, debouncing = false;
  function paint(cv, r) { cv.width = r.w; cv.height = r.h; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0); cv.parentNode.classList.add('ready'); }
  function buildStrip() {
    strip.innerHTML = '';
    D.groups[MODEGROUP[state.mode]].forEach((n) => {
      const b = document.createElement('button'); b.className = 'pv'; b.dataset.preset = n; b.setAttribute('role', 'option'); b.title = n;
      b.innerHTML = '<canvas width="2" height="2"></canvas><span>' + n.replace('Shredder: ', '') + '</span>';
      b.addEventListener('click', () => applyPreset(n)); strip.appendChild(b);
    });
    markStrip(); thumbsFor(++thumbToken);
  }
  function markStrip() { $$('#strip .pv').forEach((b) => { const on = b.dataset.preset === state.preset; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function thumbsFor(token) {
    if (!state.src || !worker) return;
    for (const b of $$('#strip .pv')) {
      if (token !== thumbToken) return;
      const n = b.dataset.preset, key = photoId + '|' + n, cv = b.querySelector('canvas');
      if (thumbs.has(key)) { paint(cv, thumbs.get(key)); continue; }
      while (inflight || debouncing) { await sleep(140); if (token !== thumbToken) return; }
      try { const r = await callRender(THUMB, { params: D.presets[n], seed: 1, master: 100, thumb: true }); thumbs.set(key, r); if (token === thumbToken) paint(cv, r); } catch (e) { return; }
    }
  }
  strip.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) { e.preventDefault(); strip.scrollLeft += e.deltaY; } }, { passive: false });

  const presetOrder = () => D.groups[MODEGROUP[state.mode]];
  function stepPreset(d) { const l = presetOrder(), i = l.indexOf(state.preset), n = l[(i + d + l.length) % l.length]; applyPreset(n); const b = strip.querySelector('[data-preset="' + n + '"]'); if (b) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }

  function setUI() {
    D.keys.forEach((k) => { const v = state.params[k] || 0; inputs[k].value = v; vals[k].textContent = v; });
    inputs.master.value = state.master; vals.master.textContent = state.master + '%';
    Object.keys(marks).forEach((k) => marks[k]());
    tintSel.select.value = state.tint; bdSel.select.value = state.backdrop; cutSel.select.value = state.cut; $('#seedv').textContent = state.seed;
    markStrip();
  }
  function markCustom() { if (state.preset) { state.preset = null; markStrip(); } }
  function applyPreset(name, doRequest) {
    const p = D.presets[name]; D.keys.forEach((k) => { state.params[k] = p[k] || 0; });
    state.tint = p.tint; state.backdrop = p.backdrop; state.cut = p.cut || 'strip'; state.master = 100; state.preset = name; lastPreset = name;
    presetVals = Object.assign({}, state.params);
    const m = modeOf(name); if (m !== state.mode) setMode(m);
    setUI(); openActive();
    if (doRequest !== false) request();
  }
  $$('#modes button').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode, true); applyPreset(b.dataset.preset); }));
  $('#btnSeed').onclick = () => { state.seed = 1 + Math.floor(Math.random() * 99999); $('#seedv').textContent = state.seed; request(); };
  $('#btnRand').onclick = () => {
    D.keys.forEach((k) => { state.params[k] = 0; });
    const POOL = { digital: ['DIGITAL KILL', 'WIRED'], shred: ['SHREDDER', 'TIME'], shatter: ['SHATTER', 'DAMAGE', 'TIME'], fire: ['FIRE', 'DAMAGE', 'TIME'], total: ['FIRE', 'SHATTER', 'DIGITAL KILL', 'DAMAGE'], aging: ['TIME', 'DAMAGE', 'PRESENTATION'] };
    const pool = D.params.filter((p) => !SHAPE.includes(p.key) && POOL[state.mode].includes(p.group)).map((p) => p.key);
    pool.sort(() => Math.random() - 0.5).slice(0, 4 + Math.floor(Math.random() * 5)).forEach((k) => { state.params[k] = 25 + Math.floor(Math.random() * 70); });
    if (state.mode === 'shred') state.params.shred = 50 + Math.floor(Math.random() * 45);
    if (state.mode === 'shatter') state.params.shatter = 55 + Math.floor(Math.random() * 40);
    if (state.mode === 'fire') state.params.fire = 30 + Math.floor(Math.random() * 55);
    state.params.shard_size = 20 + Math.floor(Math.random() * 50); state.params.shred_w = 15 + Math.floor(Math.random() * 45); state.params.shred_chaos = 20 + Math.floor(Math.random() * 65);
    state.tint = D.tints[Math.floor(Math.random() * D.tints.length)].key; state.backdrop = state.mode === 'digital' ? 'none' : ['dark', 'paper'][Math.floor(Math.random() * 2)]; state.cut = Math.random() < 0.5 ? 'strip' : 'cross';
    state.seed = 1 + Math.floor(Math.random() * 99999); state.preset = null; presetVals = Object.assign({}, state.params); setUI(); openActive(); request();
  };
  $('#btnReset').onclick = () => { applyPreset(lastPreset); toast('Back to preset: ' + lastPreset); };

  // ---------- undo / redo ----------
  const hist = { stack: [], idx: -1, lock: false, t: null };
  const snapState = () => JSON.stringify({ p: state.params, t: state.tint, b: state.backdrop, c: state.cut, s: state.seed, m: state.master, pr: state.preset });
  function pushHist() { const s = snapState(); if (hist.stack[hist.idx] === s) return; hist.stack = hist.stack.slice(0, hist.idx + 1); hist.stack.push(s); if (hist.stack.length > 80) hist.stack.shift(); hist.idx = hist.stack.length - 1; undoBtns(); }
  function commit() { if (hist.lock) return; clearTimeout(hist.t); hist.t = setTimeout(pushHist, 380); }
  function undoBtns() { $('#btnUndo').disabled = hist.idx <= 0; $('#btnRedo').disabled = hist.idx >= hist.stack.length - 1; }
  function goHist(i) {
    clearTimeout(hist.t); pushHist(); i = Math.max(0, Math.min(hist.stack.length - 1, i)); if (i === hist.idx) return;
    const o = JSON.parse(hist.stack[i]); hist.lock = true;
    D.keys.forEach((k) => { state.params[k] = +(o.p || {})[k] || 0; }); state.tint = o.t; state.backdrop = o.b; state.cut = o.c; state.seed = o.s; state.master = o.m; state.preset = o.pr;
    if (o.pr) { const m = modeOf(o.pr); if (m !== state.mode) setMode(m); lastPreset = o.pr; }
    setUI(); hist.lock = false; hist.idx = i; undoBtns(); request();
  }
  $('#btnUndo').onclick = () => goHist(hist.idx - 1); $('#btnRedo').onclick = () => goHist(hist.idx + 1);

  // ---------- toast + shareable link ----------
  let toastT = null;
  function toast(msg) {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function encodeState() { return btoa(JSON.stringify({ p: state.params, t: state.tint, b: state.backdrop, c: state.cut, s: state.seed, m: state.master })); }
  function decodeState(str) {
    try {
      const o = JSON.parse(atob(str)); D.keys.forEach((k) => { state.params[k] = Math.max(0, Math.min(100, +(o.p || {})[k] || 0)); });
      state.tint = D.tints.some((t) => t.key === o.t) ? o.t : 'amber'; state.backdrop = ['none', 'dark', 'paper'].includes(o.b) ? o.b : 'none'; state.cut = o.c === 'cross' ? 'cross' : 'strip'; state.seed = o.s | 0 || 1; state.master = Math.max(0, Math.min(200, +o.m || 100));
      state.preset = null; presetVals = Object.assign({}, state.params);
      const dig = ['sort', 'melt', 'mosh', 'jpeg', 'dead', 'crush', 'redact', 'corrupt', 'dissolve'].reduce((a, k) => a + state.params[k], 0), shr = state.params.shred || 0;
      setMode(state.params.fire > 20 ? 'fire' : state.params.shatter > 20 ? 'shatter' : shr > 20 ? 'shred' : dig > 40 ? 'digital' : 'aging'); setUI(); openActive(); return true;
    } catch (e) { return false; }
  }
  $('#btnLink').onclick = async () => {
    const url = location.origin + location.pathname + '#s=' + encodeState();
    try { await navigator.clipboard.writeText(url); toast('Link copied: opens with these exact settings'); }
    catch (e) { location.hash = 's=' + encodeState(); toast('Link is in the address bar'); }
  };

  // ---------- loading ----------
  function loadFile(f, isSample) {
    if (!f || !f.type.startsWith('image/')) return;
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight; const k = Math.min(1, 4200 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h);
      state.src = { data: data.data, w, h }; state.name = f.name.replace(/\.[^.]+$/, '') || 'photo'; state.orig = c; URL.revokeObjectURL(url); photoId++;
      if (worker) {
        worker.postMessage({ type: 'src', data: new Uint8ClampedArray(data.data), w, h });
        const t = Math.min(1, 420 / Math.max(w, h)), tw = Math.max(1, Math.round(w * t)), th = Math.max(1, Math.round(h * t)), tc = document.createElement('canvas'); tc.width = tw; tc.height = th; tc.getContext('2d').drawImage(c, 0, 0, tw, th);
        worker.postMessage({ type: 'tsrc', data: tc.getContext('2d').getImageData(0, 0, tw, th).data, w: tw, h: th });
      }
      $('#drop').style.display = 'none'; view.hidden = false; ['btnSave', 'btnStrip', 'btnCmp'].forEach((id) => { $('#' + id).disabled = false; }); stage.classList.remove('empty');
      status.textContent = (isSample ? 'sample photo (NASA, public domain) - drop your own' : f.name) + '  -  ' + img.naturalWidth + 'x' + img.naturalHeight; request(); thumbsFor(++thumbToken);
    };
    img.onerror = () => { status.textContent = 'Cannot open this file'; };
    img.src = url;
  }
  function loadSample() { return fetch('examples/00_original.jpg').then((r) => { if (!r.ok) throw 0; return r.blob(); }).then((b) => loadFile(new File([b], 'sample.jpg', { type: 'image/jpeg' }), true)).catch(() => {}); }
  $('#btnOpen').onclick = () => $('#file').click(); $('#btnSample').onclick = loadSample;
  $('#file').onchange = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
  stage.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  window.addEventListener('paste', (e) => { const it = [...(e.clipboardData || {}).items || []].find((i) => i.type.startsWith('image/')); if (it) loadFile(it.getAsFile()); });
  stage.classList.add('empty');
  stage.addEventListener('click', () => { if (stage.classList.contains('empty')) $('#file').click(); });

  // ---------- live preview ----------
  let timer = null;
  function request() { commit(); if (!state.src) return; clearTimeout(timer); debouncing = true; timer = setTimeout(run, 90); }
  async function run() {
    debouncing = false; if (inflight) { pending = true; return; }
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

  // ---------- compare (hold) + keyboard ----------
  const holdOn = () => { if (state.src && !state.showOrig) { state.showOrig = true; $('#btnCmp').classList.add('hold'); draw(); } };
  const holdOff = () => { if (state.showOrig) { state.showOrig = false; $('#btnCmp').classList.remove('hold'); draw(); } };
  ['btnCmp', 'view'].forEach((id) => $('#' + id).addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType === 'touch') holdOn(); }));
  ['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, holdOff));
  $('#view').addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) { if (tag === 'select') return; e.preventDefault(); (e.key === 'y' || e.shiftKey) ? goHist(hist.idx + 1) : goHist(hist.idx - 1); return; }
    if (tag === 'select' || tag === 'textarea' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && tag !== 'button' && tag !== 'input') { if (state.src && !state.showOrig) { e.preventDefault(); holdOn(); } return; }
    if (tag === 'input' && e.key.length === 1 && !/[a-z\[\]1-6]/i.test(e.key)) return;
    if (e.key === 'g' || e.key === 'G') $('#btnRand').click();
    else if (e.key === 's' || e.key === 'S') $('#btnSeed').click();
    else if (e.key >= '1' && e.key <= '6') $$('#modes button')[+e.key - 1].click();
    else if (e.key === ']') stepPreset(1);
    else if (e.key === '[') stepPreset(-1);
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') holdOff(); });

  // ---------- exports ----------
  function download(canvasOrBlob, name, type) {
    const go = (blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    if (canvasOrBlob instanceof Blob) go(canvasOrBlob); else canvasOrBlob.toBlob(go, type || 'image/png', 0.93);
  }
  function toCanvas(r, flatten) {
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; const g = c.getContext('2d');
    if (flatten) { g.fillStyle = '#0e0e0e'; g.fillRect(0, 0, r.w, r.h); const t = document.createElement('canvas'); t.width = r.w; t.height = r.h; t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0); g.drawImage(t, 0, 0); }
    else g.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    return c;
  }
  $('#btnSave').onclick = async () => {
    const ms = +$('#exportSize').value, fmt = $('#exportFmt').value, ext = fmt === 'jpeg' ? 'jpg' : fmt; $('#btnSave').disabled = true; status.textContent = 'rendering full size...';
    try { const r = await callRender(ms || 0); download(toCanvas(r, fmt !== 'png'), state.name + '_destroyed.' + ext, 'image/' + fmt); status.textContent = 'saved ' + state.name + '_destroyed.' + ext + ' (' + r.w + 'x' + r.h + ')'; }
    catch (e) { status.textContent = 'export failed: ' + e.message; }
    $('#btnSave').disabled = false;
  };
  $('#btnStrip').onclick = async () => {
    const N = 6, keep = state.master, frames = []; $('#btnStrip').disabled = true;
    try { for (let i = 0; i < N; i++) { state.master = keep * i / (N - 1); status.textContent = 'decay stage ' + (i + 1) + '/' + N; frames.push(await callRender(640)); } }
    catch (e) { status.textContent = 'strip failed: ' + e.message; }
    state.master = keep;
    if (frames.length === N) {
      const W = Math.max(...frames.map((f) => f.w)), H = Math.max(...frames.map((f) => f.h)), c = document.createElement('canvas'); c.width = W * N; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = '#0e0e0e'; g.fillRect(0, 0, c.width, c.height);
      frames.forEach((f, i) => g.drawImage(toCanvas(f), i * W + (W - f.w) / 2, (H - f.h) / 2));
      download(c, state.name + '_decay_strip.png'); status.textContent = 'saved decay strip';
    }
    $('#btnStrip').disabled = false; request();
  };

  // ---------- start ----------
  const initial = location.hash.startsWith('#s=') ? decodeState(location.hash.slice(3)) : false;
  if (!initial) { setMode('aging'); applyPreset(DEFAULT.aging, false); }
  pushHist();
  loadSample();
  window.PD_APP = { state, applyPreset, setMode };
})();
