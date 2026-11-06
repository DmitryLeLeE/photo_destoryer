# PHOTO DESTROYER 1.0

Turn any photo into an old, broken, shredded or digitally destroyed one, and make the ruin look like art.

**Try it in the browser, nothing is uploaded:** https://dmitrylelee.github.io/photo_destoryer/

## What's inside

- **AGING**: uneven dye fade, grain, water rings, mould and foxing, silvering, creases with white cracks, craquelure, peeling emulsion, dust, torn edges, ripped corners, burns, tape, borders, a table underneath.
- **SHREDDER**: the print is half way through a paper shredder. Strip cut or confetti, fanned and twisted strips, cut-off ends piling up below.
- **DIGITAL KILL**: pixel sorting, melting pixels, flipped bytes, disintegration into particles, redaction bars, secure erase. Plus the **WIRED** group (glitch, channel split, VHS scan, ghost layer, bloom, digital rot, system labels) for the lain-style "signal is dying" look.
- **Decay stages**: export the same photo at N steps of destruction as PNG frames, a GIF and a contact strip.
- 14 presets, a seed for every ruin (same photo + same seed = same destruction), a *Total decay* master slider.

## Downloads

- **PhotoDestroyer-windows.zip**: portable Windows build (unzip, run `PhotoDestroyer.exe`). Attached by GitHub Actions a few minutes after this release appears.
- **Web**: no download, open the link above.
- **Python / command line**: `pip install -r requirements.txt`, then `python app.py` or `python cli.py photo.jpg -p "Forgotten album"`.

## Controls

Hold **SPACE** (or press and hold the picture) to see the original. **R** new seed, **G / Randomize**, **1 / 2 / 3** switch mode, double-click a slider to reset it. The web version can copy a link with your exact settings.

## Notes

- Everything runs locally on pure numpy + Pillow, no OpenCV or scipy.
- The Windows build is not code-signed, so SmartScreen may warn on first launch ("More info" > "Run anyway").
- Sample photo: NASA astronaut portrait, public domain.
