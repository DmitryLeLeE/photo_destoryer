import asyncio, subprocess, sys, time, base64
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '-d', 'docs'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
JS = """async () => {
  const D = PD_DATA, fails = [], c = document.createElement('canvas'); let runs = 0, nan = 0;
  for (const [w, h] of [[97, 97], [301, 200], [640, 640], [900, 600], [450, 900]]) {
    c.width = w; c.height = h; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#c33'); gr.addColorStop(.5, '#4a8'); gr.addColorStop(1, '#235'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7); g.fill();
    const d = g.getImageData(0, 0, w, h);
    for (const name of Object.keys(D.presets)) for (const seed of [1, 2]) {
      try { const r = PD.render({ data: d.data, w, h }, D.presets[name], seed, 100, 900); runs++; if (!r.w || !r.h || r.data.length !== r.w * r.h * 4) fails.push('size ' + name); }
      catch (e) { fails.push(w + 'x' + h + ' ' + name + ' ' + seed + ' ' + e.message); }
    }
  }
  return { runs, fails: fails.slice(0, 8), nfail: fails.length };
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(); await pg.goto('http://localhost:8766/index.html')
        print(await pg.evaluate(JS)); await b.close()
asyncio.run(main()); srv.terminate()
