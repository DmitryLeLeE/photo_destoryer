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
    ("mosh",     "Datamosh",         "DIGITAL KILL", "Macroblocks drift and smear like a broken video stream"),
    ("jpeg",     "JPEG death",       "DIGITAL KILL", "Blocky compression, colour bleed, wrong-coloured tiles"),
    ("dead",     "Dead pixels",      "DIGITAL KILL", "Stuck lines, dead blocks, hot pixels"),
    ("crush",    "Bit crush",        "DIGITAL KILL", "The palette collapses to a few dithered colours"),
    # -- SHATTER ------------------------------------------------------------
    ("shatter",    "Shatter",         "SHATTER", "Glass-like shards slip apart along dark cracks"),
    ("shard_size", "Shard size",      "SHATTER", "Small chips or big slabs"),
    ("shard_gap",  "Missing shards",  "SHATTER", "Shards fall out and leave holes"),
    # -- FIRE ---------------------------------------------------------------
    ("fire",       "Fire",            "FIRE", "A burn front eats the print from the edges, ash behind it"),
    ("ember",      "Embers",          "FIRE", "Glow along the burn front"),
    ("soot",       "Soot & scorch",   "FIRE", "Browning and smoke ahead of the flames"),
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
    d["shard_size"] = 40
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
    # -- 1.1: digital destruction ------------------------------------------
    "Datamosh": _p(
        mosh=80, glitch=30, chroma=30, scan=24, jpeg=22, grain=18,
        tint="none", backdrop="none"),
    "JPEG death": _p(
        jpeg=90, crush=26, corrupt=30, chroma=24, grain=16,
        tint="none", backdrop="none"),
    "Dead sector": _p(
        dead=84, scan=40, glitch=36, corrupt=42, label=46, grain=24,
        tint="cyan", backdrop="none"),
    "Bit rot": _p(
        crush=72, rot=46, corrupt=56, jpeg=40, scan=30, grain=20,
        tint="none", backdrop="none"),
    "Signal lost": _p(
        glitch=66, chroma=72, scan=82, ghost=60, bloom=40, label=72, dead=20, grain=34,
        fade=14, tint="cyan", backdrop="none"),
    "Pixel storm": _p(
        sort=90, melt=56, mosh=30, chroma=30, grain=16,
        tint="none", backdrop="none"),
    "Server fire": _p(
        corrupt=62, mosh=52, melt=62, bloom=62, scan=30, glitch=26, grain=30,
        tint="red", backdrop="none"),
    "Deep fried": _p(
        corrupt=92, jpeg=78, crush=30, bloom=42, chroma=20, grain=20,
        tint="red", backdrop="none"),
    "Redacted file": _p(
        redact=96, label=82, crush=40, scan=34, grain=42, fade=24,
        tint="mono", backdrop="none"),
    "Ghost in the wire": _p(
        ghost=86, chroma=52, dissolve=26, scan=46, bloom=36, glitch=30, label=30,
        tint="cyan", backdrop="none"),
    "CRT death": _p(
        scan=92, bloom=56, chroma=46, dead=36, crush=36, rot=26, glitch=24,
        tint="cyan", backdrop="none"),
    "Memory leak": _p(
        dissolve=72, melt=56, rot=40, jpeg=30, ghost=36, bloom=20, grain=20,
        tint="none", backdrop="dark"),
    "Format C:": _p(
        sort=60, melt=50, mosh=62, corrupt=60, jpeg=60, dead=56, crush=42, redact=52,
        dissolve=46, glitch=40, chroma=40, scan=40, label=64,
        tint="cyan", backdrop="none"),
    # -- 1.1: aging ---------------------------------------------------------
    "Sun-bleached": _p(
        fade=92, bloom=34, grain=20, dust=18, crease=24, border=50, tape=20,
        tint="amber", backdrop="paper"),
    "Attic mold": _p(
        stain=88, water=32, fade=52, crack=38, peel=24, mirror=30, dust=40, tear=20,
        border=36, tint="red", backdrop="dark"),
    "Photocopy of a photocopy": _p(
        grain=88, crush=36, fade=34, scan=16, dust=30, crease=20, border=30,
        tint="mono", backdrop="paper"),
    "Polaroid left in a car": _p(
        fade=72, bloom=52, stain=22, crease=30, border=78, tape=35, corner=24,
        tint="red", backdrop="dark"),
    # -- 1.1: shredder ------------------------------------------------------
    "Shredder: fine strips": _p(
        shred=96, shred_w=14, shred_chaos=32, fade=30, grain=24, dust=20, border=36,
        tint="none", backdrop="dark", cut="strip"),
    "Shredder: jam": _p(
        shred=62, shred_w=58, shred_chaos=88, fade=34, grain=28, crease=30, dust=34,
        border=44, tint="amber", backdrop="dark", cut="strip"),
    "Shredder: classified": _p(
        shred=78, shred_w=30, shred_chaos=50, redact=56, label=60, crush=24, fade=20,
        grain=34, border=34, tint="mono", backdrop="dark", cut="cross"),
    # -- 1.1: shatter -------------------------------------------------------
    "Broken glass": _p(
        shatter=72, shard_size=42, shard_gap=8, crack=30, grain=22, fade=14,
        tint="none", backdrop="dark"),
    "Smashed screen": _p(
        shatter=86, shard_size=24, shard_gap=26, dead=44, chroma=34, scan=26, glitch=20,
        tint="cyan", backdrop="dark"),
    "Shattered mirror": _p(
        shatter=76, shard_size=58, shard_gap=14, mirror=55, fade=30, dust=26, stain=20,
        tint="mono", backdrop="dark"),
    "Falling apart": _p(
        shatter=92, shard_size=34, shard_gap=46, dissolve=30, crease=30, dust=34, tear=25,
        tint="amber", backdrop="dark"),
    # -- 1.1: fire ----------------------------------------------------------
    "Burning photo": _p(
        fire=55, ember=72, soot=52, burn=28, grain=24, fade=18,
        tint="red", backdrop="dark"),
    "Slow burn": _p(
        fire=34, ember=42, soot=64, burn=18, fade=34, grain=30, crease=24, border=40,
        tint="amber", backdrop="dark"),
    "Inferno": _p(
        fire=84, ember=88, soot=62, bloom=40, burn=50, grain=28,
        tint="red", backdrop="dark"),
    "Smoldering ash": _p(
        fire=76, ember=22, soot=92, dissolve=30, grain=42, fade=40,
        tint="mono", backdrop="dark"),
    # -- 1.1: obliterate (hard presets: what is left is the destroyed copy) -
    "Obliterate": _p(
        fire=66, ember=62, soot=70, shatter=70, shard_size=30, shard_gap=30, dissolve=68,
        burn=70, corrupt=60, sort=40, grain=36, tint="red", backdrop="dark"),
    "Ground zero": _p(
        fire=94, ember=90, soot=92, dissolve=62, bloom=62, burn=82, tear=70, corner=70,
        fade=62, grain=62, tint="amber", backdrop="dark"),
    "Ashes": _p(
        fire=80, ember=10, soot=40, dissolve=72, grain=52, fade=72, dust=40,
        tint="mono", backdrop="dark"),
    "Nothing left": _p(
        dissolve=100, fade=92, ghost=62, melt=72, rot=62, redact=62, corrupt=72, peel=92,
        grain=40, tint="mono", backdrop="dark"),
    "Evidence destroyed": _p(
        shred=92, shred_w=16, shred_chaos=72, fire=62, ember=46, soot=62, redact=72, label=52,
        crush=30, grain=34, tint="mono", backdrop="dark", cut="cross"),
    "Shattered and burned": _p(
        shatter=88, shard_size=46, shard_gap=42, fire=62, ember=52, soot=58, crack=70,
        burn=60, dust=40, tint="red", backdrop="dark"),
    "Dead file": _p(
        corrupt=100, jpeg=100, mosh=90, dead=90, crush=70, sort=80, melt=70, redact=70,
        dissolve=60, glitch=70, scan=60, rot=70, label=80, chroma=60,
        tint="cyan", backdrop="none"),
    "Memory hole": _p(
        dissolve=50, redact=96, fade=82, peel=82, ghost=52, dead=40, melt=40, grain=34,
        tint="mono", backdrop="dark"),
}

