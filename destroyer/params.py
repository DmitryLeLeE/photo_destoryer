# -*- coding: utf-8 -*-
"""PHOTO DESTROYER parameters and presets. Single source of truth:
tools/export_web_data.py generates docs/data.js for the web version from this file."""

# (key, label, group, tooltip)
PARAMS = [
    # -- TIME ---------------------------------------------------------------
    ("fade",   "Fade",             "TIME",   "Dyes die unevenly, blacks lift, colour goes dead"),
    ("grain",  "Grain",            "TIME",   "Film grain and scan noise"),
    ("stain",  "Stains & mold",    "TIME",   "Water rings, rust foxing, mold"),
    ("water",  "Water damage",     "TIME",   "Warping, drips, tide lines, bleeding colour"),
    ("mirror", "Silvering",        "TIME",   "Metallic bloom in the shadows, like old prints"),
    # -- DAMAGE -------------------------------------------------------------
    ("crease", "Creases",          "DAMAGE", "Folds with white cracks along the line"),
    ("crack",  "Craquelure",       "DAMAGE", "Web of cracks in dried emulsion"),
    ("peel",   "Emulsion peel",    "DAMAGE", "The image flakes off, bare paper underneath"),
    ("dust",   "Dust & scratches", "DAMAGE", "Dust, hairs, long scratches"),
    ("tear",   "Torn edges",       "DAMAGE", "Ragged edges with paper fibre"),
    ("corner", "Ripped corners",   "DAMAGE", "Corners torn away, backdrop shows through"),
    ("burn",   "Burn marks",       "DAMAGE", "Charred edges, burnt-through holes"),
    # -- WIRED --------------------------------------------------------------
    ("glitch", "Glitch",           "WIRED",  "Displaced data bands and blocks"),
    ("chroma", "Channel split",    "WIRED",  "RGB channels drift apart"),
    ("scan",   "Scan / VHS",       "WIRED",  "Scanlines, static, tracking errors"),
    ("ghost",  "Ghost layer",      "WIRED",  "Cold double from a neighbouring layer"),
    ("bloom",  "Overexposure",     "WIRED",  "Halation and milky blow-out"),
    ("rot",    "Digital rot",      "WIRED",  "Pixelated chunks, palette loss"),
    ("label",  "System labels",    "WIRED",  "Scraps of system text over the frame"),
    # -- SHREDDER -----------------------------------------------------------
    ("shred",       "Shred amount",   "SHREDDER", "How much of the print has been fed through the shredder"),
    ("shred_w",     "Strip width",    "SHREDDER", "Width of the cut strips / confetti chips"),
    ("shred_chaos", "Misalignment",   "SHREDDER", "Strips fan out, twist and fall away"),
    # -- DIGITAL KILL -------------------------------------------------------
    ("sort",     "Pixel sort",       "DIGITAL KILL", "Streaks of pixels sorted by brightness"),
    ("melt",     "Melt / drip",      "DIGITAL KILL", "Pixels sag and run down the frame"),
    ("corrupt",  "Byte corruption",  "DIGITAL KILL", "Flipped bytes, chroma loss, deep-fried blocks"),
    ("dissolve", "Disintegration",   "DIGITAL KILL", "The image crumbles into drifting particles"),
    ("redact",   "Redact / wipe",    "DIGITAL KILL", "Black bars and a secure-erase pass"),
    # -- PRESENTATION -------------------------------------------------------
    ("tape",   "Tape",             "PRESENTATION", "Pieces of sticky tape that outlived the glue"),
    ("border", "White border",     "PRESENTATION", "Paper margins around the print"),
]

TINTS = [
    ("amber", "Amber"),
    ("red",   "Red"),
    ("cyan",  "Cyan"),
    ("mono",  "Silver"),
    ("none",  "No shift"),
]

CUTS = [
    ("strip", "Strip cut"),
    ("cross", "Cross cut"),
]

BACKDROPS = [
    ("none",  "Transparent PNG"),
    ("dark",  "Dark table"),
    ("paper", "Archive card"),
]

KEYS = [p[0] for p in PARAMS]


def blank():
    d = {k: 0 for k in KEYS}
    d["tint"] = "amber"
    d["backdrop"] = "none"
    d["cut"] = "strip"
    d["shred_w"] = 40
    d["shred_chaos"] = 45
    return d


def _p(tint="amber", backdrop="dark", cut="strip", **kw):
    d = blank()
    d.update(kw)
    d["tint"] = tint
    d["backdrop"] = backdrop
    d["cut"] = cut
    return d


PRESETS = {
    "Blank slate": _p(backdrop="none"),
    "Gentle age": _p(
        fade=35, grain=25, dust=25, crease=20, stain=15, tear=10, border=25,
        backdrop="paper"),
    "Forgotten album": _p(
        fade=68, grain=40, stain=48, crease=55, dust=40, corner=48, tear=28,
        tape=55, border=55, tint="amber", backdrop="dark"),
    "Basement, 1987": _p(
        fade=62, grain=55, stain=72, water=38, crack=58, peel=30, dust=62,
        mirror=45, tear=22, border=35, tint="red", backdrop="paper"),
    "Flooded archive": _p(
        fade=55, grain=30, stain=62, water=88, peel=55, dust=25, tear=38,
        crease=25, border=40, tint="cyan", backdrop="dark"),
    "Scorched": _p(
        fade=30, grain=38, burn=78, tear=30, crease=32, dust=32, bloom=20,
        stain=18, border=30, tint="red", backdrop="dark"),
    "Wired": _p(
        fade=22, grain=32, glitch=58, chroma=56, scan=62, ghost=58, bloom=58,
        rot=42, label=62, tint="cyan", backdrop="none"),
    "Erased memory": _p(
        fade=88, grain=30, peel=72, ghost=42, rot=28, dust=42, crack=30,
        corner=42, label=30, tint="mono", backdrop="dark"),
    "Total collapse": _p(
        fade=80, grain=55, stain=70, water=55, mirror=40, crease=75, crack=60,
        peel=60, dust=70, tear=60, corner=60, burn=45, glitch=40, chroma=40,
        scan=35, ghost=35, bloom=25, rot=30, label=40, tape=45, border=45,
        tint="amber", backdrop="dark"),
    # -- modes -------------------------------------------------------------
    "Shredder: strip cut": _p(
        shred=72, shred_w=34, shred_chaos=48, fade=38, grain=30, crease=22, dust=30,
        tear=12, border=40, tint="amber", backdrop="dark", cut="strip"),
    "Shredder: confetti": _p(
        shred=88, shred_w=30, shred_chaos=60, fade=30, grain=26, dust=22, border=38,
        tint="none", backdrop="dark", cut="cross"),
    "Digital kill": _p(
        sort=62, melt=44, corrupt=56, dissolve=38, redact=40, glitch=34, chroma=40,
        scan=42, rot=28, label=50, fade=15, grain=25, tint="cyan", backdrop="none"),
    "Secure erase": _p(
        redact=88, corrupt=30, scan=46, label=72, fade=20, grain=38, glitch=18,
        tint="mono", backdrop="none"),
    "Disintegration": _p(
        dissolve=55, melt=24, bloom=26, ghost=24, grain=22, fade=18,
        tint="none", backdrop="dark"),
}
