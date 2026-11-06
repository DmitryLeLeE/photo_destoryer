# -*- coding: utf-8 -*-
"""
PHOTO DESTROYER - engine.

numpy + Pillow only (no scipy/opencv) so the exe stays small and runs anywhere.
All sizes are fractions of the image (u = short side / 1000), so the preview and
the full-size export look identical.

Life of a print:
  border -> digital faults -> warp -> fade -> silvering -> stains -> tide lines ->
  craquelure -> peel -> creases -> dust -> grain -> burns & tears -> labels ->
  tape -> backdrop & shadow
"""
from __future__ import annotations

import math
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .params import KEYS

F32 = np.float32
LUMA = np.array([0.299, 0.587, 0.114], F32)
PAPER = np.array([0.93, 0.89, 0.79], F32)

# Every effect owns a separate random stream: moving one slider never
# re-rolls the layout of the other damage.
K = {n: i for i, n in enumerate(
    ["border", "water", "fade", "mirror", "stain", "crack", "peel", "crease",
     "dust", "grain", "burn", "tear", "corner", "tape", "glitch", "chroma",
     "scan", "ghost", "bloom", "rot", "label", "bg", "tilt",
     "sort", "melt", "corrupt", "redact", "dissolve", "shred"])}

TINT_GAIN = {
    "amber": (1.00, 0.88, 0.58),
    "red":   (1.00, 0.66, 0.50),
    "cyan":  (0.55, 0.92, 1.00),
    "mono":  (0.94, 0.98, 1.02),
    "none":  (1.00, 1.00, 1.00),
}
TINT_BLACK = {
    "amber": (0.90, 0.60, 0.25),
    "red":   (1.00, 0.40, 0.30),
    "cyan":  (0.20, 0.60, 0.70),
    "mono":  (0.50, 0.55, 0.65),
    "none":  (0.50, 0.50, 0.50),
}


# ───────────────────────── numeric helpers ─────────────────────────

def clamp01(a):
    return np.clip(a, 0.0, 1.0)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def luma(img):
    return img @ LUMA


def _box(a, r, axis):
    n = a.shape[axis]
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float32)
    hi = [slice(None)] * a.ndim
    lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
    lo[axis] = slice(0, n)
    return (c[tuple(hi)] - c[tuple(lo)]) / F32(2 * r + 1)


def gauss(a, sigma):
    """Gaussian via three box-blur passes (fast, and identical in numpy and JS)."""
    if sigma < 0.6:
        return a
    w = math.sqrt(4.0 * sigma * sigma + 1.0)
    r = max(1, int(round((w - 1.0) / 2.0)))
    for _ in range(3):
        a = _box(a, r, 0)
        a = _box(a, r, 1)
    return a


def shift(a, dx, dy):
    """Shift with edge clamping (no wrap-around)."""
    dx, dy = int(dx), int(dy)
    h, w = a.shape[:2]
    ys = np.clip(np.arange(h) - dy, 0, h - 1)
    xs = np.clip(np.arange(w) - dx, 0, w - 1)
    return a[ys][:, xs]


def remap(a, mx, my):
    """Bilinear sampling of a[h,w,(c)] at coordinates mx,my."""
    h, w = a.shape[:2]
    mx = np.clip(mx, 0, max(0.0, w - 1.001))
    my = np.clip(my, 0, max(0.0, h - 1.001))
    x0 = mx.astype(np.int32)
    y0 = my.astype(np.int32)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (mx - x0).astype(F32)
    fy = (my - y0).astype(F32)
    if a.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    top = a[y0, x0] * (1 - fx) + a[y0, x1] * fx
    bot = a[y1, x0] * (1 - fx) + a[y1, x1] * fx
    return top * (1 - fy) + bot * fy


# ───────────────────────────── noise ─────────────────────────────────────

def noise2d(rng, h, w, cell):
    """Smooth value noise, 0..1. cell = cell size in px (number or (cy, cx))."""
    cy, cx = (cell, cell) if np.isscalar(cell) else cell
    cy, cx = max(1.5, float(cy)), max(1.5, float(cx))
    gh, gw = int(h / cy) + 4, int(w / cx) + 4
    g = rng.random((gh, gw)).astype(F32)
    im = Image.fromarray(g, "F").resize((int(gw * cx), int(gh * cy)), Image.BICUBIC)
    a = np.asarray(im)
    oy = int(rng.integers(0, max(1, a.shape[0] - h)))
    ox = int(rng.integers(0, max(1, a.shape[1] - w)))
    return np.clip(a[oy:oy + h, ox:ox + w], 0.0, 1.0)


def fbm(rng, h, w, cell, octaves=4, gain=0.5):
    tot = np.zeros((h, w), F32)
    amp, norm = 1.0, 0.0
    for i in range(octaves):
        c = cell / (2 ** i)
        if i > 0 and c < 2.0:
            break
        tot += F32(amp) * noise2d(rng, h, w, c)
        norm += amp
        amp *= gain
    r = tot / F32(norm)
    r = (r - r.mean()) / (r.std() + 1e-6) * 0.2 + 0.5
    return np.clip(r, 0.0, 1.0).astype(F32)


def noise1d(rng, n, cell, octaves=3):
    """1-D noise of length n, roughly [-1..1]."""
    out = np.zeros(n, F32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        c = max(1.0, cell / (2 ** o))
        g = (rng.random(int(n / c) + 4) * 2 - 1).astype(F32)
        xs = np.arange(n, dtype=F32) / F32(c)
        i = xs.astype(np.int32)
        f = xs - i
        f = f * f * (3 - 2 * f)
        out += F32(amp) * (g[i] * (1 - f) + g[i + 1] * f)
        norm += amp
        amp *= 0.5
    return out / F32(norm)


def cover_mask(field, frac, soft=0.05):
    """Mask covering a fraction `frac` of the area (the highest field values)."""
    frac = float(np.clip(frac, 0.0, 1.0))
    if frac <= 0:
        return np.zeros_like(field)
    if frac >= 1:
        return np.ones_like(field)
    thr = float(np.quantile(field[::3, ::3], 1.0 - frac))
    return smoothstep(thr - soft, thr + soft, field)


def worley(rng, X, Y, cell):
    """Worley F1, F2 and a per-cell random value (used for craquelure)."""
    h, w = X.shape
    gh, gw = int(h / cell) + 5, int(w / cell) + 5
    jx = rng.random((gh, gw)).astype(F32)
    jy = rng.random((gh, gw)).astype(F32)
    rv = rng.random((gh, gw)).astype(F32)
    cx = (X / cell).astype(np.int32) + 1
    cy = (Y / cell).astype(np.int32) + 1
    d1 = np.full((h, w), 1e9, F32)
    d2 = np.full((h, w), 1e9, F32)
    cid = np.zeros((h, w), F32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            gx, gy = cx + ox, cy + oy
            px = (gx - 1 + jx[gy, gx]) * cell
            py = (gy - 1 + jy[gy, gx]) * cell
            d = np.hypot(X - px, Y - py).astype(F32)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d))
            cid = np.where(closer, rv[gy, gx], cid)
            d1 = np.where(closer, d, d1)
    return d1, d2, cid


# ───────────────────────────── context ────────────────────────────────

class Ctx:
    def __init__(self, h, w, u, seed):
        self.h, self.w, self.u, self.seed = h, w, u, int(seed)
        self.size = min(h, w)
        self._xy = None

    def rng(self, name):
        return np.random.default_rng([self.seed & 0x7FFFFFFF, K[name]])

    @property
    def xy(self):
        if self._xy is None:
            X, Y = np.meshgrid(np.arange(self.w, dtype=F32), np.arange(self.h, dtype=F32))
            self._xy = (X, Y)
        return self._xy


