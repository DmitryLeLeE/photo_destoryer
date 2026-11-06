"""Responsive + functional check of the web app on emulated devices (Chrome via playwright)."""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

DEVICES = [  # name, w, h, mobile/touch, dpr
    ("phone_se_320x568", 320, 568, True, 2),
    ("phone_390x844", 390, 844, True, 3),
    ("phone_pixel_412x915", 412, 915, True, 2.6),
    ("phone_landscape_844x390", 844, 390, True, 3),
    ("tablet_768x1024", 768, 1024, True, 2),
    ("tablet_landscape_1024x768", 1024, 768, True, 2),
    ("laptop_1366x768", 1366, 768, False, 1),
    ("desktop_1920x1080", 1920, 1080, False, 1),
    ("desktop_2560x1440", 2560, 1440, False, 1),
]
os.makedirs("tests_out", exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "-d", "docs"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
bad = 0

async def check(b, name, w, h, touch, dpr):
    global bad
    ctx = await b.new_context(viewport={"width": w, "height": h}, is_mobile=touch, has_touch=touch, device_scale_factor=dpr)
    pg = await ctx.new_page(); errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    await pg.goto("http://localhost:8766/index.html")
    await pg.wait_for_function("document.querySelector('#status').textContent.includes(' ms')", timeout=90000)
    await pg.wait_for_function("document.querySelectorAll('#strip .pv.ready').length >= 6" if not (w > h and h < 540) else 'true', timeout=90000)
    issues = []
    iw = await pg.evaluate("window.innerWidth")
    if iw > w + 1: issues.append(f"page is wider than the screen: layout viewport {iw}px on a {w}px device (mobile browsers would zoom out)")
    ov = await pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    if ov > 1: issues.append(f"horizontal overflow {ov}px")
    # nothing sticks out of the viewport horizontally
    out = await pg.evaluate("""() => [...document.querySelectorAll('.machine *, .hero *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 2) && !e.closest('#strip') && !e.closest('.marquee') && getComputedStyle(e).position !== 'fixed' }).slice(0, 4).map(e => e.tagName + '#' + e.id + '.' + e.className)""")
    if out: issues.append("sticks out: " + ", ".join(out))
    st = await pg.locator("#stage").bounding_box()
    if st["width"] < 200 or st["height"] < 150: issues.append(f"stage too small {st}")
    if touch:
        small = await pg.evaluate("""() => [...document.querySelectorAll('.machine button:not(.pv), .machine select')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < 36 && e.offsetParent }).map(e => (e.id || e.textContent).slice(0, 16) + ':' + Math.round(e.getBoundingClientRect().height))""")
        if small: issues.append("small tap targets: " + ", ".join(small[:6]))
    # functional: modes, thumbs, presets, undo
    await pg.locator("#modes button[data-mode=digital]").click(); await pg.wait_for_timeout(300)
    if await pg.get_attribute(".machine", "data-mode") != "digital": issues.append("mode switch failed")
    n_pv = await pg.locator("#strip .pv").count()
    if n_pv < 15 and h >= 540 or n_pv < 15 and w <= h: issues.append(f"digital strip has {n_pv} presets")
    if await pg.locator("#stripwrap").is_visible():
        await pg.locator('#strip .pv[data-preset="Datamosh"]').scroll_into_view_if_needed()
        await pg.locator('#strip .pv[data-preset="Datamosh"]').click()
    else:
        await pg.evaluate("PD_APP.applyPreset('Datamosh')")
    await pg.wait_for_function("document.querySelector('#status').textContent.includes(' ms')")
    await pg.wait_for_timeout(500)
    if await pg.evaluate("PD_APP.state.preset") != "Datamosh": issues.append("preset click failed")
    mosh = await pg.evaluate("PD_APP.state.params.mosh")
    if mosh < 50: issues.append(f"mosh={mosh}")
    await pg.locator("#btnUndo").click(); await pg.wait_for_timeout(400)
    if await pg.evaluate("PD_APP.state.preset") == "Datamosh": issues.append("undo did nothing")
    await pg.locator("#btnRedo").click(); await pg.wait_for_timeout(400)
    if await pg.evaluate("PD_APP.state.preset") != "Datamosh": issues.append("redo failed")
    # every mode loads its default preset and renders without errors
    for m in ("aging", "shred", "digital", "shatter", "fire", "total"):
        await pg.evaluate(f"document.querySelector('#modes button[data-mode={m}]').click()")
        await pg.wait_for_function("!document.querySelector('#busy') || getComputedStyle(document.querySelector('#busy')).display === 'none'", timeout=60000)
        await pg.wait_for_timeout(250)
        if await pg.get_attribute(".machine", "data-mode") != m: issues.append("mode " + m + " not applied")
        if await pg.locator("#strip .pv").count() < 4: issues.append("mode " + m + " has no presets")
    # accordion: collapse + expand a group
    g = pg.locator('.grp[data-group="DIGITAL KILL"] .sec'); await g.scroll_into_view_if_needed(); await g.click()
    closed = await pg.evaluate("document.querySelector('.grp[data-group=\"DIGITAL KILL\"]').classList.contains('closed')"); await g.click()
    if not closed: issues.append("accordion collapse failed")
    # hold to compare via touch / mouse
    box = await pg.locator("#view").bounding_box()
    await pg.evaluate("window.scrollTo(0, 0)")
    await pg.screenshot(path=f"tests_out/dev_{name}.png", full_page=False)
    if touch and h > w:  # a tall page shot to review the whole flow
        await pg.screenshot(path=f"tests_out/dev_{name}_full.png", full_page=True)
    # sticky preview on phones: after scrolling the page the stage stays visible
    if touch and w <= 900 and not (w > h):
        await pg.evaluate("window.scrollTo(0, document.querySelector('aside').offsetTop + 300)"); await pg.wait_for_timeout(300)
        sb = await pg.locator("#stage").bounding_box()
        if not (sb["y"] >= -2 and sb["y"] < 40): issues.append(f"stage not sticky (y={sb['y']:.0f})")
        await pg.screenshot(path=f"tests_out/dev_{name}_scrolled.png")
    if errs: issues.append("console: " + "; ".join(errs[:3]))
    print(("OK   " if not issues else "FAIL ") + name, "|", "; ".join(issues) if issues else "")
    bad += bool(issues)
    await ctx.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for d in DEVICES:
            try: await check(b, *d)
            except Exception as e: print("ERR  ", d[0], repr(e)[:300]); globals()["bad"] += 1
        await b.close()
asyncio.run(main()); srv.terminate()
print("failures:", bad); sys.exit(1 if bad else 0)