# which mode a preset belongs to (drives the preset gallery and the mode buttons)
PRESET_GROUPS = {
    "AGING": ["Blank slate", "Gentle age", "Forgotten album", "Basement, 1987", "Flooded archive",
              "Scorched", "Erased memory", "Total collapse", "Sun-bleached", "Attic mold",
              "Photocopy of a photocopy", "Polaroid left in a car"],
    "SHREDDER": ["Shredder: strip cut", "Shredder: confetti", "Shredder: fine strips",
                 "Shredder: jam", "Shredder: classified"],
    "SHATTER": ["Broken glass", "Smashed screen", "Shattered mirror", "Falling apart"],
    "FIRE": ["Burning photo", "Slow burn", "Inferno", "Smoldering ash"],
    "OBLITERATE": ["Obliterate", "Ground zero", "Ashes", "Nothing left", "Evidence destroyed",
                   "Shattered and burned", "Dead file", "Memory hole"],
    "DIGITAL KILL": ["Digital kill", "Datamosh", "JPEG death", "Dead sector", "Bit rot", "Signal lost",
                     "Pixel storm", "Server fire", "Deep fried", "Redacted file", "Secure erase",
                     "Ghost in the wire", "CRT death", "Memory leak", "Disintegration", "Wired",
                     "Format C:"],
}