def aged_paper(tint, fade):
    g = np.array(TINT_GAIN.get(tint, TINT_GAIN["none"]), F32)
    return (PAPER * (1 + (g - 1) * fade * 0.55)).astype(F32)


def paper_texture(E, rng, paper):
    h, w, u = E.h, E.w, E.u
    t = (fbm(rng, h, w, u * 40, 3) - 0.5) * 0.06 + (noise2d(rng, h, w, u * 1.6) - 0.5) * 0.05
    return clamp01(paper[None, None, :] + t[..., None]).astype(F32)


# ───────────────────────────── preparation ──────────────────────────────

def prepare(src, max_side=None):
    im = ImageOps.exif_transpose(src).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    im = bg.convert("RGB")
    if max_side and max(im.size) > max_side:
        k = max_side / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    return np.asarray(im, F32) / 255.0


# ───────────────────────────── effects ─────────────────────────────────

def fx_border(img, a, u0, seed, tint, fade):
    """White paper border. Returns the new frame and the border widths."""
    h, w = img.shape[:2]
    size = min(h, w)
    rng = np.random.default_rng([seed & 0x7FFFFFFF, K["border"]])
    b = (0.012 + 0.085 * a) * size
    L, R, T, B = [int(b * rng.uniform(0.8, 1.2)) for _ in range(4)]
    B = int(B * (1.0 + 0.9 * a * rng.uniform(0.3, 1.0)))
    H, W = h + T + B, w + L + R
    E = Ctx(H, W, u0, seed)
    paper = paper_texture(E, rng, PAPER)
    paper[T:T + h, L:L + w] = img
    return paper, (L, T, R, B)


def fx_water_warp(img, a, E):
    rng = E.rng("water")
    h, w, u = E.h, E.w, E.u
    X, Y = E.xy
    big = (fbm(rng, h, w, u * 160, 3) - 0.5)
    big2 = (fbm(rng, h, w, u * 160, 3) - 0.5)
    fine = (noise2d(rng, h, w, u * 14) - 0.5)
    fine2 = (noise2d(rng, h, w, u * 14) - 0.5)
    amp = u * (30.0 * a)
    mx = X + big * amp * 1.6 + fine * u * 5.0 * a
    my = Y + big2 * amp * 1.6 + fine2 * u * 5.0 * a
    out = remap(img, mx, my)
    # patchy colour bleeding
    m = cover_mask(fbm(rng, h, w, u * 200, 3), 0.1 + 0.45 * a, 0.08)
    blur = gauss(out, u * (3 + 9 * a))
    return out * (1 - m[..., None] * 0.75) + blur * (m[..., None] * 0.75)


def fx_water_marks(img, a, E, paper):
    """Tide lines, brown rims and drips."""
    rng = E.rng("water")
    rng.random(5)
    h, w, u = E.h, E.w, E.u
    n = fbm(rng, h, w, u * 230, 4)
    m = cover_mask(n, 0.12 + 0.34 * a, 0.012)
    edge = np.abs(m - gauss(m, u * 2.2)) * 3.0
    tide = clamp01(edge * 2.4)
    tone = np.array([0.55, 0.40, 0.22], F32)
    img = img * (1 - tide[..., None] * 0.55 * (1 - tone))
    # inside the stain: slightly washed out
    inside = gauss(m, u * 8)
    img = img + (paper - img) * (inside[..., None] * 0.14 * a)
    # drips: vertically stretched noise
    drip = noise2d(rng, h, w, (u * 220, u * 9))
    dm = cover_mask(drip, 0.05 + 0.2 * a, 0.05) * smoothstep(0.35, 0.8, n)
    dm = gauss(dm, u * 1.2)
    img = img * (1 - dm[..., None] * 0.35 * (1 - tone))
    return img


def fx_fade(img, a, tint):
    lum = (img @ LUMA)[..., None]
    img = lum + (img - lum) * (1 - 0.78 * a)
    g = 1 + (np.array(TINT_GAIN[tint], F32) - 1) * a
    img = img * g
    lift = np.array(TINT_BLACK[tint], F32) * (0.12 * a)
    img = lift + img * (1 - 0.22 * a)
    img = 0.5 + (img - 0.5) * (1 - 0.32 * a)
    return clamp01(img)


def fx_mirror(img, a, E):
    rng = E.rng("mirror")
    h, w, u = E.h, E.w, E.u
    X, Y = E.xy
    n = fbm(rng, h, w, u * 90, 4)
    d = np.minimum(np.minimum(X, w - 1 - X), np.minimum(Y, h - 1 - Y)) / (0.28 * E.size)
    edge = 1 - clamp01(d)
    lum = luma(img)
    dark = smoothstep(0.42, 0.06, lum)
    m = dark * smoothstep(0.28, 0.85, edge * 0.75 + n * 0.75 - 0.2) * a
    m = gauss(m, u * 1.5)
    sheen = np.array([0.50, 0.58, 0.70], F32)[None, None, :] * (0.65 + 0.9 * lum[..., None] + 0.25 * n[..., None])
    return img * (1 - m[..., None] * 0.85) + sheen * (m[..., None] * 0.85)


def fx_stain(img, a, E, paper):
    rng = E.rng("stain")
    h, w, u = E.h, E.w, E.u
    X, Y = E.xy
    tone = np.array([0.60, 0.42, 0.22], F32)
    # water / coffee rings
    for _ in range(int(round(1 + 4 * a))):
        r = u * rng.uniform(70, 240)
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        x0, x1 = int(max(0, cx - 1.8 * r)), int(min(w, cx + 1.8 * r))
        y0, y1 = int(max(0, cy - 1.8 * r)), int(min(h, cy + 1.8 * r))
        if x1 - x0 < 4 or y1 - y0 < 4:
            continue
        sub_h, sub_w = y1 - y0, x1 - x0
        nz = fbm(rng, sub_h, sub_w, r * 0.6, 3)
        d = np.hypot(X[y0:y1, x0:x1] - cx, Y[y0:y1, x0:x1] - cy) / r + (nz - 0.5) * 0.55
        ring = np.exp(-((d - 1.0) / 0.07) ** 2)
        fill = smoothstep(1.06, 0.9, d) * 0.28
        s = clamp01(ring * 0.9 + fill) * rng.uniform(0.5, 1.0) * (0.35 + 0.65 * a)
        reg = img[y0:y1, x0:x1]
        img[y0:y1, x0:x1] = reg * (1 - s[..., None] * (1 - tone))
    # foxing: clusters of rust specks
    dens = cover_mask(fbm(rng, h, w, u * 150, 3), 0.18 + 0.2 * a, 0.12)
    spots = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(spots)
    count = int((150 + 1600 * a) * h * w / 1e6)
    xs, ys = rng.uniform(0, w, count), rng.uniform(0, h, count)
    keep = rng.random(count) < dens[np.clip(ys.astype(int), 0, h - 1), np.clip(xs.astype(int), 0, w - 1)]
    for x, y in zip(xs[keep], ys[keep]):
        r = max(0.8, rng.lognormal(0.2, 0.55) * 1.6 * u)
        dr.ellipse([x - r, y - r, x + r, y + r], fill=int(70 + rng.random() * 160))
    sp = gauss(np.asarray(spots, F32) / 255.0, 0.7 * u) * a
    rust = np.array([0.50, 0.30, 0.14], F32)
    img = img * (1 - sp[..., None] * 0.75 * (1 - rust))
    # mold
    mold_f = fbm(rng, h, w, u * 60, 5)
    mold = smoothstep(0.64, 0.78, mold_f + (a - 0.5) * 0.15) * (a ** 1.3)
    speck = noise2d(rng, h, w, u * 1.8)
    mold = gauss(mold * (0.55 + 0.9 * speck), u * 1.2)
    green = np.array([0.52, 0.58, 0.46], F32)
    img = img * (1 - mold[..., None] * 0.55) + green * (mold[..., None] * 0.35)
    return img


