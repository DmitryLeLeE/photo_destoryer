#!/usr/bin/env python3
"""PHOTO DESTROYER - command line.

  python cli.py photo.jpg -p "Forgotten album" -o out.png
  python cli.py photo.jpg --set fade=80 peel=40 --tint cyan --backdrop dark
  python cli.py --batch ./photos --out ./destroyed -p Wired
  python cli.py photo.jpg --stages 6          # progressive decay: PNG frames + GIF + strip
"""
import argparse
import os
import sys

from destroyer import render, load_image, PRESETS, KEYS, blank
from destroyer.stages import export_stages

EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")


def build_params(args):
    p = blank()
    p.update(PRESETS[args.preset])
    for item in args.set or []:
        k, _, v = item.partition("=")
        if k not in KEYS:
            sys.exit("unknown parameter '%s'. valid: %s" % (k, ", ".join(KEYS)))
        p[k] = float(v)
    if args.tint:
        p["tint"] = args.tint
    if args.backdrop:
        p["backdrop"] = args.backdrop
    return p


def main():
    ap = argparse.ArgumentParser(description="Turn photos into old, broken ones.")
    ap.add_argument("input", nargs="?", help="input image")
    ap.add_argument("-o", "--output", help="output file (default: <name>_destroyed.png)")
    ap.add_argument("-p", "--preset", default="Forgotten album", help="preset name")
    ap.add_argument("--set", nargs="*", metavar="KEY=VAL", help="override sliders, e.g. fade=80")
    ap.add_argument("--tint", choices=["amber", "red", "cyan", "mono", "none"])
    ap.add_argument("--backdrop", choices=["none", "dark", "paper"])
    ap.add_argument("--master", type=float, default=100, help="overall decay %% (0-200)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--max-side", type=int, default=2400, help="longest side in px (0 = original)")
    ap.add_argument("--batch", metavar="DIR", help="process every image in a folder")
    ap.add_argument("--out", metavar="DIR", help="output folder for --batch / --stages")
    ap.add_argument("--stages", type=int, metavar="N", help="export N stages of progressive decay")
    ap.add_argument("--list-presets", action="store_true")
    args = ap.parse_args()

    if args.list_presets:
        print("\n".join(PRESETS))
        return
    if args.preset not in PRESETS:
        sys.exit("unknown preset. available:\n  " + "\n  ".join(PRESETS))
    params = build_params(args)
    ms = args.max_side or None

    if args.batch:
        out_dir = args.out or os.path.join(args.batch, "destroyed")
        os.makedirs(out_dir, exist_ok=True)
        files = sorted(f for f in os.listdir(args.batch) if f.lower().endswith(EXTS))
        for i, f in enumerate(files):
            res = render(load_image(os.path.join(args.batch, f)), params, args.seed + i, args.master, ms)
            dst = os.path.join(out_dir, os.path.splitext(f)[0] + "_destroyed.png")
            res.save(dst)
            print("[%d/%d] %s" % (i + 1, len(files), dst))
        return

    if not args.input:
        ap.error("give an input image or --batch DIR")
    src = load_image(args.input)
    stem = os.path.splitext(os.path.basename(args.input))[0]
    if args.stages:
        out_dir = args.out or os.path.join(os.path.dirname(os.path.abspath(args.input)), stem + "_decay")
        for line in export_stages(src, params, args.seed, args.master, args.stages, out_dir, stem, ms, print):
            pass
        return
    res = render(src, params, args.seed, args.master, ms)
    dst = args.output or os.path.join(os.path.dirname(os.path.abspath(args.input)), stem + "_destroyed.png")
    res.save(dst)
    print(dst)


if __name__ == "__main__":
    main()
