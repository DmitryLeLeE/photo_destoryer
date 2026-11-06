import sys, time
sys.path.insert(0, '.')
from PIL import Image
from skimage import data
from destroyer import render, PRESETS
src = Image.fromarray(data.astronaut())
names = ["Shredder: strip cut", "Shredder: confetti", "Digital kill", "Secure erase", "Disintegration"]
tiles = []
for n in names:
    t = time.time()
    out = render(src, PRESETS[n], seed=5, max_side=800)
    print(n, out.size, out.mode, round(time.time() - t, 2), 's')
    im = out.convert("RGBA"); bg = Image.new("RGBA", im.size, (60, 60, 60, 255)); bg.alpha_composite(im)
    bg = bg.convert("RGB"); bg.thumbnail((640, 640)); tiles.append(bg)
W = 640
sheet = Image.new("RGB", (W * 3, W * 2), (25, 25, 25))
for i, t in enumerate(tiles): sheet.paste(t, ((i % 3) * W, (i // 3) * W))
sheet.save("tests_out/sheet_modes.jpg", quality=88)