def fx_crack(img, a, E, paper):
    rng = E.rng("crack")
    h, w, u = E.h, E.w, E.u
    X, Y = E.xy
    cell = u * 34
    warp = fbm(rng, h, w, u * 60, 3) - 0.5
    warp2 = fbm(rng, h, w, u * 60, 3) - 0.5
    d1, d2, cid = worley(rng, X + warp * cell * 1.2, Y + warp2 * cell * 1.2, cell)
    edge = d2 - d1
    cov = cover_mask(fbm(rng, h, w, u * 190, 3), 0.25 + 0.6 * a, 0.07)
    line = 1 - smoothstep(0.0, (0.9 + 0.8 * a) * u, edge)
    line = line * (0.55 + 0.45 * noise2d(rng, h, w, u * 5))
    pale = np.minimum(paper * 1.03 + 0.03, 1.0)
    shade = np.exp(-((edge - 2.4 * u) / (1.1 * u)) ** 2) * 0.32
    img = img * (1 + (cid[..., None] - 0.5) * 0.12 * cov[..., None])
    img = img * (1 - (shade * cov)[..., None])
    k = (line * cov * 0.8)[..., None]
    return img + (pale - img) * k


def fx_peel(img, a, E, paper):
    rng = E.rng("peel")
    h, w, u = E.h, E.w, E.u
    X, Y = E.xy
    n = fbm(rng, h, w, u * 70, 5)
    d = np.minimum(np.minimum(X, w - 1 - X), np.minimum(Y, h - 1 - Y)) / (0.3 * E.size)
    f = n + 0.55 * (1 - clamp01(d)) ** 1.5 + (fbm(rng, h, w, u * 9, 3) - 0.5) * 0.22
    m = cover_mask(f, 0.30 * (a ** 1.3), 0.012)
    m_s = gauss(m, u * 1.3)
    ridge = np.abs(m - m_s) * 2.2
    shadow = shift(gauss(m, u * 4.0), int(2.2 * u), int(2.8 * u)) * (1 - m)
    base = paper_texture(E, rng, paper) * (0.88 + 0.12 * noise2d(rng, h, w, u * 30))[..., None]
    img = img * (1 - shadow[..., None] * 0.5)
    img = img * (1 - m_s[..., None]) + base * m_s[..., None]
    return clamp01(img + ridge[..., None] * 0.28 * (1 - 0.3 * img))


def fx_crease(img, a, E, paper):
    rng = E.rng("crease")
    h, w, u = E.h, E.w, E.u
    X, Y = E.xy
    count = max(1, int(round(a * 5.2)))
    L = int(math.hypot(h, w) * 2) + 4
    idx = np.arange(L, dtype=F32)
    for _ in range(count):
        if rng.random() < 0.6:
            ang = rng.choice([0.0, math.pi / 2]) + rng.uniform(-0.45, 0.45)
        else:
            ang = rng.uniform(0, math.pi)
        px, py = rng.uniform(0.15, 0.85) * w, rng.uniform(0.15, 0.85) * h
        tx, ty = math.cos(ang), math.sin(ang)
        nx, ny = -ty, tx
        s = (X - px) * nx + (Y - py) * ny
        t = (X - px) * tx + (Y - py) * ty
        wob = np.interp(t + L / 2, idx, noise1d(rng, L, u * 90, 3) * u * 7)
        s = s + wob.astype(F32)
        brk = np.interp(t + L / 2, idx, noise1d(rng, L, u * 22, 3))
        strength = rng.uniform(0.6, 1.0) * (0.45 + 0.55 * a)
        line = np.exp(-(s / (0.85 * u)) ** 2)
        white = line * smoothstep(-0.25, 0.25, brk) * strength
        dark = np.exp(-((s - 1.8 * u) / (1.3 * u)) ** 2) * 0.22 * strength
        light = np.tanh(s / (7 * u)) * 0.07 * strength
        wear = np.exp(-(s / (14 * u)) ** 2) * 0.12 * strength
        img = img * (1 - dark[..., None]) + light[..., None]
        lum = luma(img)[..., None]
        img = img + (lum - img) * (wear[..., None] * 0.6)
        img = img + (np.minimum(paper * 1.04, 1.0) - img) * (white[..., None] * 0.9)
    return clamp01(img)


def fx_dust(img, a, E):
    rng = E.rng("dust")
    h, w, u = E.h, E.w, E.u
    area = h * w / 1e6
    light = Image.new("L", (w, h), 0)
    dark = Image.new("L", (w, h), 0)
    dl, dd = ImageDraw.Draw(light), ImageDraw.Draw(dark)
    n = int((60 + 900 * a) * area)
    for _ in range(n):
        x, y = rng.random() * w, rng.random() * h
        r = max(0.55, rng.lognormal(0, 0.6) * 0.85 * u)
        (dl if rng.random() < 0.6 else dd).ellipse(
            [x - r, y - r * rng.uniform(0.6, 1.0), x + r, y + r], fill=int(110 + rng.random() * 145))
    wd = max(1, int(round(0.9 * u)))
    for _ in range(int((4 + 40 * a) * area)):  # hairs
        x, y, ang = rng.random() * w, rng.random() * h, rng.random() * 6.283
        pts = [(x, y)]
        for _ in range(int(rng.integers(8, 28))):
            ang += rng.normal(0, 0.35)
            x += math.cos(ang) * rng.uniform(3, 6) * u
            y += math.sin(ang) * rng.uniform(3, 6) * u
            pts.append((x, y))
        (dl if rng.random() < 0.55 else dd).line(pts, fill=int(90 + rng.random() * 150), width=wd)
    for _ in range(int(round(a * 9 * max(0.6, area)))):  # long scratches
        x, y0 = rng.random() * w, rng.random() * h
        y1 = y0 + rng.uniform(0.1, 0.8) * h
        pts, y, ph = [], y0, rng.random() * 6
        while y < y1:
            pts.append((x + math.sin(y / (30 * u) + ph) * 1.5 * u + rng.normal(0, 0.25), y))
            y += 6 * u
        if len(pts) > 1:
            (dl if rng.random() < 0.7 else dd).line(pts, fill=int(110 + rng.random() * 140), width=wd)
    lm = gauss(np.asarray(light, F32) / 255.0, 0.65 * u)[..., None]
    dm = gauss(np.asarray(dark, F32) / 255.0, 0.65 * u)[..., None]
    img = img + (1 - img) * (lm * 0.85)
    return img * (1 - dm * 0.75)


def fx_grain(img, a, E):
    rng = E.rng("grain")
    h, w, u = E.h, E.w, E.u
    n = rng.standard_normal((h, w)).astype(F32)
    n = gauss(n, 0.55 * u)
    n = n / (float(n.std()) + 1e-6) * 0.8
    nc = rng.standard_normal((h, w, 3)).astype(F32) * 0.35
    lum = luma(img)
    wt = (1 - np.abs(lum - 0.5) * 1.1)[..., None]
    return clamp01(img + (n[..., None] + nc) * (0.012 + 0.11 * a) * wt)


