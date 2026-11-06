# -*- coding: utf-8 -*-
"""Progressive decay: the same photo at N stages of destruction (frames + GIF + contact strip)."""
import os
from PIL import Image
from .engine import render


def _flatten(im, bg=(14, 14, 14)):
    if im.mode == "RGBA":
        base = Image.new("RGBA", im.size, bg + (255,))
        base.alpha_composite(im)
        return base.convert("RGB")
    return im.convert("RGB")


def export_stages(src, params, seed, master, n, out_dir, stem, max_side=2400, log=None):
    """Generator: yields (i, n) after every stage so a GUI can show progress."""
    os.makedirs(out_dir, exist_ok=True)
    n = max(2, int(n))
    frames = []
    for i in range(n):
        k = i / (n - 1)
        im = render(src, params, seed, master * k, max_side)
        path = os.path.join(out_dir, "%s_stage_%02d.png" % (stem, i + 1))
        im.save(path)
        frames.append(im)
        if log:
            log("stage %d/%d -> %s" % (i + 1, n, path))
        yield i + 1, n
    flat = [_flatten(f) for f in frames]
    W, H = max(f.width for f in flat), max(f.height for f in flat)
    canvas = []
    for f in flat:
        c = Image.new("RGB", (W, H), (14, 14, 14))
        c.paste(f, ((W - f.width) // 2, (H - f.height) // 2))
        canvas.append(c)
    gif = os.path.join(out_dir, stem + "_decay.gif")
    small = [c.copy() for c in canvas]
    for s in small:
        s.thumbnail((900, 900))
    small[0].save(gif, save_all=True, append_images=small[1:], duration=[700] * (n - 1) + [2000], loop=0)
    tw = 520
    th = int(H * tw / W)
    strip = Image.new("RGB", (tw * n, th), (14, 14, 14))
    for i, c in enumerate(canvas):
        strip.paste(c.resize((tw, th), Image.LANCZOS), (i * tw, 0))
    strip.save(os.path.join(out_dir, stem + "_strip.png"))
    if log:
        log("gif + strip written to " + out_dir)
