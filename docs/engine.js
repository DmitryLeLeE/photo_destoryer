/* PHOTO DESTROYER - browser engine. A faithful JS port of destroyer/engine.py.
 * Pure typed arrays + a canvas for drawing primitives and text. Runs in a Web Worker or the main thread.
 * Image = Float32Array(h*w*3) in 0..1, maps = Float32Array(h*w). */
(function (root) {
  'use strict';

  const TINT_GAIN = { amber: [1.0, 0.88, 0.58], red: [1.0, 0.66, 0.5], cyan: [0.55, 0.92, 1.0], mono: [0.94, 0.98, 1.02], none: [1, 1, 1] };
  const TINT_BLACK = { amber: [0.9, 0.6, 0.25], red: [1.0, 0.4, 0.3], cyan: [0.2, 0.6, 0.7], mono: [0.5, 0.55, 0.65], none: [0.5, 0.5, 0.5] };
  const PAPER = [0.93, 0.89, 0.79];
  const NAMES = ['border', 'water', 'fade', 'mirror', 'stain', 'crack', 'peel', 'crease', 'dust', 'grain', 'burn', 'tear', 'corner',
    'tape', 'glitch', 'chroma', 'scan', 'ghost', 'bloom', 'rot', 'label', 'bg', 'tilt', 'sort', 'melt', 'corrupt', 'redact', 'dissolve', 'shred', 'relief', 'fademap', 'mosh', 'jpeg', 'dead', 'shatter', 'fire'];
  const K = {}; NAMES.forEach((n, i) => { K[n] = i; });
  const PI = Math.PI;

  // ───────────── random ─────────────
  function RNG(seed, k) {
    this.s = (Math.imul((seed | 0) ^ 0x9e3779b9, 2654435761) ^ Math.imul((k | 0) + 1, 40503)) >>> 0;
    for (let i = 0; i < 4; i++) this.random();
  }
  RNG.prototype.random = function () {
    let t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.uniform = function (a, b) { return a + (b - a) * this.random(); };
  RNG.prototype.int = function (a, b) { return a + Math.floor(this.random() * (b - a)); };
  RNG.prototype.normal = function (m, s) {
    const u = Math.max(1e-9, this.random()), v = this.random();
    return (m || 0) + (s === undefined ? 1 : s) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v);
  };
  RNG.prototype.lognormal = function (m, s) { return Math.exp(this.normal(m, s)); };
  RNG.prototype.exp = function (scale) { return -Math.log(Math.max(1e-9, 1 - this.random())) * scale; };
  RNG.prototype.pick = function (arr) { return arr[this.int(0, arr.length)]; };

  // ───────────── numeric helpers ─────────────
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  function sstep(e0, e1, x) { let t = (x - e0) / (e1 - e0 + 1e-9); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  const lumaAt = (a, i) => a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
  function lumaMap(a, n) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = lumaAt(a, i * 3); return o; }

  function boxPass(src, dst, w, h, c, r, horiz) {
    const outer = horiz ? h : w, inner = horiz ? w : h;
    const stepI = horiz ? c : w * c, stepO = horiz ? w * c : c;
    const inv = 1 / (2 * r + 1);
    for (let o = 0; o < outer; o++) {
      for (let ch = 0; ch < c; ch++) {
        const base = o * stepO + ch;
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[base + Math.min(inner - 1, Math.max(0, k)) * stepI];
        for (let i = 0; i < inner; i++) {
          dst[base + i * stepI] = sum * inv;
          sum += src[base + Math.min(inner - 1, i + r + 1) * stepI] - src[base + Math.max(0, i - r) * stepI];
        }
      }
    }
  }
  function gauss(a, w, h, c, sigma) {
    if (sigma < 0.6) return a;
    const wd = Math.sqrt(4 * sigma * sigma + 1), r = Math.max(1, Math.round((wd - 1) / 2));
    let x = a, y = new Float32Array(a.length), first = true;
    for (let p = 0; p < 3; p++) {
      boxPass(x, y, w, h, c, r, false); let t = x; x = y; y = first ? new Float32Array(a.length) : t; first = false;
      boxPass(x, y, w, h, c, r, true); t = x; x = y; y = t;
    }
    return x;
  }
  function shiftMap(a, w, h, c, dx, dy) {
    dx = Math.trunc(dx); dy = Math.trunc(dy);
    const o = new Float32Array(a.length);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(h - 1, Math.max(0, y - dy));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(w - 1, Math.max(0, x - dx));
        for (let ch = 0; ch < c; ch++) o[(y * w + x) * c + ch] = a[(sy * w + sx) * c + ch];
      }
    }
    return o;
  }
  function sample(a, w, h, c, mx, my, out, oi) {
    const mxx = Math.max(0, w - 1.001), myy = Math.max(0, h - 1.001);
    mx = mx < 0 ? 0 : mx > mxx ? mxx : mx; my = my < 0 ? 0 : my > myy ? myy : my;
    const x0 = mx | 0, y0 = my | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = mx - x0, fy = my - y0;
    const i00 = (y0 * w + x0) * c, i10 = (y0 * w + x1) * c, i01 = (y1 * w + x0) * c, i11 = (y1 * w + x1) * c;
    for (let ch = 0; ch < c; ch++) {
      const t = a[i00 + ch] * (1 - fx) + a[i10 + ch] * fx, b = a[i01 + ch] * (1 - fx) + a[i11 + ch] * fx;
      out[oi + ch] = t * (1 - fy) + b * fy;
    }
  }

  // ───────────── noise ─────────────
  function noise2d(rng, h, w, cy, cx) {
    if (cx === undefined) cx = cy;
    cy = Math.max(1.5, cy); cx = Math.max(1.5, cx);
    const gh = Math.floor(h / cy) + 4, gw = Math.floor(w / cx) + 4;
    const g = new Float32Array(gh * gw); for (let i = 0; i < g.length; i++) g[i] = rng.random();
    const ox = rng.random() * 2, oy = rng.random() * 2;
    const xi = new Int32Array(w), xf = new Float32Array(w);
    for (let x = 0; x < w; x++) { const p = x / cx + ox; xi[x] = p | 0; const f = p - xi[x]; xf[x] = f * f * (3 - 2 * f); }
    const out = new Float32Array(h * w);
    for (let y = 0; y < h; y++) {
      const p = y / cy + oy, yi = p | 0, f = p - yi, fy = f * f * (3 - 2 * f);
      const r0 = yi * gw, r1 = r0 + gw;
      for (let x = 0; x < w; x++) {
        const i = xi[x], fx = xf[x];
        const t = g[r0 + i] * (1 - fx) + g[r0 + i + 1] * fx, b = g[r1 + i] * (1 - fx) + g[r1 + i + 1] * fx;
        out[y * w + x] = t * (1 - fy) + b * fy;
      }
    }
    return out;
  }
  function fbm(rng, h, w, cell, oct, gain) {
    oct = oct || 4; gain = gain || 0.5;
    const n = h * w, tot = new Float32Array(n);
    let amp = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      const c = cell / Math.pow(2, i);
      if (i > 0 && c < 2) break;
      const nz = noise2d(rng, h, w, c);
      for (let j = 0; j < n; j++) tot[j] += amp * nz[j];
      norm += amp; amp *= gain;
    }
    let mean = 0; for (let j = 0; j < n; j++) { tot[j] /= norm; mean += tot[j]; } mean /= n;
    let v = 0; for (let j = 0; j < n; j++) { const d = tot[j] - mean; v += d * d; }
    const sd = Math.sqrt(v / n) + 1e-6;
    for (let j = 0; j < n; j++) tot[j] = clamp01((tot[j] - mean) / sd * 0.2 + 0.5);
    return tot;
  }
  function noise1d(rng, n, cell, oct) {
    oct = oct || 3;
    const out = new Float32Array(n); let amp = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const c = Math.max(1, cell / Math.pow(2, o));
      const m = Math.floor(n / c) + 4, g = new Float32Array(m); for (let i = 0; i < m; i++) g[i] = rng.random() * 2 - 1;
      for (let i = 0; i < n; i++) { const xs = i / c, k = xs | 0; let f = xs - k; f = f * f * (3 - 2 * f); out[i] += amp * (g[k] * (1 - f) + g[k + 1] * f); }
      norm += amp; amp *= 0.5;
    }
    for (let i = 0; i < n; i++) out[i] /= norm;
    return out;
  }
  function interp1(arr, q) { // linear, clamped
    if (q <= 0) return arr[0];
    const n = arr.length; if (q >= n - 1) return arr[n - 1];
    const i = q | 0, f = q - i; return arr[i] * (1 - f) + arr[i + 1] * f;
  }
  function coverMask(field, frac, soft) {
    const n = field.length, out = new Float32Array(n);
    frac = Math.min(1, Math.max(0, frac));
    if (frac <= 0) return out;
    if (frac >= 1) { out.fill(1); return out; }
    const s = new Float32Array(Math.ceil(n / 7)); for (let i = 0, j = 0; i < n; i += 7, j++) s[j] = field[i];
    s.sort(); const thr = s[Math.min(s.length - 1, Math.floor((1 - frac) * s.length))];
    for (let i = 0; i < n; i++) out[i] = sstep(thr - soft, thr + soft, field[i]);
    return out;
  }
  function worley(rng, w, h, cell, wx, wy, ampl) { // wx, wy: warp maps
    const gh = Math.floor(h / cell) + 5, gw = Math.floor(w / cell) + 5, N = gh * gw;
    const jx = new Float32Array(N), jy = new Float32Array(N), rv = new Float32Array(N);
    for (let i = 0; i < N; i++) { jx[i] = rng.random(); jy[i] = rng.random(); rv[i] = rng.random(); }
    const d1 = new Float32Array(w * h), d2 = new Float32Array(w * h), cid = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, X = x + (wx[i] - 0.5) * ampl, Y = y + (wy[i] - 0.5) * ampl;
      const cx = Math.max(0, Math.floor(X / cell)) + 1, cy = Math.max(0, Math.floor(Y / cell)) + 1;
      let a = 1e9, b = 1e9, id = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = Math.min(gw - 1, cx + ox), gy = Math.min(gh - 1, cy + oy), gi = gy * gw + gx;
        const px = (gx - 1 + jx[gi]) * cell, py = (gy - 1 + jy[gi]) * cell;
        const d = Math.hypot(X - px, Y - py);
        if (d < a) { b = a; a = d; id = rv[gi]; } else if (d < b) b = d;
      }
      d1[i] = a; d2[i] = b; cid[i] = id;
    }
    return { d1, d2, cid };
  }

  // ───────────── canvas helpers ─────────────
  function mkCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function chanFromCanvas(cv, w, h) {
    const d = cv.getContext('2d').getImageData(0, 0, w, h).data, o = new Float32Array(w * h);
    for (let i = 0; i < o.length; i++) o[i] = d[i * 4] / 255;
    return o;
  }
  function grayCanvas(w, h) { const c = mkCanvas(w, h), g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); return { c, g }; }
  const gray = (v) => 'rgb(' + v + ',' + v + ',' + v + ')';

  // ───────────── context ─────────────
  function Ctx(h, w, u, seed) { this.h = h; this.w = w; this.u = u; this.seed = seed; this.size = Math.min(h, w); }
  Ctx.prototype.rng = function (name) { return new RNG(this.seed, K[name]); };

  function agedPaper(tint, fade) {
    const g = TINT_GAIN[tint] || TINT_GAIN.none;
    return [0, 1, 2].map((i) => PAPER[i] * (1 + (g[i] - 1) * fade * 0.55));
  }
  function paperTexture(E, rng, paper) {
    const { h, w, u } = E, a = fbm(rng, h, w, u * 40, 3), b = noise2d(rng, h, w, u * 1.6), out = new Float32Array(h * w * 3);
    for (let i = 0; i < h * w; i++) {
      const t = (a[i] - 0.5) * 0.06 + (b[i] - 0.5) * 0.05;
      out[i * 3] = clamp01(paper[0] + t); out[i * 3 + 1] = clamp01(paper[1] + t); out[i * 3 + 2] = clamp01(paper[2] + t);
    }
    return out;
  }

  // ───────────── prepare ─────────────
  function prepare(srcData, sw, sh, maxSide) {
    let w = sw, h = sh;
    const full = mkCanvas(sw, sh), fg = full.getContext('2d');
    fg.fillStyle = '#fff'; fg.fillRect(0, 0, sw, sh);
    const tmp = mkCanvas(sw, sh); tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(srcData), sw, sh), 0, 0);
    fg.drawImage(tmp, 0, 0);
    let cv = full;
    if (maxSide && Math.max(sw, sh) > maxSide) {
      const k = maxSide / Math.max(sw, sh); w = Math.max(1, Math.round(sw * k)); h = Math.max(1, Math.round(sh * k));
      cv = mkCanvas(w, h); const g = cv.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(full, 0, 0, w, h);
    }
    const d = cv.getContext('2d').getImageData(0, 0, w, h).data, img = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { img[i * 3] = d[i * 4] / 255; img[i * 3 + 1] = d[i * 4 + 1] / 255; img[i * 3 + 2] = d[i * 4 + 2] / 255; }
    return { img, w, h };
  }

  // ───────────── effects ─────────────
  function fxBorder(img, w, h, a, u0, seed) {
    const size = Math.min(h, w), rng = new RNG(seed, K.border), b = (0.012 + 0.085 * a) * size;
    let L = Math.floor(b * rng.uniform(0.8, 1.2)), R = Math.floor(b * rng.uniform(0.8, 1.2));
    let T = Math.floor(b * rng.uniform(0.8, 1.2)), B = Math.floor(b * rng.uniform(0.8, 1.2));
    B = Math.floor(B * (1 + 0.9 * a * rng.uniform(0.3, 1)));
    const H = h + T + B, W = w + L + R, E = new Ctx(H, W, u0, seed);
    const paper = paperTexture(E, rng, PAPER);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = ((y + T) * W + x + L) * 3; paper[d] = img[s]; paper[d + 1] = img[s + 1]; paper[d + 2] = img[s + 2];
    }
    return { img: paper, w: W, h: H };
  }

  function fxWaterWarp(img, a, E) {
    const rng = E.rng('water'), { h, w, u } = E, n = h * w;
    const big = fbm(rng, h, w, u * 160, 3), big2 = fbm(rng, h, w, u * 160, 3), fine = noise2d(rng, h, w, u * 14), fine2 = noise2d(rng, h, w, u * 14);
    const amp = u * 30 * a, out = new Float32Array(n * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      sample(img, w, h, 3, x + (big[i] - 0.5) * amp * 1.6 + (fine[i] - 0.5) * u * 5 * a, y + (big2[i] - 0.5) * amp * 1.6 + (fine2[i] - 0.5) * u * 5 * a, out, i * 3);
    }
    const m = coverMask(fbm(rng, h, w, u * 200, 3), 0.1 + 0.45 * a, 0.08), blur = gauss(out, w, h, 3, u * (3 + 9 * a));
    for (let i = 0; i < n; i++) { const k = m[i] * 0.75; for (let c = 0; c < 3; c++) out[i * 3 + c] = out[i * 3 + c] * (1 - k) + blur[i * 3 + c] * k; }
    return out;
  }

  function fxWaterMarks(img, a, E, paper) {
    const rng = E.rng('water'); for (let i = 0; i < 5; i++) rng.random();
    const { h, w, u } = E, n = h * w, tone = [0.55, 0.40, 0.22];
    const nz = fbm(rng, h, w, u * 230, 4), m = coverMask(nz, 0.12 + 0.34 * a, 0.012), ms = gauss(m, w, h, 1, u * 2.2), inside = gauss(m, w, h, 1, u * 8);
    const drip = noise2d(rng, h, w, u * 220, u * 9), dm0 = coverMask(drip, 0.05 + 0.2 * a, 0.05);
    const dm = new Float32Array(n); for (let i = 0; i < n; i++) dm[i] = dm0[i] * sstep(0.35, 0.8, nz[i]);
    const dms = gauss(dm, w, h, 1, u * 1.2);
    for (let i = 0; i < n; i++) {
      const tide = clamp01(Math.abs(m[i] - ms[i]) * 3 * 2.4), k = inside[i] * 0.14 * a, dk = dms[i] * 0.35;
      for (let c = 0; c < 3; c++) {
        let v = img[i * 3 + c] * (1 - tide * 0.55 * (1 - tone[c]));
        v = v + (paper[c] - v) * k;
        img[i * 3 + c] = v * (1 - dk * (1 - tone[c]));
      }
    }
    return img;
  }

  function fxFade(img, E, a, tint) {
    // dye fade is NOT uniform: frame edges and blotchy patches lose more colour
    const { h, w, u } = E, n = h * w, rng = E.rng('fademap'), field = fbm(rng, h, w, u * 300, 3);
    const G = TINT_GAIN[tint], B = TINT_BLACK[tint];
    for (let y = 0; y < h; y++) {
      const ey = Math.abs(y / h * 2 - 1);
      for (let x = 0; x < w; x++) {
        const i = y * w + x, ex = Math.abs(x / w * 2 - 1), e = Math.max(ex, ey), edge = e * e * e;
        const am = clamp01(a * (0.78 + 0.9 * (field[i] - 0.5) + 0.38 * edge));
        const l = lumaAt(img, i * 3);
        for (let c = 0; c < 3; c++) {
          let v = l + (img[i * 3 + c] - l) * (1 - 0.78 * am);
          v *= 1 + (G[c] - 1) * am;
          v = B[c] * 0.12 * am + v * (1 - 0.22 * am);
          v = 0.5 + (v - 0.5) * (1 - 0.32 * am);
          img[i * 3 + c] = clamp01(v);
        }
      }
    }
    return img;
  }

  function fxRelief(img, a, fade, E) {
    // physical-object feel: lamp falloff + curl, paper-fibre relief lit from one side, lost fine detail
    const { h, w, u } = E, n = h * w, rng = E.rng('relief');
    const ang = rng.uniform(0, 2 * PI), ca = Math.cos(ang), sa = Math.sin(ang);
    const low = fbm(rng, h, w, u * 380, 2), fine = noise2d(rng, h, w, u * 2.2), coarse = noise2d(rng, h, w, u * 13);
    const hgt = new Float32Array(n); for (let i = 0; i < n; i++) hgt[i] = 0.65 * fine[i] + 0.35 * coarse[i];
    const d = new Float32Array(n); let m = 0;
    for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) { const i = y * w + x, v = hgt[i] - hgt[i - w - 1]; d[i] = v; m += v; }
    m /= n; let vr = 0; for (let i = 0; i < n; i++) { const t = d[i] - m; vr += t * t; }
    const sd = Math.sqrt(vr / n) + 1e-6;
    if (fade > 0) {
      const sig = 0.8 * u + 0.8 * u * fade, k = 0.55 * fade;
      for (let c = 0; c < 3; c++) {
        const ch = new Float32Array(n); for (let i = 0; i < n; i++) ch[i] = img[i * 3 + c];
        const sm = gauss(ch, w, h, 1, sig);
        for (let i = 0; i < n; i++) img[i * 3 + c] += (sm[i] - ch[i]) * k;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, slope = (x / w - 0.5) * ca + (y / h - 0.5) * sa;
        const light = 1 + a * (0.12 * slope + 0.20 * (low[i] - 0.5)) + (d[i] / sd) * (0.010 + 0.022 * a);
        for (let c = 0; c < 3; c++) img[i * 3 + c] = clamp01(img[i * 3 + c] * light);
      }
    }
    return img;
  }

  function fxMirror(img, a, E) {
    const rng = E.rng('mirror'), { h, w, u } = E, n = h * w, nz = fbm(rng, h, w, u * 90, 4), m = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, d = Math.min(Math.min(x, w - 1 - x), Math.min(y, h - 1 - y)) / (0.28 * E.size), edge = 1 - clamp01(d), l = lumaAt(img, i * 3);
      m[i] = sstep(0.42, 0.06, l) * sstep(0.28, 0.85, edge * 0.75 + nz[i] * 0.75 - 0.2) * a;
    }
    const ms = gauss(m, w, h, 1, u * 1.5), sh = [0.5, 0.58, 0.7];
    for (let i = 0; i < n; i++) {
      const l = lumaAt(img, i * 3), k = ms[i] * 0.85;
      for (let c = 0; c < 3; c++) img[i * 3 + c] = img[i * 3 + c] * (1 - k) + sh[c] * (0.65 + 0.9 * l + 0.25 * nz[i]) * k;
    }
    return img;
  }

  function fxStain(img, a, E, paper) {
    const rng = E.rng('stain'), { h, w, u } = E, tone = [0.6, 0.42, 0.22], n = h * w;
    const rings = Math.round(1 + 4 * a);
    for (let r0 = 0; r0 < rings; r0++) {
      const r = u * rng.uniform(70, 240), cx = rng.uniform(0, w), cy = rng.uniform(0, h);
      const x0 = Math.floor(Math.max(0, cx - 1.8 * r)), x1 = Math.floor(Math.min(w, cx + 1.8 * r)), y0 = Math.floor(Math.max(0, cy - 1.8 * r)), y1 = Math.floor(Math.min(h, cy + 1.8 * r));
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const sw = x1 - x0, sh = y1 - y0, nz = fbm(rng, sh, sw, r * 0.6, 3), strength = rng.uniform(0.5, 1) * (0.35 + 0.65 * a);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r + (nz[(y - y0) * sw + (x - x0)] - 0.5) * 0.55;
        const ring = Math.exp(-Math.pow((d - 1) / 0.07, 2)), fill = sstep(1.06, 0.9, d) * 0.28, s = clamp01(ring * 0.9 + fill) * strength, i = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) img[i + c] *= 1 - s * (1 - tone[c]);
      }
    }
    // foxing
    const dens = coverMask(fbm(rng, h, w, u * 150, 3), 0.18 + 0.2 * a, 0.12), { c: sc, g: sg } = grayCanvas(w, h);
    const count = Math.floor((150 + 1600 * a) * h * w / 1e6);
    for (let k = 0; k < count; k++) {
      const x = rng.uniform(0, w), y = rng.uniform(0, h), keep = rng.random() < dens[Math.min(h - 1, y | 0) * w + Math.min(w - 1, x | 0)];
      if (!keep) { rng.random(); rng.random(); continue; }
      const r = Math.max(0.8, rng.lognormal(0.2, 0.55) * 1.6 * u);
      sg.fillStyle = gray(Math.floor(70 + rng.random() * 160)); sg.beginPath(); sg.arc(x, y, r, 0, 2 * PI); sg.fill();
    }
    const sp = gauss(chanFromCanvas(sc, w, h), w, h, 1, 0.7 * u), rust = [0.5, 0.3, 0.14];
    for (let i = 0; i < n; i++) { const k = sp[i] * a * 0.75; for (let c = 0; c < 3; c++) img[i * 3 + c] *= 1 - k * (1 - rust[c]); }
    // mold
    const mf = fbm(rng, h, w, u * 60, 5), speck = noise2d(rng, h, w, u * 1.8), mold = new Float32Array(n), ma = Math.pow(a, 1.3);
    for (let i = 0; i < n; i++) mold[i] = sstep(0.64, 0.78, mf[i] + (a - 0.5) * 0.15) * ma * (0.55 + 0.9 * speck[i]);
    const mg = gauss(mold, w, h, 1, u * 1.2), green = [0.52, 0.58, 0.46];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) img[i * 3 + c] = img[i * 3 + c] * (1 - mg[i] * 0.55) + green[c] * mg[i] * 0.35;
    return img;
  }

  function fxCrack(img, a, E, paper) {
    const rng = E.rng('crack'), { h, w, u } = E, n = h * w, cell = u * 34;
    const wx = fbm(rng, h, w, u * 60, 3), wy = fbm(rng, h, w, u * 60, 3);
    const { d1, d2, cid } = worley(rng, w, h, cell, wx, wy, cell * 1.2);
    const cov = coverMask(fbm(rng, h, w, u * 190, 3), 0.25 + 0.6 * a, 0.07), fine = noise2d(rng, h, w, u * 5);
    const pale = paper.map((p) => Math.min(1, p * 1.03 + 0.03));
    for (let i = 0; i < n; i++) {
      const edge = d2[i] - d1[i], line = (1 - sstep(0, (0.9 + 0.8 * a) * u, edge)) * (0.55 + 0.45 * fine[i]);
      const shade = Math.exp(-Math.pow((edge - 2.4 * u) / (1.1 * u), 2)) * 0.32, cv = cov[i], k = line * cv * 0.8;
      for (let c = 0; c < 3; c++) {
        let v = img[i * 3 + c] * (1 + (cid[i] - 0.5) * 0.12 * cv); v *= 1 - shade * cv;
        img[i * 3 + c] = v + (pale[c] - v) * k;
      }
    }
    return img;
  }

  function fxPeel(img, a, E, paper) {
    const rng = E.rng('peel'), { h, w, u } = E, n = h * w;
    const nz = fbm(rng, h, w, u * 70, 5), jag = fbm(rng, h, w, u * 9, 3), f = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, d = Math.min(Math.min(x, w - 1 - x), Math.min(y, h - 1 - y)) / (0.3 * E.size);
      f[i] = nz[i] + 0.55 * Math.pow(1 - clamp01(d), 1.5) + (jag[i] - 0.5) * 0.22;
    }
    const m = coverMask(f, 0.3 * Math.pow(a, 1.3), 0.012), ms = gauss(m, w, h, 1, u * 1.3);
    const sh0 = shiftMap(gauss(m, w, h, 1, u * 4), w, h, 1, 2.2 * u, 2.8 * u), base = paperTexture(E, rng, paper), nb = noise2d(rng, h, w, u * 30);
    for (let i = 0; i < n; i++) {
      const ridge = Math.abs(m[i] - ms[i]) * 2.2, shadow = sh0[i] * (1 - m[i]) * 0.5, k = ms[i], bt = 0.88 + 0.12 * nb[i];
      for (let c = 0; c < 3; c++) {
        let v = img[i * 3 + c] * (1 - shadow); v = v * (1 - k) + base[i * 3 + c] * bt * k;
        img[i * 3 + c] = clamp01(v + ridge * 0.28 * (1 - 0.3 * v));
      }
    }
    return img;
  }

  function fxCrease(img, a, E, paper) {
    const rng = E.rng('crease'), { h, w, u } = E, n = h * w, count = Math.max(1, Math.round(a * 5.2)), L = Math.floor(Math.hypot(h, w) * 2) + 4;
    for (let cI = 0; cI < count; cI++) {
      const ang = rng.random() < 0.6 ? (rng.random() < 0.5 ? 0 : PI / 2) + rng.uniform(-0.45, 0.45) : rng.uniform(0, PI);
      const px = rng.uniform(0.15, 0.85) * w, py = rng.uniform(0.15, 0.85) * h, tx = Math.cos(ang), ty = Math.sin(ang), nx = -ty, ny = tx;
      const wobA = noise1d(rng, L, u * 90, 3), brkA = noise1d(rng, L, u * 22, 3), strength = rng.uniform(0.6, 1) * (0.45 + 0.55 * a);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x - px, dy = y - py, t = dx * tx + dy * ty, q = t + L / 2;
        const s = dx * nx + dy * ny + interp1(wobA, q) * u * 7;
        if (Math.abs(s) > 60 * u) continue;
        const brk = interp1(brkA, q), i = (y * w + x) * 3;
        const white = Math.exp(-Math.pow(s / (0.85 * u), 2)) * sstep(-0.25, 0.25, brk) * strength;
        const dark = Math.exp(-Math.pow((s - 1.8 * u) / (1.3 * u), 2)) * 0.22 * strength;
        const light = Math.tanh(s / (7 * u)) * 0.07 * strength, wear = Math.exp(-Math.pow(s / (14 * u), 2)) * 0.12 * strength;
        for (let c = 0; c < 3; c++) img[i + c] = img[i + c] * (1 - dark) + light;
        const l = lumaAt(img, i);
        for (let c = 0; c < 3; c++) {
          let v = img[i + c] + (l - img[i + c]) * wear * 0.6; v = v + (Math.min(1, paper[c] * 1.04) - v) * white * 0.9; img[i + c] = clamp01(v);
        }
      }
    }
    return img;
  }

  function fxDust(img, a, E) {
    const rng = E.rng('dust'), { h, w, u } = E, n = h * w, area = h * w / 1e6;
    const L = grayCanvas(w, h), D = grayCanvas(w, h), cnt = Math.floor((60 + 900 * a) * area);
    for (let k = 0; k < cnt; k++) {
      const x = rng.random() * w, y = rng.random() * h, r = Math.max(0.55, rng.lognormal(0, 0.6) * 0.85 * u), g = rng.random() < 0.6 ? L.g : D.g;
      g.fillStyle = gray(Math.floor(110 + rng.random() * 145)); g.beginPath(); g.ellipse(x, y, r, r * rng.uniform(0.6, 1), 0, 0, 2 * PI); g.fill();
    }
    const wd = Math.max(1, Math.round(0.9 * u));
    const strokes = (g, pts, v) => { g.strokeStyle = gray(v); g.lineWidth = wd; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); };
    const hairs = Math.floor((4 + 40 * a) * area);
    for (let k = 0; k < hairs; k++) {
      let x = rng.random() * w, y = rng.random() * h, ang = rng.random() * 6.283; const pts = [[x, y]], steps = rng.int(8, 28);
      for (let s = 0; s < steps; s++) { ang += rng.normal(0, 0.35); x += Math.cos(ang) * rng.uniform(3, 6) * u; y += Math.sin(ang) * rng.uniform(3, 6) * u; pts.push([x, y]); }
      strokes(rng.random() < 0.55 ? L.g : D.g, pts, Math.floor(90 + rng.random() * 150));
    }
    const scr = Math.round(a * 9 * Math.max(0.6, area));
    for (let k = 0; k < scr; k++) {
      const x = rng.random() * w, y0 = rng.random() * h, y1 = y0 + rng.uniform(0.1, 0.8) * h, ph = rng.random() * 6, pts = [];
      for (let y = y0; y < y1; y += 6 * u) pts.push([x + Math.sin(y / (30 * u) + ph) * 1.5 * u + rng.normal(0, 0.25), y]);
      if (pts.length > 1) strokes(rng.random() < 0.7 ? L.g : D.g, pts, Math.floor(110 + rng.random() * 140));
    }
    const lm = gauss(chanFromCanvas(L.c, w, h), w, h, 1, 0.65 * u), dm = gauss(chanFromCanvas(D.c, w, h), w, h, 1, 0.65 * u);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { let v = img[i * 3 + c]; v = v + (1 - v) * lm[i] * 0.85; img[i * 3 + c] = v * (1 - dm[i] * 0.75); }
    return img;
  }

  function fxGrain(img, a, E) {
    const rng = E.rng('grain'), { h, w, u } = E, n = h * w, g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = rng.normal();
    const gs = gauss(g, w, h, 1, 0.55 * u), amp = 0.012 + 0.11 * a;
    let gm = 0, gv = 0; for (let i = 0; i < n; i++) gm += gs[i]; gm /= n; for (let i = 0; i < n; i++) { const d = gs[i] - gm; gv += d * d; } const gk = 0.8 / (Math.sqrt(gv / n) + 1e-6);
    for (let i = 0; i < n; i++) {
      const l = lumaAt(img, i * 3), wt = 1 - Math.abs(l - 0.5) * 1.1, base = gs[i] * gk;
      for (let c = 0; c < 3; c++) img[i * 3 + c] = clamp01(img[i * 3 + c] + (base + rng.normal() * 0.35) * amp * wt);
    }
    return img;
  }

  function aa(s) { s += 0.5; return s < 0 ? 0 : s > 1 ? 1 : s; }
  function makeCut(E, rng, anchor, normal, depth, rough, rim, cell) {
    const { h, w } = E, nx = normal[0], ny = normal[1], tx = -ny, ty = nx, L = Math.floor(Math.hypot(h, w) * 2) + 4;
    const c1 = noise1d(rng, L, cell, 3), c2 = noise1d(rng, L, Math.max(2, cell * 0.12), 2), rn = noise1d(rng, L, cell * 0.35, 3);
    const off = new Float32Array(L), rimA = new Float32Array(L);
    for (let i = 0; i < L; i++) { off[i] = rough * (c1[i] + 0.45 * c2[i]); rimA[i] = rn[i] * 0.5 + 0.5; }
    const sIn = new Float32Array(w * h), sOut = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x - anchor[0], py = y - anchor[1], q = (px * tx + py * ty) + L / 2, i = y * w + x;
      const si = px * nx + py * ny - depth + interp1(off, q);
      sIn[i] = si; sOut[i] = si + rim * (0.35 + 1.1 * interp1(rimA, q));
    }
    return { sIn, sOut };
  }
  function minInto(dst, src) { for (let i = 0; i < dst.length; i++) if (src[i] < dst[i]) dst[i] = src[i]; }

  function fxDestroyEdges(img, E, paper, p) {
    const { h, w, u, size } = E, n = h * w, Ai = new Float32Array(n).fill(1e6), Ap = new Float32Array(n).fill(1e6);
    const rT = E.rng('tear'), rC = E.rng('corner'), rB = E.rng('burn');
    const edges = [[[0, h / 2], [1, 0]], [[w, h / 2], [-1, 0]], [[w / 2, 0], [0, 1]], [[w / 2, h], [0, -1]]];
    const corners = [[0, 0], [w, 0], [0, h], [w, h]];
    let a = p.tear;
    if (a > 0) for (const [anchor, nrm] of edges) {
      if (rT.random() < Math.min(1, 0.3 + 1.3 * a)) {
        const depth = rT.uniform(0.15, 1) * a * 0.035 * size, c = makeCut(E, rT, anchor, nrm, depth, u * (2 + 9 * a), u * (2 + 6 * a), u * rT.uniform(18, 40));
        minInto(Ai, c.sIn); minInto(Ap, c.sOut);
      }
    }
    a = p.corner;
    if (a > 0) {
      const order = [0, 1, 2, 3].sort(() => rC.random() - 0.5), cnt = Math.max(1, Math.round(a * 3.2));
      for (let k = 0; k < cnt; k++) {
        const [cx, cy] = corners[order[k]], base = Math.atan2(h / 2 - cy, w / 2 - cx) + rC.uniform(-0.45, 0.45), depth = size * rC.uniform(0.04, 0.13) * (0.6 + 0.9 * a);
        const c = makeCut(E, rC, [cx, cy], [Math.cos(base), Math.sin(base)], depth, u * (7 + 16 * a), u * (3 + 7 * a), u * 55);
        minInto(Ai, c.sIn); minInto(Ap, c.sOut);
      }
    }
    a = p.burn;
    if (a > 0) {
      const c1 = u * (5 + 9 * a), c2 = u * (30 + 70 * a), Sb = new Float32Array(n).fill(1e6), reps = 1 + Math.floor(a * 2.5);
      for (let k = 0; k < reps; k++) {
        let depth = size * rB.uniform(0.05, 0.12 + 0.2 * a), anchor, nrm;
        if (rB.random() < 0.7) { const [cx, cy] = corners[rB.int(0, 4)], base = Math.atan2(h / 2 - cy, w / 2 - cx) + rB.uniform(-0.5, 0.5); anchor = [cx, cy]; nrm = [Math.cos(base), Math.sin(base)]; }
        else { const e = edges[rB.int(0, 4)]; anchor = e[0]; nrm = e[1]; depth *= 0.5; }
        minInto(Sb, makeCut(E, rB, anchor, nrm, depth, depth * 0.28, 0, depth * 0.7).sIn);
      }
      const holes = fbm(rB, h, w, u * 22, 4), em = noise2d(rB, h, w, u * 6), scorch = [0.34, 0.17, 0.08], charC = [0.04, 0.03, 0.025];
      for (let i = 0; i < n; i++) {
        let s = Sb[i] + (holes[i] - 0.5) * u * (60 + 80 * a) * sstep(c2 * 1.8, 0, Sb[i]);
        Sb[i] = s;
        const g = Math.pow(sstep(c2, 0, s), 0.8), ch = sstep(c1, 0, s), ember = Math.exp(-Math.pow((s - 0.6 * u) / (1.4 * u), 2)) * (0.5 + 0.5 * em[i]) * (s > 0 ? 0.45 : 0);
        for (let c = 0; c < 3; c++) {
          let v = img[i * 3 + c] * (1 + (scorch[c] - 1) * g); v = v * (1 - ch * 0.96) + charC[c] * ch * 0.96;
          img[i * 3 + c] = v + [0.9, 0.35, 0.08][c] * ember;
        }
        if (s < Ai[i]) Ai[i] = s; if (s < Ap[i]) Ap[i] = s;
      }
    }
    const rr = E.rng('tear'); rr.random(); rr.random(); rr.random();
    const fa = noise2d(rr, h, w, u * 1.3), fb = noise2d(rr, h, w, u * 4), tex = paperTexture(E, rr, paper), out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const ai = aa(Ai[i]), ap = aa(Ap[i]), fibre = fa[i] * 0.5 + fb[i] * 0.5, rk = (0.93 + 0.12 * fibre) * (0.9 + 0.1 * sstep(0, 3 * u, Ap[i]));
      for (let c = 0; c < 3; c++) out[i * 4 + c] = clamp01(img[i * 3 + c] * ai + tex[i * 3 + c] * rk * (1 - ai));
      out[i * 4 + 3] = ap;
    }
    return out;
  }

  // ── WIRED
  function rollRows(img, w, y0, y1, dx, ch) { // roll horizontally, optionally one channel
    dx = ((dx % w) + w) % w; if (!dx) return;
    const tmp = new Float32Array(w);
    for (let y = y0; y < y1; y++) for (let c = 0; c < 3; c++) {
      if (ch !== undefined && c !== ch) continue;
      for (let x = 0; x < w; x++) tmp[(x + dx) % w] = img[(y * w + x) * 3 + c];
      for (let x = 0; x < w; x++) img[(y * w + x) * 3 + c] = tmp[x];
    }
  }
  function fxGlitch(img, a, E) {
    const rng = E.rng('glitch'), { h, w } = E, nb = Math.floor(2 + 22 * a);
    for (let k = 0; k < nb; k++) {
      const y = rng.int(0, h), y1 = Math.min(h, y + Math.floor(Math.max(2, rng.exp(0.02 * h) * (0.4 + a))));
      rollRows(img, w, y, y1, Math.trunc(rng.normal(0, 0.05 * w * a)));
      if (rng.random() < 0.5) { const c = rng.int(0, 3); rollRows(img, w, y, y1, Math.trunc(rng.normal(0, 0.02 * w * a)), c); }
      if (rng.random() < 0.1) { const col = [rng.random(), rng.random(), rng.random()]; for (let i = y * w; i < y1 * w; i++) for (let c = 0; c < 3; c++) img[i * 3 + c] = img[i * 3 + c] * 0.45 + col[c] * 0.55; }
    }
    const src = new Float32Array(img), blocks = Math.floor(1 + 8 * a);
    for (let k = 0; k < blocks; k++) {
      const bw = Math.floor(rng.uniform(0.05, 0.3) * w), bh = Math.floor(rng.uniform(0.02, 0.12) * h), sx = rng.int(0, Math.max(1, w - bw)), sy = rng.int(0, Math.max(1, h - bh));
      const dx = Math.min(Math.max(0, Math.round(sx + rng.normal(0, 0.12 * w))), w - bw), dy = Math.min(Math.max(0, Math.round(sy + rng.normal(0, 0.05 * h))), h - bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) for (let c = 0; c < 3; c++) img[((dy + y) * w + dx + x) * 3 + c] = src[((sy + y) * w + sx + x) * 3 + c];
    }
    return img;
  }
  function fxChroma(img, a, E) {
    const { h, w } = E, d = Math.max(1, Math.floor(0.014 * E.size * a)), dy = Math.trunc(d * 0.2), out = new Float32Array(img);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      out[i] = img[(Math.min(h - 1, Math.max(0, y - dy)) * w + Math.min(w - 1, Math.max(0, x - d))) * 3];
      out[i + 2] = img[(Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + d))) * 3 + 2];
    }
    return out;
  }
  function fxScan(img, a, E) {
    const rng = E.rng('scan'), { h, w, u } = E, per = Math.max(2, 3 * u);
    for (let y = 0; y < h; y++) { const k = 1 - 0.3 * a * (0.5 + 0.5 * Math.sin(y * 2 * PI / per)); for (let x = 0; x < w * 3; x++) img[y * w * 3 + x] *= k; }
    const streaks = Math.floor(4 + 40 * a);
    for (let k = 0; k < streaks; k++) { const y = rng.int(0, h), x0 = rng.int(0, w), x1 = Math.min(w, x0 + Math.floor(rng.uniform(0.05, 0.5) * w)), v = rng.random() * 0.45 * a; for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) img[(y * w + x) * 3 + c] += v; }
    const bh = Math.max(4, Math.floor(h * 0.04 * (0.5 + 2 * a)));
    const by = Math.min(Math.floor(h * (0.7 + 0.2 * rng.random())), h - bh), offs = noise1d(rng, bh, 4);
    for (let i = 0; i < bh; i++) rollRows(img, w, by + i, by + i + 1, Math.trunc(offs[i] * 0.05 * w * a));
    for (let y = by; y < by + bh; y++) for (let x = 0; x < w; x++) { const v = (rng.random() - 0.4) * 0.6 * a; for (let c = 0; c < 3; c++) img[(y * w + x) * 3 + c] += v; }
    for (let i = 0; i < img.length; i++) img[i] = clamp01(img[i]);
    return img;
  }
  function fxGhost(img, a, E) {
    const { h, w, u } = E, n = h * w, g = gauss(shiftMap(img, w, h, 3, Math.floor(0.035 * w), -Math.floor(0.02 * h)), w, h, 3, u * 5), tc = [0.65, 0.9, 1];
    for (let i = 0; i < n; i++) { const l = lumaAt(g, i * 3); for (let c = 0; c < 3; c++) img[i * 3 + c] = clamp01(1 - (1 - img[i * 3 + c]) * (1 - l * tc[c] * 0.65 * a)); }
    return img;
  }
  function fxBloom(img, a, E) {
    const { h, w, u } = E, n = h * w, hi = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) hi[i] = Math.max(0, img[i] - 0.5) * 2;
    const b1 = gauss(hi, w, h, 3, u * (10 + 30 * a)), b2 = gauss(hi, w, h, 3, u * 4), tint = [0, 0.03, 0.06];
    for (let i = 0; i < n * 3; i++) {
      const glow = (b1[i] * 0.9 + b2[i] * 0.5) * (0.4 + 1.2 * a), v = 1 - (1 - img[i]) * (1 - clamp01(glow));
      img[i] = clamp01(v + tint[i % 3] * glow + 0.06 * a);
    }
    return img;
  }
  function fxRot(img, a, E) {
    const rng = E.rng('rot'), { h, w, u } = E, lv = Math.max(6, Math.round(64 - 52 * a));
    for (let i = 0; i < img.length; i++) img[i] = Math.round(img[i] * (lv - 1)) / (lv - 1);
    const blocks = Math.floor(1 + 10 * a);
    for (let b = 0; b < blocks; b++) {
      const bw = Math.floor(rng.uniform(0.08, 0.4) * w), bh = Math.floor(rng.uniform(0.04, 0.25) * h), x = rng.int(0, Math.max(1, w - bw)), y = rng.int(0, Math.max(1, h - bh)), k = Math.max(3, Math.floor(rng.int(6, 40) * u));
      const dim = rng.random() < 0.3 ? rng.int(0, 3) : -1, snap = new Float32Array(img);
      for (let yy = y; yy < Math.min(h, y + bh); yy++) for (let xx = x; xx < Math.min(w, x + bw); xx++) {
        const sy = y + Math.floor((yy - y) / k) * k, sx = x + Math.floor((xx - x) / k) * k;
        for (let c = 0; c < 3; c++) img[(yy * w + xx) * 3 + c] = snap[(sy * w + sx) * 3 + c] * (c === dim ? 0.3 : 1);
      }
    }
    const bad = Math.floor(20 * a * h * w / 1e6) + 2;
    for (let b = 0; b < bad; b++) {
      const bx = rng.int(0, Math.max(1, w - 8)), by = rng.int(0, Math.max(1, h - 8)), m = [0, 0, 0];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let c = 0; c < 3; c++) m[c] += img[((by + y) * w + bx + x) * 3 + c] / 64;
      const f = rng.uniform(0.8, 1.2);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let c = 0; c < 3; c++) img[((by + y) * w + bx + x) * 3 + c] = m[c] * f;
    }
    for (let i = 0; i < img.length; i++) img[i] = clamp01(img[i]);
    return img;
  }

  // ── DIGITAL KILL
  function fxSort(img, a, E) {
    const rng = E.rng('sort'), { h, w, u } = E, n = h * w, out = new Float32Array(img), lum = lumaMap(img, n);
    const vertical = rng.random() < 0.35, lo = rng.uniform(0.15, 0.3), hi = rng.uniform(0.75, 0.95);
    const H = vertical ? w : h, Wd = vertical ? h : w, sel = noise1d(rng, H, 24 * u, 3), minlen = Math.max(4, Math.floor(5 * u));
    const px = (r, c) => (vertical ? c * w + r : r * w + c), ok = (r, c) => { const l = lum[px(r, c)]; return l > lo && l < hi; };
    for (let r = 0; r < H; r++) {
      if (!(sel[r] > 0.35 - 0.9 * a)) continue;
      let c = 0;
      while (c < Wd) {
        if (!ok(r, c)) { c++; continue; }
        const s = c; while (c < Wd && ok(r, c)) c++;
        if (c - s < minlen) continue;
        const ids = []; for (let k = s; k < c; k++) ids.push(k);
        ids.sort((p, q) => lum[px(r, p)] - lum[px(r, q)]);
        for (let k = 0; k < ids.length; k++) { const d = px(r, s + k) * 3, sI = px(r, ids[k]) * 3; out[d] = img[sI]; out[d + 1] = img[sI + 1]; out[d + 2] = img[sI + 2]; }
      }
    }
    return out;
  }
  function fxMelt(img, a, E) {
    const rng = E.rng('melt'), { h, w, u } = E, out = new Float32Array(img);
    let x = 0;
    while (x < w) {
      const cw = Math.max(1, Math.floor(rng.uniform(1.5, 14) * u));
      if (rng.random() < 0.15 + 0.6 * a) {
        const y0 = Math.floor(h * rng.uniform(0.12, 0.95)), y1 = Math.min(h, y0 + Math.max(4, Math.floor(h * rng.uniform(0.05, 0.6) * (0.3 + a))));
        if (y1 - y0 > 3 && y0 > 3) {
          for (let xx = x; xx < Math.min(w, x + cw); xx++) {
            const s = [0, 0, 0]; for (let k = 1; k <= 3; k++) for (let c = 0; c < 3; c++) s[c] += img[((y0 - k) * w + xx) * 3 + c] / 3;
            for (let y = y0; y < y1; y++) {
              const t = (y - y0) / Math.max(1, y1 - y0 - 1), keep = sstep(0.55, 1, t), i = (y * w + xx) * 3;
              for (let c = 0; c < 3; c++) out[i + c] = s[c] * (1 - 0.18 * t) * (1 - keep) + out[i + c] * keep;
            }
          }
        }
      }
      x += cw;
    }
    return out;
  }
  function fxCorrupt(img, a, E) {
    const rng = E.rng('corrupt'), { h, w, u } = E, n = h * w, bl = gauss(img, w, h, 3, 1.2 * u), out = new Float32Array(img.length);
    for (let i = 0; i < n; i++) {
      const v = [0, 1, 2].map((c) => img[i * 3 + c] + (img[i * 3 + c] - bl[i * 3 + c]) * 0.9 * a), l = v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = l + (v[c] - l) * (1 + 0.8 * a);
    }
    const f = Math.max(2, Math.floor((2 + 10 * a) * u)), blend = Math.min(1, 1.4 * a);
    for (let by = 0; by < h; by += f) for (let bx = 0; bx < w; bx += f) {
      const ye = Math.min(h, by + f), xe = Math.min(w, bx + f), m = [0, 0, 0]; let cnt = 0;
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 3, l = lumaAt(out, i); for (let c = 0; c < 3; c++) m[c] += out[i + c] - l; cnt++; }
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 3, l = lumaAt(out, i); for (let c = 0; c < 3; c++) out[i + c] += (l + m[c] / cnt - out[i + c]) * blend; }
    }
    const b = new Uint8Array(n * 3); for (let i = 0; i < b.length; i++) b[i] = Math.round(clamp01(out[i]) * 255);
    const runs = Math.floor(4 + 50 * a);
    for (let k = 0; k < runs; k++) {
      const s = rng.int(0, b.length), ln = Math.max(3, Math.floor(rng.exp(0.05 * w * 3 * (0.3 + a)))), e = Math.min(b.length, s + ln), mode = rng.int(0, 3), v = rng.int(1, 256);
      for (let i = s; i < e; i++) b[i] = mode === 0 ? b[i] ^ v : mode === 1 ? (b[i] + v) & 255 : rng.int(0, 256);
    }
    for (let i = 0; i < b.length; i++) out[i] = b[i] / 255;
    return out;
  }
  const DEAD = [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1]];
  function fillRect(a, w, h, x0, y0, x1, y1, c) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 3; a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; }
  }
  function fxMosh(img, a, E) {
    // datamosh: macroblocks keep old motion vectors and drift; a held column is dragged across a band
    const rng = E.rng('mosh'), { h, w, u } = E, out = new Float32Array(img), bs = Math.max(8, Math.round(u * rng.pick([18, 24, 32, 48])));
    for (let k = 0, N = Math.floor(3 + 40 * a); k < N; k++) {
      const bw = bs * rng.int(1, 5), bh = bs * rng.int(1, 3);
      if (bw >= w || bh >= h) continue;
      const x = rng.int(0, w - bw), y = rng.int(0, h - bh), dx = Math.round(rng.normal(0, bs * 3 * (0.5 + a))), dy = Math.round(rng.normal(0, bs * 1.2 * (0.5 + a)));
      const sx = Math.min(Math.max(0, x + dx), w - bw), sy = Math.min(Math.max(0, y + dy), h - bh);
      for (let yy = 0; yy < bh; yy++) { const d = ((y + yy) * w + x) * 3, s = ((sy + yy) * w + sx) * 3; for (let i = 0; i < bw * 3; i++) out[d + i] = img[s + i]; }
    }
    for (let k = 0, S = Math.floor(1 + 10 * a); k < S; k++) {
      const y = rng.int(0, h), bh = Math.min(h - y, Math.max(4, Math.floor(rng.uniform(4, 40) * u))), x = rng.int(0, Math.floor(w * 0.9)), ln = Math.min(w - x, Math.floor(rng.uniform(0.08, 0.5) * w * (0.4 + a)));
      for (let yy = y; yy < y + bh; yy++) { const b = (yy * w + x) * 3; for (let xx = 1; xx < ln; xx++) { const d = b + xx * 3; out[d] = out[b]; out[d + 1] = out[b + 1]; out[d + 2] = out[b + 2]; } }
    }
    return out;
  }
  function fxJpeg(img, a, E) {
    // JPEG death: chroma subsampling, blocky luma, banding, tiles with a wrong DC value
    const rng = E.rng('jpeg'), { h, w, u } = E, n = h * w, B = Math.max(4, Math.round(11 * u)), F = B * 2, out = new Float32Array(img.length), Y = lumaMap(img, n);
    const nbx = Math.ceil(w / B), nby = Math.ceil(h / B), fx = Math.ceil(w / F), fy = Math.ceil(h / F), bad = new Float32Array(nbx * nby * 4), pb = 0.004 + 0.03 * a;
    for (let i = 0; i < nbx * nby; i++) if (rng.random() < pb) { bad[i * 4] = rng.normal(0, 0.18); for (let c = 0; c < 3; c++) bad[i * 4 + 1 + c] = rng.normal(0, 0.12); }
    const Yb = new Float32Array(nbx * nby), Cm = new Float32Array(fx * fy * 3);
    for (let by = 0; by < nby; by++) for (let bx = 0; bx < nbx; bx++) {
      let s = 0, c = 0; for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) { s += Y[y * w + x]; c++; }
      Yb[by * nbx + bx] = s / c;
    }
    for (let by = 0; by < fy; by++) for (let bx = 0; bx < fx; bx++) {
      const m = [0, 0, 0]; let c = 0;
      for (let y = by * F; y < Math.min(h, by * F + F); y++) for (let x = bx * F; x < Math.min(w, bx * F + F); x++) { const i = y * w + x; for (let k = 0; k < 3; k++) m[k] += img[i * 3 + k] - Y[i]; c++; }
      for (let k = 0; k < 3; k++) Cm[(by * fx + bx) * 3 + k] = m[k] / c;
    }
    const kc = Math.min(1, 1.5 * a), q = 40 - 32 * a;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, bi = Math.floor(y / B) * nbx + Math.floor(x / B), fi = Math.floor(y / F) * fx + Math.floor(x / F);
      let yv = Y[i] + (Yb[bi] - Y[i]) * 0.8 * a + bad[bi * 4];
      yv += (Math.round(yv * q) / q - yv) * a;
      for (let c = 0; c < 3; c++) { let cv = img[i * 3 + c] - Y[i]; cv += (Cm[fi * 3 + c] - cv) * kc + bad[bi * 4 + 1 + c]; out[i * 3 + c] = clamp01(yv + cv); }
    }
    return out;
  }
  function fxDead(img, a, E) {
    // dead hardware: stuck columns / rows, dead blocks, hot pixels
    const rng = E.rng('dead'), { h, w, u } = E, col = () => DEAD[rng.int(0, 7)];
    for (let k = 0, N = Math.floor(1 + 9 * a); k < N; k++) {
      const x = rng.int(0, w), lw = Math.max(1, Math.round(u * rng.uniform(0.8, 2.2))), y0 = Math.floor(rng.uniform(0, 0.7) * h);
      const y1 = rng.random() < 0.5 ? h : Math.min(h, Math.floor(y0 + rng.uniform(0.15, 0.6) * h));
      fillRect(img, w, h, x, y0, x + lw, y1, col());
    }
    for (let k = 0, N = Math.floor(a * 3.5); k < N; k++) {
      const y = rng.int(0, h), lh = Math.max(1, Math.round(u * rng.uniform(0.8, 2))), x0 = Math.floor(rng.uniform(0, 0.6) * w), x1 = Math.min(w, Math.floor(x0 + rng.uniform(0.2, 0.6) * w));
      fillRect(img, w, h, x0, y, x1, y + lh, col());
    }
    for (let k = 0, N = Math.floor(1 + 7 * a); k < N; k++) {
      const bw = Math.floor(u * rng.uniform(8, 48)), bh = Math.floor(u * rng.uniform(8, 34)), x = rng.int(0, Math.max(1, w - bw)), y = rng.int(0, Math.max(1, h - bh));
      fillRect(img, w, h, x, y, x + bw, y + bh, col());
    }
    const ds = Math.max(1, Math.round(u * 1.3));
    for (let k = 0, N = Math.floor(a * 0.0012 * h * w); k < N; k++) { const x = rng.int(0, Math.max(1, w - ds)), y = rng.int(0, Math.max(1, h - ds)); fillRect(img, w, h, x, y, x + ds, y + ds, col()); }
    return img;
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5 + 1 / 32);
  function fxCrush(img, a, E) {
    // bit crush: the palette collapses to a few levels per channel, ordered-dithered
    const { h, w, u } = E, L = Math.max(2, Math.round(2 + Math.pow(1 - a, 2) * 30)), c = Math.max(1, Math.round(1.3 * u));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = BAYER[(Math.floor(y / c) % 4) * 4 + (Math.floor(x / c) % 4)] * 0.95, i = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) img[i + k] = clamp01(Math.floor(img[i + k] * (L - 1) + 0.5 + d) / (L - 1));
    }
    return img;
  }
  function fxShatter(img, p, E) {
    // broken glass: Voronoi shards densest around an impact point; each slips and tilts, some fall out, dark seams + glint
    const a = p.shatter, rng = E.rng('shatter'), { h, w, u } = E, n = h * w, diag = Math.hypot(w, h);
    const cell = u * (60 + 320 * p.shard_size), cx = rng.uniform(0.3, 0.7) * w, cy = rng.uniform(0.25, 0.7) * h, n0 = Math.max(12, Math.min(110, Math.floor(0.9 * n / (cell * cell))));
    const sx = [], sy = [];
    for (let i = 0; i < n0; i++) { const ang = rng.uniform(0, 2 * PI), rad = diag * 0.75 * Math.pow(rng.random(), 1.7); sx.push(Math.min(1.05 * w, Math.max(-0.05 * w, cx + rad * Math.cos(ang)))); sy.push(Math.min(1.05 * h, Math.max(-0.05 * h, cy + rad * Math.sin(ang)))); }
    [[0, 0], [w, 0], [0, h], [w, h], [w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2]].forEach((c) => { sx.push(c[0]); sy.push(c[1]); });
    const N = sx.length, s = 2, hh = Math.ceil(h / s), ww = Math.ceil(w / s), wx = fbm(rng, hh, ww, u * 40 / s, 3), wy = fbm(rng, hh, ww, u * 40 / s, 3), lab = new Int16Array(hh * ww);
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x, X = x * s + (wx[i] - 0.5) * u * 30, Y = y * s + (wy[i] - 0.5) * u * 30; let best = 1e18, bi = 0;
      for (let k = 0; k < N; k++) { const dx = X - sx[k], dy = Y - sy[k], d = dx * dx + dy * dy; if (d < best) { best = d; bi = k; } }
      lab[i] = bi;
    }
    const dist = sx.map((x, i) => Math.hypot(x - cx, sy[i] - cy) / diag), th = [], tx = [], ty = [], tone = [], hole = [];
    for (let i = 0; i < N; i++) { const sp = 0.35 + 1.6 * dist[i]; th.push(rng.normal(0, 0.04 * a) * sp); tx.push(rng.normal(0, 8 * u * a) * sp); ty.push(rng.normal(0, 8 * u * a) * sp + 5 * u * a * dist[i]); tone.push(1 + rng.normal(0, 0.06 * a)); hole.push(rng.random() < 0.55 * p.shard_gap * (0.4 + dist[i])); }
    const L = new Int16Array(n), out = new Float32Array(n * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, l = lab[Math.min(hh - 1, y >> 1) * ww + Math.min(ww - 1, x >> 1)]; L[i] = l;
      if (hole[l]) { out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 0.03; continue; }
      const dx = x - sx[l] - tx[l], dy = y - sy[l] - ty[l], c = Math.cos(th[l]), sn = Math.sin(th[l]);
      sample(img, w, h, 3, sx[l] + c * dx + sn * dy, sy[l] - sn * dx + c * dy, out, i * 3);
      out[i * 3] *= tone[l]; out[i * 3 + 1] *= tone[l]; out[i * 3 + 2] *= tone[l];
    }
    const b = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = 0; if (x < w - 1 && L[i] !== L[i + 1]) v++; if (y < h - 1 && L[i] !== L[i + w]) v++; b[i] = v > 1 ? 1 : v; }
    const line = gauss(b, w, h, 1, Math.max(0.8, 0.9 * u)), k = Math.max(2, Math.floor(u * 1.5)), op = 0.3 + 0.7 * a;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, ln = clamp01(line[i] * 3), gi = ((y - k + h) % h) * w + ((x - k + w) % w), gl = clamp01(line[gi] * 3);
      for (let c = 0; c < 3; c++) out[i * 3 + c] = clamp01(out[i * 3 + c] * (1 - 0.88 * ln * op) + 0.40 * gl * (1 - ln) * op);
    }
    return out;
  }
  function fxFire(img, p, E) {
    // a burn front eats the print from the edges: scorch ahead, ember line along it, ash behind it
    const a = p.fire, em = p.ember, so = p.soot, rng = E.rng('fire'), { h, w, u } = E, n = h * w, diag = Math.hypot(w, h);
    const D = new Float32Array(n).fill(9), k0 = 1 + rng.int(0, 3);
    for (let q = 0; q < k0; q++) {
      const side = rng.int(0, 4), t = rng.uniform(0.1, 0.9), px = [t * w, w, t * w, 0][side], py = [0, t * h, h, t * h][side];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x - px, y - py) / diag, i = y * w + x; if (d < D[i]) D[i] = d; }
    }
    const big = fbm(rng, h, w, u * 140, 4), fine = noise2d(rng, h, w, u * 9), smoke = fbm(rng, h, w, u * 90, 3), cloud = fbm(rng, h, w, u * 60, 3), flake = noise2d(rng, h, w, u * 4), flick = noise2d(rng, h, w, u * 5), spk = noise2d(rng, h, w, u * 2.6);
    const T = 0.02 + 0.5 * a + 0.55 * a * a * a, S = new Float32Array(n), G = new Float32Array(n), burntA = new Float32Array(n), out = new Float32Array(img);
    for (let i = 0; i < n; i++) {
      const s = T - (D[i] + 0.38 * (big[i] - 0.5) + 0.06 * (fine[i] - 0.5)); S[i] = s;
      const burnt = sstep(-0.004, 0.006, s); burntA[i] = burnt;
      const sc = sstep(-0.14, 0, s) * (1 - burnt), k = 0.35 + 0.65 * so, sm = sstep(-0.5, 0, s) * (0.5 + smoke[i]) * (1 - burnt);
      const dark = (1 - sc * k * 0.6) * (1 - 0.5 * so * sm), m = [1, 1 - sc * k * 0.18, 1 - sc * k * 0.45];
      const ash = 0.035 + (0.05 + 0.22 * cloud[i]) * sstep(0.03, 0.45, s) * (0.4 + flake[i]), ghost = 0.22 * (1 - sstep(0, 0.2, s)) * 0.55;
      for (let c = 0; c < 3; c++) { const v = img[i * 3 + c] * dark * m[c]; out[i * 3 + c] = v * (1 - burnt) + (ash + ghost * img[i * 3 + c]) * burnt; }
      const band = Math.exp(-Math.max(s, 0) / (0.014 + 0.016 * em)) * burnt;
      G[i] = clamp01(band * clamp01(0.55 + 1.8 * (flick[i] - 0.5)) * (0.2 + 1.2 * em));
    }
    const glow = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = G[i], core = g * g, sp = sstep(0.9, 0.99, spk[i]) * burntA[i] * (0.25 + 0.75 * sstep(0, 0.5, S[i])) * em;
      const er = 1, eg = 0.22 + 0.62 * core, eb = 0.03 + 0.28 * core;
      out[i * 3] = out[i * 3] * (1 - g) + er * g; out[i * 3 + 1] = out[i * 3 + 1] * (1 - g) + eg * g; out[i * 3 + 2] = out[i * 3 + 2] * (1 - g) + eb * g;
      out[i * 3] = out[i * 3] * (1 - sp) + sp; out[i * 3 + 1] = out[i * 3 + 1] * (1 - sp) + 0.55 * sp; out[i * 3 + 2] = out[i * 3 + 2] * (1 - sp) + 0.12 * sp;
      glow[i] = g + sp * 0.6;
    }
    const halo = gauss(glow, w, h, 1, 7 * u), hk = [1, 0.42, 0.1];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = clamp01(out[i * 3 + c] + halo[i] * hk[c] * 0.55 * em);
    return out;
  }
  function fxRedact(img, a, E) {
    const rng = E.rng('redact'), { h, w, u } = E, bars = Math.floor(2 + 14 * a);
    for (let k = 0; k < bars; k++) {
      const bh = Math.max(3, Math.floor(u * rng.uniform(9, 26))), bw = Math.floor(rng.uniform(0.08, 0.5) * w), y = Math.floor(Math.floor(rng.uniform(0.03, 0.95) * h / (bh * 1.4)) * bh * 1.4), x = Math.floor(rng.random() * Math.max(1, w - bw)), v = rng.random() < 0.85 ? 0.02 : 0.93;
      for (let yy = y; yy < Math.min(h, y + bh); yy++) for (let xx = x; xx < Math.min(w, x + bw); xx++) { const i = (yy * w + xx) * 3; img[i] = img[i + 1] = img[i + 2] = v; }
    }
    if (a > 0.35) {
      const hh = Math.floor(h * rng.uniform(0.12, 0.32)), y0 = Math.floor(rng.uniform(0.05, 0.9) * Math.max(1, h - hh)), wx = Math.floor(w * (0.25 + 0.6 * a)), e = Math.max(1, Math.floor(2 * u));
      for (let y = y0; y < Math.min(h, y0 + hh); y++) {
        const row = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin((y - y0) * 2 * PI / Math.max(2, 3 * u)));
        for (let x = 0; x < Math.min(w, wx); x++) {
          const i = (y * w + x) * 3, edge = x >= wx - e;
          if (edge) { img[i] = 0.3; img[i + 1] = 0.95; img[i + 2] = 1; } else { const v = rng.random() * 0.07 * row; img[i] = img[i + 1] = img[i + 2] = v; }
        }
      }
    }
    return img;
  }

  // ── dissolve & shredder (straight RGBA float, h*w*4)
  function premult(rgba, n) { const P = new Float32Array(n * 4); for (let i = 0; i < n; i++) { const a = rgba[i * 4 + 3]; P[i * 4] = rgba[i * 4] * a; P[i * 4 + 1] = rgba[i * 4 + 1] * a; P[i * 4 + 2] = rgba[i * 4 + 2] * a; P[i * 4 + 3] = a; } return P; }
  function unpremult(P, n) { const o = new Float32Array(n * 4); for (let i = 0; i < n; i++) { const a = P[i * 4 + 3], k = a > 1e-4 ? 1 / a : 0; o[i * 4] = clamp01(P[i * 4] * k); o[i * 4 + 1] = clamp01(P[i * 4 + 1] * k); o[i * 4 + 2] = clamp01(P[i * 4 + 2] * k); o[i * 4 + 3] = a; } return o; }

  function fxDissolve(rgba, w0, h0, a, E0, seed) {
    const m = Math.floor(0.12 * Math.min(h0, w0)), w = w0 + 2 * m, h = h0 + 2 * m, n = w * h, E = new Ctx(h, w, E0.u, seed), u = E.u;
    const P0 = new Float32Array(n * 4), Pm = premult(rgba, w0 * h0);
    for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) { const s = (y * w0 + x) * 4, d = ((y + m) * w + x + m) * 4; for (let c = 0; c < 4; c++) P0[d + c] = Pm[s + c]; }
    const rng = E.rng('dissolve'), ang = rng.uniform(-0.55, 0.55) + (rng.random() < 0.3 ? PI : 0);
    let dx = Math.cos(ang), dy = Math.sin(ang) * 0.6 - 0.25; const nr = Math.hypot(dx, dy); dx /= nr; dy /= nr;
    const f = fbm(rng, h, w, u * 6, 3), fn = noise2d(rng, h, w, u * 1.6), th = 1.45 - 1.6 * a, dead = new Float32Array(n), P = new Float32Array(n * 4), half = 0.5 * Math.hypot(h0, w0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, pos = ((x - w / 2) * dx + (y - h / 2) * dy) / half * 0.5 + 0.5, s = pos + (f[i] - 0.5) * 0.55 + (fn[i] - 0.5) * 0.25, al = 1 - sstep(th - 0.015, th + 0.015, s);
      dead[i] = 1 - al; for (let c = 0; c < 4; c++) P[i * 4 + c] = P0[i * 4 + c] * al;
    }
    const tmp = new Float32Array(4), td = new Float32Array(1);
    for (let layer = 0; layer < 3; layer++) {
      const dist = u * rng.uniform(15, 110) * (0.3 + 0.7 * a), rr = noise2d(rng, h, w, u * 3), jit = noise2d(rng, h, w, u * 5), pr = noise2d(rng, h, w, u * 1.4), lim = 0.30 - 0.07 * layer;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!(pr[i] < lim)) continue;
        const r = rr[i] + 0.3, j = (jit[i] - 0.5) * u * 40, qx = x - dx * dist * r + j * dy, qy = y - dy * dist * r - j * dx;
        sample(dead, w, h, 1, qx, qy, td, 0); if (td[0] < 0.01) continue;
        sample(P0, w, h, 4, qx, qy, tmp, 0);
        const k = td[0] * (1 - 0.28 * layer), pa = tmp[3] * k;
        for (let c = 0; c < 3; c++) P[i * 4 + c] = P[i * 4 + c] * (1 - pa) + tmp[c] * k;
        P[i * 4 + 3] = P[i * 4 + 3] * (1 - pa) + pa;
      }
    }
    return { rgba: unpremult(P, n), w, h };
  }

  function placePatch(P, W, H, patch, pw, ph, pv, cx, cy, ang, shade) {
    const R = Math.hypot(ph, pw) + 2, x0 = Math.floor(Math.max(0, cx - R)), x1 = Math.floor(Math.min(W, cx + R)), y0 = Math.floor(Math.max(0, cy - R)), y1 = Math.floor(Math.min(H, cy + R));
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const c = Math.cos(ang), s = Math.sin(ang), tmp = new Float32Array(4);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dx = x - cx, dy = y - cy, mx = dx * c + dy * s + pv[0], my = -dx * s + dy * c + pv[1];
      const cov = Math.min(1, Math.max(0, Math.min(Math.min(mx + 0.5, pw - 0.5 - mx), Math.min(my + 0.5, ph - 0.5 - my)) + 0.5));
      if (cov <= 0) continue;
      sample(patch, pw, ph, 4, mx, my, tmp, 0);
      const sa = tmp[3] * cov, i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) P[i + k] = P[i + k] * (1 - sa) + tmp[k] * cov * shade;
      P[i + 3] = P[i + 3] * (1 - sa) + sa;
    }
  }
  function cropPatch(Pm, w, x0, y0, x1, y1) {
    const pw = x1 - x0, ph = y1 - y0, o = new Float32Array(pw * ph * 4); let mx = 0;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const s = ((y0 + y) * w + x0 + x) * 4, d = (y * pw + x) * 4; for (let c = 0; c < 4; c++) o[d + c] = Pm[s + c]; if (o[d + 3] > mx) mx = o[d + 3]; }
    return { d: o, pw, ph, max: mx };
  }
  function betaRng(rng, a, b) { for (let t = 0; t < 60; t++) { const x = Math.pow(rng.random(), 1 / a), y = Math.pow(rng.random(), 1 / b); if (x + y <= 1 && x + y > 0) return x / (x + y); } return 0.5; }

  function fxShred(rgba, w, h, p, E0, seed) {
    const a = p.shred, u = E0.u, rng = new RNG(seed, K.shred);
    let ws = Math.max(4, Math.floor(u * (8 + 52 * p.shred_w)));
    const chaos = p.shred_chaos, cross = p.cut === 'cross', ycut = Math.floor(h * (1 - a) * 0.94);
    let ch = Math.floor(ws * 1.7);
    if (cross) while ((w / ws) * ((h - ycut) / ch) > 4500) { ws = Math.floor(ws * 1.25); ch = Math.floor(ws * 1.7); }
    const pad = Math.floor(0.06 * w), extra = Math.floor(0.3 * h * a), H = h + extra, W = w + 2 * pad, Pm = premult(rgba, w * h), P = new Float32Array(W * H * 4);
    for (let y = 0; y < ycut; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = (y * W + x + pad) * 4; for (let c = 0; c < 4; c++) P[d + c] = Pm[s + c]; }
    const sl = Math.max(2, Math.floor(2.5 * u));
    if (ycut > sl) for (let y = ycut - sl; y < ycut; y++) for (let x = 0; x < w; x++) { const d = (y * W + x + pad) * 4; P[d] *= 0.62; P[d + 1] *= 0.62; P[d + 2] *= 0.62; }
    const pile = [], strips = [], n = Math.ceil(w / ws), full = h - ycut;
    for (let i = 0; i < n && full > 2; i++) {
      const x0 = i * ws, x1 = Math.min(w, (i + 1) * ws), sw = x1 - x0, shade = 1 + rng.normal(0, 0.035);
      if (cross) {
        const rows = Math.max(1, Math.floor(full / ch));
        for (let r = 0; r < rows; r++) {
          const y0 = ycut + r * ch, y1 = Math.min(h, y0 + ch); if (y1 - y0 < 2) continue;
          const pc = cropPatch(Pm, w, x0, y0, x1, y1); if (pc.max < 0.02) continue;
          const pv = [pc.pw / 2, pc.ph / 2];
          if (r === 0) strips.push([pc, pv, pad + x0 + sw / 2 + rng.normal(0, ws * 0.15 * chaos), y0 + pc.ph / 2, rng.normal(0, 0.05 * chaos), shade]);
          else pile.push([pc, pv, pad + x0 + sw / 2 + rng.normal(0, ws * (1 + 2 * chaos)), ycut + ch + betaRng(rng, 1.7, 0.75) * (H - ycut - 1.6 * ch), rng.uniform(-PI, PI), shade * rng.uniform(0.9, 1)]);
        }
        continue;
      }
      const keep = rng.random() > 0.35 * (0.4 + chaos) ? full : Math.floor(full * rng.uniform(0.45, 0.92)), pc = cropPatch(Pm, w, x0, ycut, x1, ycut + keep);
      if (pc.max < 0.02) continue;
      const tx = (i - n / 2) * ws * 0.22 * chaos + rng.normal(0, ws * 0.12 * chaos), ang = rng.normal(0, 0.03 * chaos + 0.004) + (i - n / 2) / n * 0.05 * chaos;
      strips.push([pc, [sw / 2, 0], pad + x0 + sw / 2 + tx, ycut, ang, shade]);
      if (keep < full && full - keep > 2) {
        const rs = cropPatch(Pm, w, x0, ycut + keep, x1, h);
        pile.push([rs, [rs.pw / 2, rs.ph / 2], pad + x0 + sw / 2 + rng.normal(0, ws * 2.5 * chaos), H - rs.ph * 0.5 - rng.uniform(0, 0.16) * H * a, rng.uniform(-1.45, 1.45), shade * 0.95]);
      }
    }
    for (let i = pile.length - 1; i > 0; i--) { const j = rng.int(0, i + 1); const t = pile[i]; pile[i] = pile[j]; pile[j] = t; }
    for (const [pc, pv, cx, cy, ang, shade] of pile) placePatch(P, W, H, pc.d, pc.pw, pc.ph, pv, cx, cy, ang, shade);
    for (const [pc, pv, cx, cy, ang, shade] of strips) placePatch(P, W, H, pc.d, pc.pw, pc.ph, pv, cx, cy, ang, shade);
    return { rgba: unpremult(P, W * H), w: W, h: H };
  }

  // ── labels
  function labelText(rng) {
    const n = rng.int(1, 100), h4 = () => rng.int(0, 65536).toString(16).toUpperCase().padStart(4, '0'), p2 = (x) => String(x).padStart(2, '0');
    const opts = ['SIGNAL LOST', 'NO SUCH FILE', 'MEMORY CORRUPT', 'NODE ' + p2(n) + ' / OFFLINE', 'LAYER ' + p2(n), 'PROTOCOL ' + rng.int(1, 10), 'ERR 0x' + h4(),
      'NO CARRIER', 'MEMORY ERASED', 'FILE DAMAGED', 'THE PAST IS DELETED', rng.int(1979, 2004) + '.' + p2(rng.int(1, 13)) + '.' + p2(rng.int(1, 29)) + '  ' + p2(rng.int(0, 24)) + ':' + p2(rng.int(0, 60)),
      'IMG_' + String(rng.int(1, 10000)).padStart(4, '0') + '.RAW', '0x' + h4() + ' 0x' + h4() + ' 0x' + h4(), 'frame ' + n + 'A >', 'UNLINKED', 'CANNOT RESTORE', 'LAYER ' + p2(n) + ' / DELETED'];
    return rng.pick(opts);
  }
  function drawLabels(rgba, a, E) {
    const rng = E.rng('label'), { h, w, u } = E, cv = mkCanvas(w, h), g = cv.getContext('2d');
    const cols = ['245,245,240', '140,240,255', '255,80,60', '200,255,190'], cnt = Math.floor(2 + 11 * a);
    for (let k = 0; k < cnt; k++) {
      const txt = labelText(rng), size = Math.floor(u * rng.uniform(11, 26)), col = rng.pick(cols), al = rng.uniform(0.35, 0.9), rot = rng.random() < 0.25;
      g.font = Math.max(8, size) + 'px Consolas,"DejaVu Sans Mono","Courier New",monospace'; g.textBaseline = 'top';
      const tw = Math.ceil(g.measureText(txt).width) + 4, th = Math.max(8, size) + 6, bw = rot ? th : tw, bh = rot ? tw : th;
      const x = rng.uniform(0.02, 0.98) * Math.max(1, w - bw), y = rng.uniform(0.02, 0.98) * Math.max(1, h - bh);
      g.save(); g.fillStyle = 'rgba(' + col + ',' + al + ')';
      if (rot) { g.translate(x + th, y); g.rotate(PI / 2); g.fillText(txt, 2, 2); } else g.fillText(txt, x + 2, y + 2);
      g.restore();
    }
    const d = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) {
      const oa = d[i * 4 + 3] / 255 * rgba[i * 4 + 3]; if (oa <= 0) continue;
      // canvas data is premultiplied-free (straight) in getImageData
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = rgba[i * 4 + c] * (1 - oa) + (d[i * 4 + c] / 255) * oa;
    }
    return rgba;
  }

  // ── tape & compose
  function fxTape(P, W, H, a, E, rect) {
    const rng = E.rng('tape'), u = E.u, [x0, y0, x1, y1] = rect, size = Math.min(x1 - x0, y1 - y0), n = Math.max(1, Math.round(a * 4)), col = [0.93, 0.84, 0.55];
    const corners = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, -1, -1], [x1, y1, 1, -1]];
    for (let t = 0; t < n; t++) {
      let cx, cy, ang;
      if (t < 2 || rng.random() < 0.6) {
        const c = corners[rng.int(0, 4)], ix = c[0] === x0 ? 1 : -1;
        cx = c[0] + ix * size * rng.uniform(0.025, 0.055); cy = c[1] + c[3] * size * rng.uniform(0.025, 0.055);
        ang = (c[2] * rng.uniform(35, 55) + rng.uniform(-6, 6)) * PI / 180;
      } else { cx = rng.uniform(0.3, 0.7) * (x1 - x0) + x0; cy = y0 + rng.normal(0, 0.008) * size; ang = rng.uniform(-12, 12) * PI / 180; }
      const Ln = size * rng.uniform(0.15, 0.24), Wd = size * rng.uniform(0.045, 0.07), R = Ln * 0.75 + Wd;
      const xa = Math.floor(Math.max(0, cx - R)), xb = Math.floor(Math.min(W, cx + R)), ya = Math.floor(Math.max(0, cy - R)), yb = Math.floor(Math.min(H, cy + R));
      if (xb - xa < 4 || yb - ya < 4) continue;
      const m = 2 * Math.floor(R) + 8, zn = noise1d(rng, m, u * 5, 2), zig = new Float32Array(m);
      for (let i = 0; i < m; i++) zig[i] = zn[i] * u * 3 + Math.sin(i / (2.2 * u)) * u * 2.2;
      const st = noise2d(rng, yb - ya, xb - xa, u * 1.5, u * 40), ca = Math.cos(ang), sa = Math.sin(ang);
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
        const dx = x - cx, dy = y - cy, xl = dx * ca + dy * sa, yl = -dx * sa + dy * ca;
        const sdx = Math.abs(xl) - Ln / 2 + interp1(zig, yl + m / 2), sdy = Math.abs(yl) - Wd / 2, d = Math.max(sdx, sdy), al = aa(-d);
        if (al <= 0) continue;
        const ba = (0.5 + 0.12 * st[(y - ya) * (xb - xa) + (x - xa)]) * al, sheen = Math.exp(-Math.pow((yl - Wd * 0.12) / (Wd * 0.18), 2)) * 0.16 * al, edge = Math.exp(-Math.pow((d + 0.8 * u) / (1.1 * u), 2)) * 0.1 * al;
        const i = (y * W + x) * 4, Aold = P[i + 3], newA = Aold * (1 - ba) + ba;
        for (let c = 0; c < 3; c++) {
          const tape = col[c] * (1 - edge) + sheen, v = P[i + c] * (1 - ba) + tape * ba + P[i + c] * ba * 0.42 * col[c];
          P[i + c] = Math.min(v, newA);
        }
        P[i + 3] = newA;
      }
    }
  }

  function compose(rgba, w, h, p, E0, seed) {
    const backdrop = p.backdrop, need = backdrop !== 'none' || p.tape > 0, m = need ? Math.floor(0.07 * Math.min(h, w)) : 0, H = h + 2 * m, W = w + 2 * m;
    const E = new Ctx(H, W, E0.u, seed), P = new Float32Array(W * H * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = ((y + m) * W + x + m) * 4, a = rgba[s + 3]; P[d] = rgba[s] * a; P[d + 1] = rgba[s + 1] * a; P[d + 2] = rgba[s + 2] * a; P[d + 3] = a; }
    if (p.tape > 0) fxTape(P, W, H, p.tape, E, [m, m, m + w, m + h]);
    const out = new Uint8ClampedArray(W * H * 4);
    if (backdrop === 'none') {
      for (let i = 0; i < W * H; i++) { const a = P[i * 4 + 3], k = a > 1e-4 ? 1 / a : 0; for (let c = 0; c < 3; c++) out[i * 4 + c] = clamp01(P[i * 4 + c] * k) * 255 + 0.5; out[i * 4 + 3] = a * 255 + 0.5; }
      return { w: W, h: H, data: out, alpha: true };
    }
    const rng = E.rng('tilt'), ang = rng.uniform(-2.2, 2.2) * PI / 180, cx = W / 2, cy = H / 2, ca = Math.cos(ang), sa = Math.sin(ang), T = new Float32Array(P.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sample(P, W, H, 4, (x - cx) * ca + (y - cy) * sa + cx, -(x - cx) * sa + (y - cy) * ca + cy, T, (y * W + x) * 4);
    const rb = E.rng('bg'), u = E.u, dark = backdrop === 'dark', base = dark ? [0.06, 0.054, 0.05] : [0.7, 0.64, 0.54], amp = dark ? 0.05 : 0.09;
    const n1 = fbm(rb, H, W, u * 120, 4), n2 = noise2d(rb, H, W, u * 1.7), fib = dark ? null : noise2d(rb, H, W, u * 1.2, u * 24);
    const A = new Float32Array(W * H); for (let i = 0; i < W * H; i++) A[i] = T[i * 4 + 3];
    const sz = Math.min(H, W), s1 = gauss(shiftMap(A, W, H, 1, Math.floor(0.012 * sz), Math.floor(0.018 * sz)), W, H, 1, 0.016 * sz), s2 = gauss(shiftMap(A, W, H, 1, Math.floor(0.003 * sz), Math.floor(0.005 * sz)), W, H, 1, 0.004 * sz);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, r = Math.hypot((x - cx) / (W / 2), (y - cy) / (H / 2)), vig = 1.12 - 0.34 * clamp01(r - 0.2), sh = clamp01(s1[i] * 0.62 + s2[i] * 0.5);
      for (let c = 0; c < 3; c++) {
        let bg = base[c] + (n1[i] - 0.5) * amp + (n2[i] - 0.5) * amp * 0.5; if (fib) bg += (fib[i] - 0.5) * 0.05;
        out[i * 4 + c] = clamp01(bg * vig * (1 - sh) * (1 - A[i]) + T[i * 4 + c]) * 255 + 0.5;
      }
      out[i * 4 + 3] = 255;
    }
    return { w: W, h: H, data: out, alpha: false };
  }

  // ───────────── main ─────────────
  function normalize(params, master) {
    const p = {}, keys = root.PD_DATA.keys;
    for (const k of keys) { const m = (k === 'shred_w' || k === 'shred_chaos' || k === 'shard_size') ? 100 : master; p[k] = Math.min(100, Math.max(0, (Number(params[k]) || 0) * m / 100)) / 100; }
    p.cut = params.cut === 'cross' ? 'cross' : 'strip';
    p.tint = TINT_GAIN[params.tint] ? params.tint : 'amber';
    p.backdrop = ['none', 'dark', 'paper'].includes(params.backdrop) ? params.backdrop : 'none';
    return p;
  }

  function render(src, params, seed, master, maxSide) {
    // src = {data: Uint8ClampedArray RGBA, w, h}
    const p = normalize(params, master === undefined ? 100 : master), tint = p.tint;
    let { img, w, h } = prepare(src.data, src.w, src.h, maxSide);
    const u0 = Math.min(h, w) / 1000;
    if (p.border > 0) ({ img, w, h } = fxBorder(img, w, h, p.border, u0, seed));
    const E = new Ctx(h, w, u0, seed), n = h * w, paper = agedPaper(tint, p.fade);
    const dig = [['sort', fxSort], ['melt', fxMelt], ['mosh', fxMosh], ['corrupt', fxCorrupt], ['jpeg', fxJpeg], ['glitch', fxGlitch], ['chroma', fxChroma], ['scan', fxScan], ['rot', fxRot], ['crush', fxCrush], ['redact', fxRedact], ['dead', fxDead], ['ghost', fxGhost], ['bloom', fxBloom]];
    if (p.shatter > 0) img = fxShatter(img, p, E);
    for (const [name, fn] of dig) if (p[name] > 0) img = fn(img, p[name], E);
    if (p.fire > 0) img = fxFire(img, p, E);
    if (p.water > 0) img = fxWaterWarp(img, p.water, E);
    if (p.fade > 0 || tint !== 'none') img = fxFade(img, E, p.fade, tint);
    if (p.mirror > 0) img = fxMirror(img, p.mirror, E);
    if (p.stain > 0) img = fxStain(img, p.stain, E, paper);
    if (p.water > 0) img = fxWaterMarks(img, p.water, E, paper);
    if (p.crack > 0) img = fxCrack(img, p.crack, E, paper);
    if (p.peel > 0) img = fxPeel(img, p.peel, E, paper);
    if (p.crease > 0) img = fxCrease(img, p.crease, E, paper);
    const age = Math.max(p.fade, p.mirror, p.stain, p.crack, p.peel, p.crease, p.water);
    if (age > 0) img = fxRelief(img, age, p.fade, E);
    if (p.dust > 0) img = fxDust(img, p.dust, E);
    if (p.grain > 0) img = fxGrain(img, p.grain, E);
    for (let i = 0; i < img.length; i++) img[i] = clamp01(img[i]);
    let rgba;
    if (p.tear > 0 || p.corner > 0 || p.burn > 0) rgba = fxDestroyEdges(img, E, paper, p);
    else { rgba = new Float32Array(n * 4); for (let i = 0; i < n; i++) { rgba[i * 4] = img[i * 3]; rgba[i * 4 + 1] = img[i * 3 + 1]; rgba[i * 4 + 2] = img[i * 3 + 2]; rgba[i * 4 + 3] = 1; } }
    if (p.label > 0) rgba = drawLabels(rgba, p.label, E);
    if (p.dissolve > 0) { const r = fxDissolve(rgba, w, h, p.dissolve, E, seed); rgba = r.rgba; w = r.w; h = r.h; }
    if (p.shred > 0) { const r = fxShred(rgba, w, h, p, E, seed); rgba = r.rgba; w = r.w; h = r.h; }
    return compose(rgba, w, h, p, E, seed);
  }

  root.PD = { render, RNG };
})(typeof self !== 'undefined' ? self : this);
