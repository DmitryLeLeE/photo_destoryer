import sys, time
sys.path.insert(0, '.')
from PIL import Image
from skimage import data
from destroyer import render, PRESETS
src = Image.fromarray(data.astronaut())
for name, pr in PRESETS.items():
    t = time.time()
    out = render(src, pr, seed=7, max_side=900)
    out.save('tests_out/%s.png' % name.replace(' ', '_').replace(',', ''))
    print(name, out.size, out.mode, round(time.time() - t, 2), 's')
