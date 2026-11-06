import asyncio, base64, subprocess, sys, time, json
from playwright.async_api import async_playwright
from PIL import Image
from skimage import data
import io

Image.fromarray(data.astronaut()).save('tests_out/astro.png')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', 'docs'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1360, 'height': 860})
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await pg.goto('http://localhost:8765/index.html')
        await pg.set_input_files('#file', 'tests_out/astro.png')
        await pg.wait_for_function("document.querySelector('#status').textContent.includes(' ms')", timeout=60000)
        print('status:', await pg.inner_text('#status'))
        await pg.screenshot(path='tests_out/web_ui.png')
        names = await pg.evaluate("Object.keys(PD_DATA.presets)")
        res = {}
        for n in names:
            t = time.time()
            r = await pg.evaluate("""async (n) => {
                const D = PD_DATA, p = Object.assign({}, D.presets[n]);
                const c = document.createElement('canvas'); const o = document.querySelector('#view');
                // re-read the source from the original canvas
                const src = document.createElement('canvas'); src.width = 512; src.height = 512;
                const img = new Image(); img.src = 'data:image/png;base64,' + window.__b64; await img.decode();
                const g = src.getContext('2d'); g.drawImage(img, 0, 0);
                const d = g.getImageData(0, 0, 512, 512);
                const t0 = performance.now();
                const r = PD.render({data: d.data, w: 512, h: 512}, p, 5, 100, 800);
                const out = document.createElement('canvas'); out.width = r.w; out.height = r.h;
                out.getContext('2d').putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
                return {png: out.toDataURL('image/png'), ms: performance.now() - t0, w: r.w, h: r.h};
            }""", n) if await pg.evaluate("!!window.__b64") else None
            if r is None:
                b64 = base64.b64encode(open('tests_out/astro.png', 'rb').read()).decode()
                await pg.evaluate("b => { window.__b64 = b; }", b64)
                r = await pg.evaluate("""async (n) => {
                    const D = PD_DATA, p = Object.assign({}, D.presets[n]);
                    const src = document.createElement('canvas'); src.width = 512; src.height = 512;
                    const img = new Image(); img.src = 'data:image/png;base64,' + window.__b64; await img.decode();
                    const g = src.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, 512, 512);
                    const t0 = performance.now(); const r = PD.render({data: d.data, w: 512, h: 512}, p, 5, 100, 800);
                    const out = document.createElement('canvas'); out.width = r.w; out.height = r.h;
                    out.getContext('2d').putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
                    return {png: out.toDataURL('image/png'), ms: performance.now() - t0, w: r.w, h: r.h};
                }""", n)
            open('tests_out/web_%s.png' % n.replace(' ', '_').replace(':', '').replace(',', ''), 'wb').write(base64.b64decode(r['png'].split(',')[1]))
            print('%-24s %dx%d  %d ms' % (n, r['w'], r['h'], r['ms']))
        print('console issues:', errs[:10])
        await b.close()
asyncio.run(main())
srv.terminate()