def _cut(E, rng, anchor, normal, depth, rough, rim, cell):
    """Irregular tear line. Returns (s_in, s_out): signed distance in px, >0 = image / paper intact."""
    nx, ny = normal
    tx, ty = -ny, nx
    X, Y = E.xy
    px, py = X - anchor[0], Y - anchor[1]
    s0 = px * nx + py * ny - depth
    t = px * tx + py * ty
    L = int(math.hypot(E.h, E.w) * 2) + 4
    idx = np.arange(L, dtype=F32)
    off = rough * (noise1d(rng, L, cell, 3) + 0.45 * noise1d(rng, L, max(2.0, cell * 0.12), 2))
    rimn = noise1d(rng, L, cell * 0.35, 3) * 0.5 + 0.5
    q = t + L / 2
    s_in = s0 + np.interp(q, idx, off).astype(F32)
    s_out = s_in + (rim * (0.35 + 1.1 * np.interp(q, idx, rimn))).astype(F32)
    return s_in, s_out


def _aa(s):
    return np.clip(s + 0.5, 0.0, 1.0)


def fx_destroy_edges(img, E, paper, p, tint):
    """Torn edges, ripped corners, burns. Returns straight-alpha RGBA."""
    h, w, u, size = E.h, E.w, E.u, E.size
    A_i = np.full((h, w), 1e6, F32)
    A_p = np.full((h, w), 1e6, F32)
    S_b = None
    rng_t = E.rng("tear")
    rng_c = E.rng("corner")
    rng_b = E.rng("burn")

    a = p["tear"]
    if a > 0:
        edges = [((0, h / 2), (1, 0)), ((w, h / 2), (-1, 0)), ((w / 2, 0), (0, 1)), ((w / 2, h), (0, -1))]
        for anchor, nrm in edges:
            if rng_t.random() < min(1.0, 0.3 + 1.3 * a):
                depth = rng_t.uniform(0.15, 1.0) * a * 0.035 * size
                si, so = _cut(E, rng_t, anchor, nrm, depth, u * (2 + 9 * a), u * (2 + 6 * a), u * rng_t.uniform(18, 40))
                A_i, A_p = np.minimum(A_i, si), np.minimum(A_p, so)
    a = p["corner"]
    if a > 0:
        corners = [(0, 0), (w, 0), (0, h), (w, h)]
        order = rng_c.permutation(4)
        for ci in order[:max(1, int(round(a * 3.2)))]:
            cx, cy = corners[ci]
            base = math.atan2(h / 2 - cy, w / 2 - cx) + rng_c.uniform(-0.45, 0.45)
            depth = size * rng_c.uniform(0.04, 0.13) * (0.6 + 0.9 * a)
            si, so = _cut(E, rng_c, (cx, cy), (math.cos(base), math.sin(base)), depth,
                          u * (7 + 16 * a), u * (3 + 7 * a), u * 55)
            A_i, A_p = np.minimum(A_i, si), np.minimum(A_p, so)
    a = p["burn"]
    c1 = c2 = None
    if a > 0:
        c1, c2 = u * (5 + 9 * a), u * (30 + 70 * a)
        S_b = np.full((h, w), 1e6, F32)
        corners = [(0, 0), (w, 0), (0, h), (w, h)]
        for _ in range(1 + int(a * 2.5)):
            depth = size * rng_b.uniform(0.05, 0.12 + 0.2 * a)
            if rng_b.random() < 0.7:
                cx, cy = corners[int(rng_b.integers(0, 4))]
                base = math.atan2(h / 2 - cy, w / 2 - cx) + rng_b.uniform(-0.5, 0.5)
                anchor, nrm = (cx, cy), (math.cos(base), math.sin(base))
            else:
                anchor, nrm = [((0, h / 2), (1, 0)), ((w, h / 2), (-1, 0)), ((w / 2, 0), (0, 1)), ((w / 2, h), (0, -1))][int(rng_b.integers(0, 4))]
                depth *= 0.5
            si, _ = _cut(E, rng_b, anchor, nrm, depth, depth * 0.28, 0, depth * 0.7)
            S_b = np.minimum(S_b, si)
        holes = (fbm(rng_b, h, w, u * 22, 4) - 0.5) * u * (60 + 80 * a)
        S_b = S_b + holes * smoothstep(c2 * 1.8, 0, S_b)
        # scorching
        g = smoothstep(c2, 0, S_b)
        scorch = np.array([0.34, 0.17, 0.08], F32)
        img = img * (1 + (scorch - 1) * (g ** 0.8)[..., None])
        char = smoothstep(c1, 0, S_b)
        img = img * (1 - char[..., None] * 0.96) + np.array([0.04, 0.03, 0.025], F32) * (char[..., None] * 0.96)
        ember = np.exp(-((S_b - 0.6 * u) / (1.4 * u)) ** 2) * (0.5 + 0.5 * noise2d(rng_b, h, w, u * 6))
        img = img + np.array([0.9, 0.35, 0.08], F32) * (ember[..., None] * 0.45 * (S_b > 0)[..., None])
        A_i = np.minimum(A_i, S_b)
        A_p = np.minimum(A_p, S_b)

    ai, ap = _aa(A_i), _aa(A_p)
    rng_r = E.rng("tear")
    rng_r.random(3)
    fibre = noise2d(rng_r, h, w, u * 1.3) * 0.5 + noise2d(rng_r, h, w, u * 4) * 0.5
    rim = paper_texture(E, rng_r, paper) * (0.93 + 0.12 * fibre[..., None])
    rim = rim * (0.9 + 0.1 * smoothstep(0, 3 * u, A_p))[..., None]
    rgb = img * ai[..., None] + rim * (1 - ai[..., None])
    return np.dstack([clamp01(rgb), ap]).astype(F32)


# ───────────────────── WIRED: digital faults ──────────────────────────

def fx_glitch(img, a, E):
    rng = E.rng("glitch")
    h, w = E.h, E.w
    out = img.copy()
    for _ in range(int(2 + 22 * a)):
        y = int(rng.integers(0, h))
        y1 = min(h, y + int(max(2, rng.exponential(0.02 * h) * (0.4 + a))))
        out[y:y1] = np.roll(out[y:y1], int(rng.normal(0, 0.05 * w * a)), axis=1)
        if rng.random() < 0.5:
            c = int(rng.integers(0, 3))
            out[y:y1, :, c] = np.roll(out[y:y1, :, c], int(rng.normal(0, 0.02 * w * a)), axis=1)
        if rng.random() < 0.1:
            out[y:y1] = out[y:y1] * 0.45 + rng.random(3).astype(F32) * 0.55
    src = out.copy()
    for _ in range(int(1 + 8 * a)):
        bw = int(rng.uniform(0.05, 0.3) * w)
        bh = int(rng.uniform(0.02, 0.12) * h)
        sx, sy = int(rng.integers(0, max(1, w - bw))), int(rng.integers(0, max(1, h - bh)))
        dx = int(np.clip(sx + rng.normal(0, 0.12 * w), 0, w - bw))
        dy = int(np.clip(sy + rng.normal(0, 0.05 * h), 0, h - bh))
        out[dy:dy + bh, dx:dx + bw] = src[sy:sy + bh, sx:sx + bw]
    return out


