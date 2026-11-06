# Changelog

## 1.1.0

**Three new modes** (6 in total): **SHATTER** (glass shards), **FIRE** (burn front with embers, soot and ash), **OBLITERATE** (hard presets that leave only the destroyed copy). New effects: shatter, fire; new sliders: shard size, missing shards, embers, soot. 50 presets in total.

**Digital destruction**
- 4 new effects in DIGITAL KILL: **Datamosh**, **JPEG death**, **Dead pixels**, **Bit crush** (Python and JS engines).
- 35 new presets (50 total), among them 8 OBLITERATE, 4 SHATTER, 4 FIRE,: 13 digital (Datamosh, JPEG death, Dead sector, Bit rot, Signal lost, Pixel storm, Server fire, Deep fried, Redacted file, Ghost in the wire, CRT death, Memory leak, Format C:), 4 aging (Sun-bleached, Attic mold, Photocopy of a photocopy, Polaroid left in a car), 3 shredder (fine strips, jam, classified).
- Presets are grouped by mode (`PRESET_GROUPS`); web and desktop show six modes, keys `1`-`6`.

**Web UI**
- Preset filmstrip under the preview with live thumbnails of *your* photo.
- Each mode has its own accent colour; digital mode adds a CRT scanline overlay.
- Collapsible slider groups with a count of active sliders, undo/redo, PNG/JPEG/WebP export, sample button, `[` `]` to flip through presets.
- Phones and tablets: the preview is pinned while you scroll the sliders, bigger touch targets, landscape-phone layout, tighter hero on short laptop screens, wider layout on 4K.
- `tools/web_devices.py` checks 9 emulated devices (overflow, tap targets, sticky preview, mode/preset/undo flows, console errors).

**Desktop**
- New sliders and presets (grouped by mode), version in the window title.

## 1.0.0
- First release: aging, shredder and digital kill modes, desktop + web + CLI, decay stages export.
