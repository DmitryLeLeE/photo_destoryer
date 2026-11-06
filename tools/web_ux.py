import asyncio, subprocess, sys, time
from playwright.async_api import async_playwright
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '-d', 'docs'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1360, 'height': 860})
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await pg.goto('http://localhost:8766/index.html')
        await pg.wait_for_function("document.querySelector('#status').textContent.includes(' ms')", timeout=60000)
        print('status:', await pg.inner_text('#status'))
        await pg.screenshot(path='tests_out/ux_first_screen.png')
        # shortcuts
        await pg.keyboard.press('2'); await pg.wait_for_timeout(1500)
        print('mode on:', await pg.evaluate("document.querySelector('#modes .on').textContent"))
        await pg.keyboard.press('r'); await pg.wait_for_timeout(1500)
        print('seed after R:', await pg.inner_text('#seedv'))
        # dblclick reset
        await pg.keyboard.press('1'); await pg.wait_for_timeout(800)
        sl = pg.locator('.sl input').nth(1)
        await sl.evaluate("e => { e.value = 90; e.dispatchEvent(new Event('input')); }")
        await pg.locator('.sl').nth(1).dblclick()
        print('after dblclick:', await sl.input_value())
        # compare hold
        box = await pg.locator('#view').bounding_box()
        await pg.mouse.move(box['x'] + 50, box['y'] + 50); await pg.mouse.down()
        print('badge while holding:', await pg.evaluate("getComputedStyle(document.querySelector('#badge')).display"))
        await pg.mouse.up()
        print('badge after:', await pg.evaluate("getComputedStyle(document.querySelector('#badge')).display"))
        # link roundtrip
        link = await pg.evaluate("(() => { const s = btoa(JSON.stringify({p:{fade:77,crease:55},t:'red',b:'dark',c:'strip',s:4242,m:120})); return '#s=' + s; })()")
        pg2 = await b.new_page(viewport={'width': 1360, 'height': 860})
        pg2.on('pageerror', lambda e: errs.append('PAGEERROR2 ' + str(e)))
        await pg2.goto('http://localhost:8766/index.html' + link)
        await pg2.wait_for_function("document.querySelector('#status').textContent.includes(' ms')", timeout=60000)
        print('link -> seed', await pg2.inner_text('#seedv'), 'master', await pg2.evaluate("document.querySelector('.sl input').value"))
        # mobile
        pm = await b.new_page(viewport={'width': 390, 'height': 800})
        await pm.goto('http://localhost:8766/index.html')
        await pm.wait_for_function("document.querySelector('#status').textContent.includes(' ms')", timeout=60000)
        await pm.screenshot(path='tests_out/ux_mobile.png')
        print('console issues:', errs)
        await b.close()
asyncio.run(main()); srv.terminate()