def fx_chroma(img, a, E):
    d = max(1, int(0.014 * E.size * a))
    out = img.copy()
    out[..., 0] = shift(img[..., 0], d, int(d * 0.2))
    out[..., 2] = shift(img[..., 2], -d, -int(d * 0.2))
    return out


def fx_scan(img, a, E):
    rng = E.rng("scan")
    h, w, u = E.h, E.w, E.u
    out = img.copy()
    rows = np.arange(h, dtype=F32)
    line = 0.5 + 0.5 * np.sin(rows * (2 * math.pi / max(2.0, 3.0 * u)))
    out *= (1 - 0.30 * a * line)[:, None, None]
    for _ in range(int(4 + 40 * a)):
        y = int(rng.integers(0, h))
        x0 = int(rng.integers(0, w))
        x1 = min(w, x0 + int(rng.uniform(0.05, 0.5) * w))
        out[y, x0:x1] += rng.random() * 0.45 * a
    bh = max(4, int(h * 0.04 * (0.5 + 2 * a)))
    by = int(h * (0.7 + 0.2 * rng.random()))
    by = min(by, h - bh)
    offs = (noise1d(rng, bh, 4) * 0.05 * w * a).astype(int)
    for i in range(bh):
        out[by + i] = np.roll(out[by + i], int(offs[i]), axis=0)
    out[by:by + bh] += (rng.random((bh, w, 1)).astype(F32) - 0.4) * 0.6 * a
    return clamp01(out)


def fx_ghost(img, a, E):
    h, w, u = E.h, E.w, E.u
    g = shift(img, int(0.035 * w), -int(0.02 * h))
    g = gauss(g, u * 5)
    l = luma(g)[..., None]
    g = l * np.array([0.65, 0.9, 1.0], F32)
    return clamp01(1 - (1 - img) * (1 - g * 0.65 * a))


def fx_bloom(img, a, E):
    u = E.u
    hi = np.clip(img - 0.5, 0, None) * 2.0
    glow = (gauss(hi, u * (10 + 30 * a)) * 0.9 + gauss(hi, u * 4) * 0.5) * (0.4 + 1.2 * a)
    out = 1 - (1 - img) * (1 - clamp01(glow))
    out = out + np.array([0.0, 0.03, 0.06], F32) * glow + 0.06 * a
    return clamp01(out)


def fx_rot(img, a, E):
    rng = E.rng("rot")
    h, w, u = E.h, E.w, E.u
    levels = max(6, int(round(64 - 52 * a)))
    out = np.round(img * (levels - 1)) / (levels - 1)
    out = out.astype(F32)
    for _ in range(int(1 + 10 * a)):
        bw, bh = int(rng.uniform(0.08, 0.4) * w), int(rng.uniform(0.04, 0.25) * h)
        x, y = int(rng.integers(0, max(1, w - bw))), int(rng.integers(0, max(1, h - bh)))
        k = max(3, int(rng.integers(6, 40) * u))
        reg = out[y:y + bh, x:x + bw]
        small = reg[::k, ::k]
        reg2 = np.repeat(np.repeat(small, k, 0), k, 1)[:reg.shape[0], :reg.shape[1]]
        if rng.random() < 0.3:
            reg2 = reg2.copy()
            reg2[..., int(rng.integers(0, 3))] *= 0.3
        out[y:y + bh, x:x + bw] = reg2
    for _ in range(int(20 * a * h * w / 1e6) + 2):  # broken 8x8 blocks
        bx, by = int(rng.integers(0, max(1, w - 8))), int(rng.integers(0, max(1, h - 8)))
        out[by:by + 8, bx:bx + 8] = out[by:by + 8, bx:bx + 8].mean(axis=(0, 1)) * rng.uniform(0.8, 1.2)
    return clamp01(out)


# ───────────────────── DIGITAL KILL ──────────────────────────────────

def fx_sort(img, a, E):
    """Pixel sorting: spans of mid-bright pixels get sorted by luminance."""
    rng = E.rng("sort")
    h, w, u = E.h, E.w, E.u
    out = img.copy()
    lum = luma(img)
    vertical = rng.random() < 0.35
    work = out.transpose(1, 0, 2) if vertical else out
    lw = lum.T if vertical else lum
    H = work.shape[0]
    lo, hi = rng.uniform(0.15, 0.3), rng.uniform(0.75, 0.95)
    sel = noise1d(rng, H, 24 * u, 3) > (0.35 - 0.9 * a)
    minlen = max(4, int(5 * u))
    for r in np.nonzero(sel)[0]:
        row = lw[r]
        mask = ((row > lo) & (row < hi)).astype(np.int8)
        d = np.diff(np.concatenate(([0], mask, [0])))
        for s, e in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
            if e - s < minlen:
                continue
            order = np.argsort(row[s:e], kind="stable")
            work[r, s:e] = work[r, s:e][order]
    return out


def fx_melt(img, a, E):
    """Columns of pixels sag and drip down the frame."""
    rng = E.rng("melt")
    h, w, u = E.h, E.w, E.u
    out = img.copy()
    x = 0
    while x < w:
        cw = max(1, int(rng.uniform(1.5, 14) * u))
        if rng.random() < 0.15 + 0.6 * a:
            y0 = int(h * rng.uniform(0.12, 0.95))
            y1 = min(h, y0 + max(4, int(h * rng.uniform(0.05, 0.6) * (0.3 + a))))
            if y1 - y0 > 3 and y0 > 3:
                src = img[y0 - 3:y0, x:x + cw].mean(axis=0)  # (cw, 3)
                t = np.linspace(0, 1, y1 - y0, dtype=F32)[:, None, None]
                keep = smoothstep(0.55, 1.0, t)
                streak = src[None] * (1 - 0.18 * t)
                out[y0:y1, x:x + cw] = streak * (1 - keep) + out[y0:y1, x:x + cw] * keep
        x += cw
    return out


def fx_corrupt(img, a, E):
    """Deep-fry + chroma smear + flipped bytes."""
    rng = E.rng("corrupt")
    h, w, u = E.h, E.w, E.u
    out = img + (img - gauss(img, 1.2 * u)) * (0.9 * a)          # over-sharpen
    l = luma(out)[..., None]
    out = l + (out - l) * (1 + 0.8 * a)                          # over-saturate
    # chroma loses resolution in blocks
    f = max(2, int((2 + 10 * a) * u))
    hp, wp = -(-h // f) * f, -(-w // f) * f
    pad = np.pad(out, ((0, hp - h), (0, wp - w), (0, 0)), mode="edge")
    Y = luma(pad)[..., None]
    C = pad - Y
    Cb = C.reshape(hp // f, f, wp // f, f, 3).mean(axis=(1, 3))
    C = np.repeat(np.repeat(Cb, f, 0), f, 1)
    blend = min(1.0, 1.4 * a)
    pad = pad + (Y + C - pad) * blend
    out = pad[:h, :w]
    # flipped bytes
    b = np.clip(out * 255, 0, 255).astype(np.uint8)
    flat = b.reshape(-1)
    n = flat.size
    for _ in range(int(4 + 50 * a)):
        s = int(rng.integers(0, n))
        ln = int(max(3, rng.exponential(0.05 * w * 3 * (0.3 + a))))
        mode = int(rng.integers(0, 3))
        seg = flat[s:s + ln]
        if mode == 0:
            seg ^= np.uint8(rng.integers(1, 256))
        elif mode == 1:
            seg += np.uint8(rng.integers(1, 256))
        else:
            seg[:] = np.uint8(rng.integers(0, 256))
    return clamp01(b.astype(F32) / 255.0)


def fx_redact(img, a, E):
    """Black redaction bars plus a secure-erase pass."""
    rng = E.rng("redact")
    h, w, u = E.h, E.w, E.u
    out = img.copy()
    for _ in range(int(2 + 14 * a)):
        bh = max(3, int(u * rng.uniform(9, 26)))
        bw = int(rng.uniform(0.08, 0.5) * w)
        y = int(int(rng.uniform(0.03, 0.95) * h / (bh * 1.4)) * bh * 1.4)
        x = int(rng.uniform(0, 1) * max(1, w - bw))
        out[y:y + bh, x:x + bw] = 0.02 if rng.random() < 0.85 else 0.93
    if a > 0.35:
        hh = int(h * rng.uniform(0.12, 0.32))
        y0 = int(rng.uniform(0.05, 0.9) * max(1, h - hh))
        wx = int(w * (0.25 + 0.6 * a))
        nz = (rng.random((hh, wx, 1)).astype(F32) * 0.07)
        rows = (0.5 + 0.5 * np.sin(np.arange(hh, dtype=F32) * 2 * math.pi / max(2.0, 3 * u)))[:, None, None]
        out[y0:y0 + hh, :wx] = nz * (0.6 + 0.4 * rows)
        e = max(1, int(2 * u))
        out[y0:y0 + hh, max(0, wx - e):wx] = np.array([0.3, 0.95, 1.0], F32)
    return out


# ───────────────────── dissolve & shredder (RGBA stage) ──────────────

def _premult(rgba):
    return np.dstack([rgba[..., :3] * rgba[..., 3:4], rgba[..., 3:4]]).astype(F32)


def _unpremult(P):
    A = P[..., 3:4]
    return np.dstack([clamp01(np.where(A > 1e-4, P[..., :3] / np.maximum(A, 1e-4), 0)), A[..., 0]]).astype(F32)


def fx_dissolve(rgba, a, E_in, seed):
    """Image crumbles into drifting particles. Pads the canvas so particles have room."""
    h0, w0 = rgba.shape[:2]
    m = int(0.12 * min(h0, w0))
    P0 = np.zeros((h0 + 2 * m, w0 + 2 * m, 4), F32)
    P0[m:m + h0, m:m + w0] = _premult(rgba)
    E = Ctx(h0 + 2 * m, w0 + 2 * m, E_in.u, seed)
    h, w, u = E.h, E.w, E.u
    X, Y = E.xy
    rng = E.rng("dissolve")
    ang = rng.uniform(-0.55, 0.55) + (math.pi if rng.random() < 0.3 else 0.0)
    dx, dy = math.cos(ang), math.sin(ang) * 0.6 - 0.25
    nrm = math.hypot(dx, dy)
    dx, dy = dx / nrm, dy / nrm
    pos = ((X - w / 2) * dx + (Y - h / 2) * dy) / (0.5 * math.hypot(h0, w0)) * 0.5 + 0.5
    f = fbm(rng, h, w, u * 6, 3)
    fn = noise2d(rng, h, w, u * 1.6)
    s = pos + (f - 0.5) * 0.55 + (fn - 0.5) * 0.25
    th = 1.45 - 1.6 * a
    alive = 1 - smoothstep(th - 0.015, th + 0.015, s)
    dead = 1 - alive
    P = P0 * alive[..., None]
    for layer in range(3):
        dist = u * rng.uniform(15, 110) * (0.3 + 0.7 * a)
        rr = noise2d(rng, h, w, u * 3) + 0.3
        jit = (noise2d(rng, h, w, u * 5) - 0.5) * u * 40
        qx = X - dx * dist * rr + jit * dy
        qy = Y - dy * dist * rr - jit * dx
        D = remap(dead, qx, qy)
        src = remap(P0, qx, qy)
        prob = (noise2d(rng, h, w, u * 1.4) < (0.30 - 0.07 * layer)).astype(F32)
        k = (D * prob * (1.0 - 0.28 * layer))[..., None]
        part = src * k
        pa = part[..., 3:4]
        P = P * (1 - pa) + part
    return _unpremult(P)


def _place(P, patch, pivot, cx, cy, ang, shade=1.0):
    """Composite a premultiplied RGBA patch onto P with rotation `ang` about `pivot` (px,py in patch)."""
    ph, pw = patch.shape[:2]
    H, W = P.shape[:2]
    R = math.hypot(ph, pw) + 2
    x0, x1 = int(max(0, cx - R)), int(min(W, cx + R))
    y0, y1 = int(max(0, cy - R)), int(min(H, cy + R))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(F32)
    dx, dy = gx - cx, gy - cy
    c, s = math.cos(ang), math.sin(ang)
    mx = dx * c + dy * s + pivot[0]
    my = -dx * s + dy * c + pivot[1]
    cov = np.clip(np.minimum(np.minimum(mx + 0.5, pw - 0.5 - mx), np.minimum(my + 0.5, ph - 0.5 - my)) + 0.5, 0, 1)
    if cov.max() <= 0:
        return
    smp = remap(patch, mx, my) * cov[..., None]
    smp[..., :3] *= shade
    reg = P[y0:y1, x0:x1]
    P[y0:y1, x0:x1] = reg * (1 - smp[..., 3:4]) + smp


def fx_shred(rgba, p, E_in, seed):
    """Paper shredder. Top stays intact, the rest hangs as fanned strips (or falls as confetti)."""
    a = p["shred"]
    u = E_in.u
    h, w = rgba.shape[:2]
    rng = np.random.default_rng([seed & 0x7FFFFFFF, K["shred"]])
    ws = max(4, int(u * (8 + 52 * p["shred_w"])))
    chaos = p["shred_chaos"]
    cross = p.get("cut") == "cross"
    ycut = int(h * (1 - a) * 0.94)
    if cross:
        ch = int(ws * 1.7)
        while ((w / ws) * ((h - ycut) / ch)) > 4500:
            ws = int(ws * 1.25)
            ch = int(ws * 1.7)
    pad = int(0.06 * w)
    extra = int(0.3 * h * a)
    H, W = h + extra, w + 2 * pad
    Pm = _premult(rgba)
    P = np.zeros((H, W, 4), F32)
    P[:ycut, pad:pad + w] = Pm[:ycut]
    sl = max(2, int(2.5 * u))
    if ycut > sl:
        P[ycut - sl:ycut, pad:pad + w, :3] *= 0.62   # shadow in the slot
    pile = []    # (patch, pivot, cx, cy, ang, shade)
    strips = []
    n = -(-w // ws)
    for i in range(n):
        x0, x1 = i * ws, min(w, (i + 1) * ws)
        sw = x1 - x0
        full = h - ycut
        if full <= 2:
            continue
        shade = 1 + rng.normal(0, 0.035)
        if cross:
            nrows = max(1, int(full // ch))
            for r in range(nrows):
                y0 = ycut + r * ch
                piece = Pm[y0:y0 + ch, x0:x1]
                if piece.shape[0] < 2 or piece[..., 3].max() < 0.02:
                    continue
                pv = (piece.shape[1] / 2, piece.shape[0] / 2)
                if r == 0:
                    strips.append((piece, pv, pad + x0 + sw / 2 + rng.normal(0, ws * 0.15 * chaos), y0 + piece.shape[0] / 2, rng.normal(0, 0.05 * chaos), shade))
                else:
                    depth = float(rng.beta(1.7, 0.75))
                    cy = ycut + ch + depth * (H - ycut - 1.6 * ch)
                    cx = pad + x0 + sw / 2 + rng.normal(0, ws * (1.0 + 2.0 * chaos))
                    pile.append((piece, pv, cx, cy, rng.uniform(-math.pi, math.pi), shade * rng.uniform(0.9, 1.0)))
            continue
        keep = full if rng.random() > 0.35 * (0.4 + chaos) else int(full * rng.uniform(0.45, 0.92))
        strip = Pm[ycut:ycut + keep, x0:x1]
        if strip[..., 3].max() < 0.02:
            continue
        tx = (i - n / 2) * ws * 0.22 * chaos + rng.normal(0, ws * 0.12 * chaos)
        ang = rng.normal(0, 0.03 * chaos + 0.004) + (i - n / 2) / n * 0.05 * chaos
        strips.append((strip, (sw / 2, 0.0), pad + x0 + sw / 2 + tx, float(ycut), ang, shade))
        if keep < full:
            rest = Pm[ycut + keep:, x0:x1]
            if rest.shape[0] > 2:
                pile.append((rest, (rest.shape[1] / 2, rest.shape[0] / 2), pad + x0 + sw / 2 + rng.normal(0, ws * 2.5 * chaos),
                             H - rest.shape[0] * 0.5 - rng.uniform(0, 0.16) * H * a, rng.uniform(-1.45, 1.45), shade * 0.95))
    rng.shuffle(pile)
    for patch, pv, cx, cy, ang, shade in pile:
        _place(P, patch, pv, cx, cy, ang, shade)
    for patch, pv, cx, cy, ang, shade in strips:
        _place(P, patch, pv, cx, cy, ang, shade)
    return _unpremult(P)


# ─────────────────────────── labels ───────────────────────────────────

_FONT_CANDIDATES = ["consola.ttf", "DejaVuSansMono.ttf", "LiberationMono-Regular.ttf",
                    "cour.ttf", "Menlo.ttc", "Courier New.ttf"]
_font_cache = {}


def get_font(size):
    size = int(max(8, size))
    if size in _font_cache:
        return _font_cache[size]
    f = None
    for name in _FONT_CANDIDATES:
        try:
            f = ImageFont.truetype(name, size)
            break
        except Exception:
            continue
    if f is None:
        try:
            f = ImageFont.load_default(size)
        except TypeError:
            f = ImageFont.load_default()
    _font_cache[size] = f
    return f


def _label_text(rng):
    r = random.Random(int(rng.integers(0, 2 ** 31)))
    n = r.randint(1, 99)
    h4 = "%04X" % r.randint(0, 65535)
    opts = [
        "SIGNAL LOST", "NO SUCH FILE", "MEMORY CORRUPT", "NODE %02d / OFFLINE" % n,
        "LAYER %02d" % n, "PROTOCOL %d" % r.randint(1, 9), "ERR 0x%s" % h4,
        "NO CARRIER", "MEMORY ERASED", "FILE DAMAGED", "THE PAST IS DELETED",
        "%d.%02d.%02d  %02d:%02d" % (r.randint(1979, 2003), r.randint(1, 12), r.randint(1, 28), r.randint(0, 23), r.randint(0, 59)),
        "IMG_%04d.RAW" % r.randint(1, 9999), "0x%s 0x%04X 0x%04X" % (h4, r.randint(0, 65535), r.randint(0, 65535)),
        "frame %dA >" % n, "UNLINKED", "CANNOT RESTORE", "LAYER %02d / DELETED" % n,
    ]
    return r.choice(opts)


def draw_labels(rgba, a, E):
    """Overlays scraps of text on straight-alpha RGBA (h,w,4 float)."""
    rng = E.rng("label")
    h, w, u = E.h, E.w, E.u
    ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cols = [(245, 245, 240), (140, 240, 255), (255, 80, 60), (200, 255, 190)]
    for _ in range(int(2 + 11 * a)):
        txt = _label_text(rng)
        f = get_font(u * rng.uniform(11, 26))
        col = cols[int(rng.integers(0, len(cols)))]
        alpha = int(255 * rng.uniform(0.35, 0.9))
        try:
            l, t, r, b = f.getbbox(txt)
        except AttributeError:
            l, t, r, b = 0, 0, 8 * len(txt), 12
        tw, th = r - l + 4, b - t + 4
        tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((2 - l, 2 - t), txt, font=f, fill=col + (alpha,))
        if rng.random() < 0.25:
            tile = tile.rotate(90, expand=True)
        x = int(rng.uniform(0.02, 0.98) * max(1, w - tile.width))
        y = int(rng.uniform(0.02, 0.98) * max(1, h - tile.height))
        ov.alpha_composite(tile, (x, y))
    o = np.asarray(ov, F32) / 255.0
    oa = o[..., 3] * rgba[..., 3]
    rgba[..., :3] = rgba[..., :3] * (1 - oa[..., None]) + o[..., :3] * oa[..., None]
    return rgba


# ─────────────────────────── tape & presentation ────────────────────────────

def fx_tape(P, a, E, rect):
    """P = premultiplied RGBA canvas. rect = (x0,y0,x1,y1) = where the print sits."""
    rng = E.rng("tape")
    H, W, u = E.h, E.w, E.u
    x0, y0, x1, y1 = rect
    size = min(x1 - x0, y1 - y0)
    n = max(1, int(round(a * 4)))
    col = np.array([0.93, 0.84, 0.55], F32)
    corners = [(x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, -1, -1), (x1, y1, 1, -1)]
    for i in range(n):
        if i < 2 or rng.random() < 0.6:
            cx, cy, sg, iy = corners[int(rng.integers(0, 4))]
            ix = 1 if cx == x0 else -1
            cx += ix * size * rng.uniform(0.025, 0.055)
            cy += iy * size * rng.uniform(0.025, 0.055)
            ang = math.radians(sg * rng.uniform(35, 55) + rng.uniform(-6, 6))
        else:
            cx = rng.uniform(0.3, 0.7) * (x1 - x0) + x0
            cy = y0 + rng.normal(0, 0.008) * size
            ang = math.radians(rng.uniform(-12, 12))
        L = size * rng.uniform(0.15, 0.24)
        Wd = size * rng.uniform(0.045, 0.07)
        R = L * 0.75 + Wd
        xa, xb = int(max(0, cx - R)), int(min(W, cx + R))
        ya, yb = int(max(0, cy - R)), int(min(H, cy + R))
        if xb - xa < 4 or yb - ya < 4:
            continue
        gy, gx = np.mgrid[ya:yb, xa:xb].astype(F32)
        dx, dy = gx - cx, gy - cy
        ca, sa = math.cos(ang), math.sin(ang)
        xl = dx * ca + dy * sa
        yl = -dx * sa + dy * ca
        m = 2 * int(R) + 8
        zig = np.interp(yl + m / 2, np.arange(m, dtype=F32), noise1d(rng, m, u * 5, 2) * u * 3.0 + np.sin(np.arange(m) / (2.2 * u)) * u * 2.2).astype(F32)
        sdx = np.abs(xl) - L / 2 + zig
        sdy = np.abs(yl) - Wd / 2
        al = _aa(-np.maximum(sdx, sdy))
        stripes = noise2d(rng, yb - ya, xb - xa, (u * 1.5, u * 40))
        base_a = (0.50 + 0.12 * stripes) * al
        sheen = np.exp(-((yl - Wd * 0.12) / (Wd * 0.18)) ** 2) * 0.16 * al
        edge = np.exp(-((np.maximum(sdx, sdy) + 0.8 * u) / (1.1 * u)) ** 2) * 0.10 * al
        reg = P[ya:yb, xa:xb]
        rgb = reg[..., :3]
        Aold = reg[..., 3:4]
        tape_rgb = col[None, None, :] * (1 - edge[..., None]) + sheen[..., None]
        ba = base_a[..., None]
        # the photo shows through the tape, slightly yellowed
        newP = rgb * (1 - ba) + (tape_rgb * ba) * 1.0 + rgb * ba * 0.42 * (col[None, None, :])
        newA = Aold * (1 - ba) + ba
        P[ya:yb, xa:xb, :3] = np.minimum(newP, newA)
        P[ya:yb, xa:xb, 3:4] = newA
    return P


def compose(rgba, p, E_print, seed, tint):
    """Print (straight RGBA) -> final picture with tape, shadow and backdrop."""
    h, w = rgba.shape[:2]
    backdrop = p["backdrop"]
    need_canvas = backdrop != "none" or p["tape"] > 0
    m = int(0.07 * min(h, w)) if need_canvas else 0
    H, W = h + 2 * m, w + 2 * m
    E = Ctx(H, W, E_print.u, seed)
    P = np.zeros((H, W, 4), F32)
    P[m:m + h, m:m + w, :3] = rgba[..., :3] * rgba[..., 3:4]
    P[m:m + h, m:m + w, 3] = rgba[..., 3]
    if p["tape"] > 0:
        P = fx_tape(P, p["tape"], E, (m, m, m + w, m + h))
    if backdrop == "none":
        A = P[..., 3:4]
        rgb = np.where(A > 1e-4, P[..., :3] / np.maximum(A, 1e-4), 0)
        out = np.dstack([clamp01(rgb), A[..., 0]])
        return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")

    rng = E.rng("tilt")
    ang = math.radians(rng.uniform(-2.2, 2.2))
    X, Y = E.xy
    cx, cy = W / 2, H / 2
    ca, sa = math.cos(ang), math.sin(ang)
    mx = (X - cx) * ca + (Y - cy) * sa + cx
    my = -(X - cx) * sa + (Y - cy) * ca + cy
    P = remap(P, mx, my)

    rngb = E.rng("bg")
    u = E.u
    if backdrop == "dark":
        base = np.array([0.060, 0.054, 0.050], F32)
        amp = 0.05
    else:
        base = np.array([0.70, 0.64, 0.54], F32)
        amp = 0.09
    n1 = fbm(rngb, H, W, u * 120, 4)
    n2 = noise2d(rngb, H, W, u * 1.7)
    bg = base[None, None, :] + ((n1 - 0.5) * amp + (n2 - 0.5) * amp * 0.5)[..., None]
    if backdrop == "paper":
        fib = noise2d(rngb, H, W, (u * 1.2, u * 24)) - 0.5
        bg = bg + fib[..., None] * 0.05
    r = np.hypot((X - cx) / (W / 2), (Y - cy) / (H / 2))
    bg = bg * (1.12 - 0.34 * clamp01(r - 0.2))[..., None]

    A = P[..., 3]
    sz = min(H, W)
    sh = gauss(shift(A, int(0.012 * sz), int(0.018 * sz)), 0.016 * sz) * 0.62
    sh2 = gauss(shift(A, int(0.003 * sz), int(0.005 * sz)), 0.004 * sz) * 0.5
    shadow = clamp01(sh + sh2)
    out = bg * (1 - shadow[..., None]) * (1 - A[..., None]) + P[..., :3]
    return Image.fromarray((clamp01(out) * 255 + 0.5).astype(np.uint8), "RGB")


# ───────────────────────────── main entry ───────────────────────────

def normalize(params, master=100):
    p = {}
    for k in KEYS:
        m = 100.0 if k in ("shred_w", "shred_chaos") else master   # shape params ignore the master slider
        v = float(params.get(k, 0) or 0) * m / 100.0
        p[k] = float(np.clip(v, 0, 100)) / 100.0
    p["tint"] = params.get("tint", "amber") if params.get("tint") in TINT_GAIN else "amber"
    p["backdrop"] = params.get("backdrop", "none") if params.get("backdrop") in ("none", "dark", "paper") else "none"
    p["cut"] = "cross" if params.get("cut") == "cross" else "strip"
    return p


def render(src, params, seed=1, master=100, max_side=1100, progress=None):
    """src = PIL.Image; params = dict of sliders 0..100 (+tint, backdrop).
    Returns a PIL.Image (RGBA for a transparent backdrop, otherwise RGB)."""
    p = normalize(params, master)
    tint = p["tint"]
    img = prepare(src, max_side)
    h0, w0 = img.shape[:2]
    u0 = min(h0, w0) / 1000.0

    def step(name):
        if progress:
            progress(name)

    step("border")
    if p["border"] > 0:
        img, _ = fx_border(img, p["border"], u0, seed, tint, p["fade"])
    h, w = img.shape[:2]
    E = Ctx(h, w, u0, seed)
    paper = aged_paper(tint, p["fade"])

    # digital faults are part of the frame content, so they come first
    for name, fn in (("sort", fx_sort), ("melt", fx_melt), ("corrupt", fx_corrupt),
                     ("glitch", fx_glitch), ("chroma", fx_chroma), ("scan", fx_scan),
                     ("rot", fx_rot), ("redact", fx_redact), ("ghost", fx_ghost), ("bloom", fx_bloom)):
        if p[name] > 0:
            step(name)
            img = fn(img, p[name], E)

    if p["water"] > 0:
        step("water")
        img = fx_water_warp(img, p["water"], E)
    if p["fade"] > 0 or tint != "none":
        step("fade")
        img = fx_fade(img, p["fade"], tint)
    if p["mirror"] > 0:
        step("mirror")
        img = fx_mirror(img, p["mirror"], E)
    if p["stain"] > 0:
        step("stain")
        img = fx_stain(img, p["stain"], E, paper)
    if p["water"] > 0:
        img = fx_water_marks(img, p["water"], E, paper)
    if p["crack"] > 0:
        step("crack")
        img = fx_crack(img, p["crack"], E, paper)
    if p["peel"] > 0:
        step("peel")
        img = fx_peel(img, p["peel"], E, paper)
    if p["crease"] > 0:
        step("crease")
        img = fx_crease(img, p["crease"], E, paper)
    if p["dust"] > 0:
        step("dust")
        img = fx_dust(img, p["dust"], E)
    if p["grain"] > 0:
        step("grain")
        img = fx_grain(img, p["grain"], E)

    step("edges")
    if p["tear"] > 0 or p["corner"] > 0 or p["burn"] > 0:
        rgba = fx_destroy_edges(clamp01(img), E, paper, p, tint)
    else:
        rgba = np.dstack([clamp01(img), np.ones((h, w), F32)])
    if p["label"] > 0:
        step("label")
        rgba = draw_labels(rgba, p["label"], E)
    if p["dissolve"] > 0:
        step("dissolve")
        rgba = fx_dissolve(rgba, p["dissolve"], E, seed)
    if p["shred"] > 0:
        step("shred")
        rgba = fx_shred(rgba, p, E, seed)
    step("compose")
    return compose(rgba, p, E, seed, tint)


def load_image(path):
    im = Image.open(path)
    im.load()
    return im
