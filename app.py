#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PHOTO DESTROYER - desktop app (Tkinter).

Open a photo, pick a preset, drag the sliders. Hold SPACE to peek at the original.
"""
import os
import queue
import random
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk

from destroyer import render, load_image, PARAMS, PRESETS, TINTS, BACKDROPS, CUTS, blank
from destroyer.stages import export_stages

APP = "PHOTO DESTROYER"


def resource(name):
    """Path to a bundled file (works from source and from a PyInstaller build)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


BG, PANEL, FG, DIM, ACC, LINE = "#0d0d0d", "#141414", "#cfcac0", "#6f6a62", "#d6482b", "#2a2a2a"
PAPER, INK = "#e8e3d4", "#0d0d0d"
FONT = ("Consolas", 9)
FONT_B = ("Consolas", 9, "bold")
PREVIEW_SIDE = 900
EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")
MODES = [("AGING", "Forgotten album", "TIME"),
         ("SHREDDER", "Shredder: strip cut", "SHREDDER"),
         ("DIGITAL KILL", "Digital kill", "DIGITAL KILL")]
EXPORT_SIZES = {"1600 px": 1600, "2400 px": 2400, "3600 px": 3600, "Original": None}


def checker(w, h, a=(52, 52, 52), b=(40, 40, 40), s=14):
    im = Image.new("RGB", (w, h), a)
    px = Image.new("RGB", (s, s), b)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2:
                im.paste(px, (x, y))
    return im


class App:
    def __init__(self, root, path=None):
        self.root = root
        root.title(APP)
        root.configure(bg=BG)
        try:
            if sys.platform.startswith("win"):
                root.iconbitmap(resource("icon.ico"))
            else:
                self._icon = ImageTk.PhotoImage(Image.open(resource("icon.png")))
                root.iconphoto(True, self._icon)
        except Exception:
            pass  # a missing icon must never stop the app
        root.geometry("1280x820")
        root.minsize(980, 640)

        self.src = None            # full-size PIL image
        self.preview_src = None    # downscaled copy for live preview
        self.path = None
        self.result = None
        self.photo = None
        self.show_original = False
        self.busy = False
        self.dirty = False
        self._after = None
        self._loading = False
        self.q = queue.Queue()
        self.job_q = queue.Queue()
        self.working = False       # a background export is running

        self.vars = {k: tk.IntVar(value=0) for k, *_ in PARAMS}
        self.tint = tk.StringVar(value="amber")
        self.backdrop = tk.StringVar(value="none")
        self.cut = tk.StringVar(value="strip")
        self.sections = {}
        self.master = tk.IntVar(value=100)
        self.seed = tk.IntVar(value=1)
        self.preset = tk.StringVar(value="Forgotten album")
        self.export_size = tk.StringVar(value="2400 px")
        self.status = tk.StringVar(value="Open a photo to begin  (Ctrl+O)")

        self._style()
        self._build()
        self._bind()
        self.apply_preset("Forgotten album", request=False)
        self.root.after(40, self._poll)
        if path:
            self.load(path)

    # ───────────────────────── look ─────────────────────────
    def _style(self):
        st = ttk.Style()
        try:
            st.theme_use("clam")
        except tk.TclError:
            pass
        st.configure(".", background=PANEL, foreground=FG, font=FONT, bordercolor=LINE,
                     lightcolor=PANEL, darkcolor=PANEL, troughcolor=BG)
        st.configure("TCombobox", fieldbackground=BG, background=BG, foreground=FG,
                     arrowcolor=ACC, selectbackground=BG, selectforeground=FG)
        st.map("TCombobox", fieldbackground=[("readonly", BG)], foreground=[("readonly", FG)])
        st.configure("Horizontal.TProgressbar", background=ACC, troughcolor=BG, bordercolor=BG,
                     lightcolor=ACC, darkcolor=ACC)
        self.root.option_add("*TCombobox*Listbox.background", BG)
        self.root.option_add("*TCombobox*Listbox.foreground", FG)
        self.root.option_add("*TCombobox*Listbox.selectBackground", ACC)

    def _btn(self, parent, text, cmd, accent=False, width=None):
        b = tk.Button(parent, text=text, command=cmd, font=FONT_B, relief="flat", bd=0,
                      bg=ACC if accent else "#1d1d1d", fg="#0d0d0d" if accent else FG,
                      activebackground="#f06a4a" if accent else "#2a2a2a",
                      activeforeground="#0d0d0d" if accent else FG,
                      padx=10, pady=6, cursor="hand2", width=width)
        return b

    def _zbtn(self, parent, text, cmd, hot=False):
        """Flat zine sticker button: ink outline on paper, rust when `hot`."""
        return tk.Button(parent, text=text, command=cmd, font=("Consolas", 9, "bold"), relief="flat", bd=0,
                         bg=ACC if hot else PAPER, fg=INK, activebackground="#f06a4a" if hot else "#d6d0bf",
                         activeforeground=INK, highlightthickness=2, highlightbackground=INK,
                         highlightcolor=INK, padx=10, pady=5, cursor="hand2")

    def _cutout_title(self, parent):
        """PHOTO DESTROYER as ransom-note letters: every letter its own scrap of paper."""
        styles = [
            (INK, PAPER, ("Impact", 20)),
            (PAPER, INK, ("Courier New", 18, "bold")),
            (ACC, INK, ("Impact", 20)),
            (PAPER, INK, ("Georgia", 18, "bold italic")),
            (INK, ACC, ("Courier New", 18, "bold")),
            ("#cfc9b6", INK, ("Arial Black", 17)),
        ]
        rnd = random.Random(11)
        row = tk.Frame(parent, bg=PAPER)
        for ch in "PHOTO DESTROYER":
            if ch == " ":
                tk.Frame(row, bg=PAPER, width=14).pack(side="left")
                continue
            bg, fg, font = styles[rnd.randrange(len(styles))]
            lab = tk.Label(row, text=ch, bg=bg, fg=fg, font=font, padx=3, pady=0,
                           highlightthickness=2 if bg == PAPER else 0, highlightbackground=INK)
            lab.pack(side="left", padx=1, pady=(rnd.randint(0, 8), rnd.randint(0, 8)))
        return row

    # ───────────────────────── layout ─────────────────────────
    def _build(self):
        self.root.configure(bg=PAPER)
        top = tk.Frame(self.root, bg=PAPER)
        top.pack(side="top", fill="x", padx=14, pady=(12, 8))
        title = tk.Frame(top, bg=PAPER)
        title.pack(side="left")
        self._cutout_title(title).pack(side="top", anchor="w")
        tags = tk.Frame(title, bg=PAPER)
        tags.pack(side="top", anchor="w", pady=(4, 0))
        tk.Label(tags, text=" ISSUE 01 ", bg=INK, fg=PAPER, font=("Consolas", 8, "bold")).pack(side="left", padx=(0, 6))
        tk.Label(tags, text=" TURN THE PAST INTO RUINS ", bg=ACC, fg=INK, font=("Consolas", 8, "bold")).pack(side="left")
        bar = tk.Frame(top, bg=PAPER)
        bar.pack(side="right", anchor="s")
        self._zbtn(bar, "Open  Ctrl+O", self.open_dialog).pack(side="left", padx=4)
        self._zbtn(bar, "Batch folder", self.batch_dialog).pack(side="left", padx=4)
        self._zbtn(bar, "Decay stages", self.stages_dialog).pack(side="left", padx=4)
        self._zbtn(bar, "Save PNG  Ctrl+S", self.save_dialog, hot=True).pack(side="left", padx=4)

        # the machine: dark panel with a hard rust shadow, like on the web page
        outer = tk.Frame(self.root, bg=PAPER)
        outer.pack(side="top", fill="both", expand=True, padx=(14, 14), pady=(0, 14))
        tk.Frame(outer, bg=ACC).place(x=9, y=9, relwidth=1, relheight=1)
        machine = tk.Frame(outer, bg=BG, highlightthickness=3, highlightbackground=INK, highlightcolor=INK)
        machine.pack(fill="both", expand=True, padx=(0, 9), pady=(0, 9))
        mbar = tk.Frame(machine, bg=INK)
        mbar.pack(side="top", fill="x")
        tk.Label(mbar, text="THE MACHINE", bg=INK, fg=ACC, font=("Consolas", 9, "bold")).pack(side="left", padx=10, pady=5)
        tk.Label(mbar, text="//  hold SPACE to see the original", bg=INK, fg=DIM, font=FONT).pack(side="left")

        body = tk.Frame(machine, bg=BG)
        body.pack(side="top", fill="both", expand=True, padx=10, pady=(10, 0))

        # preview
        left = tk.Frame(body, bg=PANEL, highlightthickness=1, highlightbackground=LINE)
        left.pack(side="left", fill="both", expand=True)
        self.canvas = tk.Canvas(left, bg="#101010", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<Configure>", lambda e: self.redraw())
        # press and hold the picture = see the original (same as SPACE)
        self.canvas.bind("<ButtonPress-1>", self._canvas_press)
        self.canvas.bind("<ButtonRelease-1>", self._orig_off)

        # controls
        right = tk.Frame(body, bg=PANEL, width=330, highlightthickness=1, highlightbackground=LINE)
        right.pack(side="right", fill="y", padx=(10, 0))
        right.pack_propagate(False)

        head = tk.Frame(right, bg=PANEL)
        head.pack(fill="x", padx=12, pady=(12, 4))
        self._label(head, "MODE").pack(anchor="w")
        mrow = tk.Frame(head, bg=PANEL)
        mrow.pack(fill="x", pady=(2, 8))
        for i, (title, preset, group) in enumerate(MODES):
            self._btn(mrow, title, lambda p=preset, g=group: self.set_mode(p, g)).pack(
                side="left", fill="x", expand=True, padx=(0 if i == 0 else 3, 0))
        self._label(head, "PRESET").pack(anchor="w")
        cb = ttk.Combobox(head, textvariable=self.preset, values=list(PRESETS), state="readonly", font=FONT)
        cb.pack(fill="x", pady=(2, 8))
        cb.bind("<<ComboboxSelected>>", lambda e: self.apply_preset(self.preset.get()))

        row = tk.Frame(head, bg=PANEL)
        row.pack(fill="x")
        self._btn(row, "Randomize  G", self.randomize).pack(side="left", fill="x", expand=True, padx=(0, 3))
        self._btn(row, "Re-roll seed  R", self.reroll).pack(side="left", fill="x", expand=True, padx=(3, 0))

        sr = tk.Frame(head, bg=PANEL)
        sr.pack(fill="x", pady=(8, 0))
        self._label(sr, "SEED").pack(side="left")
        tk.Label(sr, textvariable=self.seed, bg=PANEL, fg=FG, font=FONT_B).pack(side="left", padx=8)
        self._label(sr, "EXPORT").pack(side="right", padx=(0, 0))
        ttk.Combobox(sr, textvariable=self.export_size, values=list(EXPORT_SIZES), state="readonly",
                     width=9, font=FONT).pack(side="right", padx=6)

        # scrolling slider list
        wrap = tk.Frame(right, bg=PANEL)
        wrap.pack(fill="both", expand=True, pady=(6, 0))
        self.sc = tk.Canvas(wrap, bg=PANEL, highlightthickness=0)
        sb = tk.Scrollbar(wrap, orient="vertical", command=self.sc.yview, bg=PANEL, troughcolor=BG, bd=0)
        self.sc.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.sc.pack(side="left", fill="both", expand=True)
        inner = tk.Frame(self.sc, bg=PANEL)
        self.inner = inner
        win = self.sc.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda e: self.sc.configure(scrollregion=self.sc.bbox("all")))
        self.sc.bind("<Configure>", lambda e: self.sc.itemconfigure(win, width=e.width))
        self.sc.bind("<Enter>", lambda e: self._wheel(True))
        self.sc.bind("<Leave>", lambda e: self._wheel(False))

        self._section(inner, "OVERALL")
        self._slider(inner, "Total decay", self.master, 0, 200, suffix="%")

        opt = tk.Frame(inner, bg=PANEL)
        opt.pack(fill="x", padx=12, pady=(6, 2))
        self._label(opt, "FADE TINT").grid(row=0, column=0, sticky="w")
        self._label(opt, "BACKDROP").grid(row=0, column=1, sticky="w", padx=(10, 0))
        t = ttk.Combobox(opt, state="readonly", font=FONT, width=13, values=[n for _, n in TINTS])
        t.grid(row=1, column=0, sticky="we")
        b = ttk.Combobox(opt, state="readonly", font=FONT, width=15, values=[n for _, n in BACKDROPS])
        b.grid(row=1, column=1, sticky="we", padx=(10, 0))
        opt.columnconfigure(0, weight=1)
        opt.columnconfigure(1, weight=1)
        self.tint_cb, self.bd_cb = t, b
        t.bind("<<ComboboxSelected>>", lambda e: self._combo_set(self.tint, TINTS, t))
        b.bind("<<ComboboxSelected>>", lambda e: self._combo_set(self.backdrop, BACKDROPS, b))

        group = None
        for key, label, grp, tip in PARAMS:
            if grp != group:
                self._section(inner, grp)
                group = grp
                if grp == "SHREDDER":
                    cf = tk.Frame(inner, bg=PANEL)
                    cf.pack(fill="x", padx=12, pady=(4, 2))
                    self._label(cf, "CUT TYPE").pack(anchor="w")
                    c = ttk.Combobox(cf, state="readonly", font=FONT, values=[n for _, n in CUTS])
                    c.pack(fill="x")
                    c.bind("<<ComboboxSelected>>", lambda e: self._combo_set(self.cut, CUTS, c))
                    self.cut_cb = c
            self._slider(inner, label, self.vars[key], 0, 100, tip=tip)
        tk.Frame(inner, bg=PANEL, height=14).pack()

        # status bar
        bot = tk.Frame(machine, bg=BG)
        bot.pack(side="bottom", fill="x", padx=10, pady=(6, 8))
        tk.Label(bot, textvariable=self.status, bg=BG, fg=DIM, font=FONT, anchor="w").pack(side="left", fill="x", expand=True)
        self.bar = ttk.Progressbar(bot, length=200, mode="determinate", style="Horizontal.TProgressbar")
        self.bar.pack(side="right")

    def _label(self, parent, text):
        return tk.Label(parent, text=text, bg=PANEL, fg=DIM, font=("Consolas", 8, "bold"))

    def _section(self, parent, text):
        f = tk.Frame(parent, bg=PANEL)
        self.sections[text] = f
        f.pack(fill="x", padx=12, pady=(14, 2))
        tk.Label(f, text=text, bg=PANEL, fg=ACC, font=("Consolas", 8, "bold")).pack(side="left")
        tk.Frame(f, bg=LINE, height=1).pack(side="left", fill="x", expand=True, padx=(8, 0), pady=1)

    def _slider(self, parent, label, var, lo, hi, tip=None, suffix=""):
        f = tk.Frame(parent, bg=PANEL)
        f.pack(fill="x", padx=12, pady=1)
        lab = tk.Label(f, text=label, bg=PANEL, fg=FG, font=FONT, anchor="w")
        lab.pack(side="left")
        val = tk.Label(f, text=str(var.get()) + suffix, bg=PANEL, fg=DIM, font=FONT, width=5, anchor="e")
        val.pack(side="right")
        s = tk.Scale(parent, from_=lo, to=hi, orient="horizontal", variable=var, showvalue=False,
                     bg=PANEL, fg=FG, troughcolor="#222", activebackground=ACC, highlightthickness=0,
                     bd=0, sliderrelief="flat", sliderlength=14, width=8, length=280)
        s.pack(fill="x", padx=12)
        var.trace_add("write", lambda *a: val.config(text=str(var.get()) + suffix))
        var.trace_add("write", lambda *a: self.request())
        # sliders at zero look dim, so the active damage is visible at a glance
        var.trace_add("write", lambda *a: lab.config(fg=FG if var.get() else DIM))
        lab.config(fg=FG if var.get() else DIM)
        s.bind("<Double-Button-1>", lambda e, v=var: self._reset_var(v))
        if tip:
            for w in (f, s):
                w.bind("<Enter>", lambda e, t=tip: self.status.set(t))

    def _reset_var(self, var):
        """Double-click a slider: back to the value the current preset gave it."""
        for k, v in self.vars.items():
            if v is var:
                var.set(int(getattr(self, "preset_vals", {}).get(k, 0)))
                return
        if var is self.master:
            var.set(100)

    def _wheel(self, on):
        if on:
            self.root.bind_all("<MouseWheel>", lambda e: self.sc.yview_scroll(-1 if e.delta > 0 else 1, "units"))
            self.root.bind_all("<Button-4>", lambda e: self.sc.yview_scroll(-1, "units"))
            self.root.bind_all("<Button-5>", lambda e: self.sc.yview_scroll(1, "units"))
        else:
            for ev in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
                self.root.unbind_all(ev)

    def _bind(self):
        r = self.root
        r.bind("<Control-o>", lambda e: self.open_dialog())
        r.bind("<Control-s>", lambda e: self.save_dialog())
        r.bind("<KeyPress-space>", self._orig_on)
        r.bind("<KeyRelease-space>", self._orig_off)
        r.bind("<KeyPress-r>", lambda e: self.reroll() if not isinstance(e.widget, ttk.Combobox) else None)
        r.bind("<KeyPress-g>", lambda e: self.randomize() if not isinstance(e.widget, ttk.Combobox) else None)
        for i, (preset, group) in enumerate((("Forgotten album", "TIME"), ("Shredder: strip cut", "SHREDDER"),
                                              ("Digital kill", "DIGITAL KILL")), 1):
            r.bind("<KeyPress-%d>" % i, lambda e, p=preset, g=group:
                   self.set_mode(p, g) if not isinstance(e.widget, ttk.Combobox) else None)

    # ───────────────────────── state helpers ─────────────────────────
    def _combo_set(self, var, table, cb):
        names = [n for _, n in table]
        var.set(table[names.index(cb.get())][0])
        self.request()

    def _sync_combos(self):
        self.tint_cb.set(dict(TINTS)[self.tint.get()])
        self.bd_cb.set(dict(BACKDROPS)[self.backdrop.get()])
        self.cut_cb.set(dict(CUTS)[self.cut.get()])

    def snapshot(self):
        d = {k: v.get() for k, v in self.vars.items()}
        d["tint"] = self.tint.get()
        d["backdrop"] = self.backdrop.get()
        d["cut"] = self.cut.get()
        return d

    def apply_preset(self, name, request=True):
        p = PRESETS[name]
        self._loading = True
        for k, v in self.vars.items():
            v.set(int(p.get(k, 0)))
        self.tint.set(p["tint"])
        self.backdrop.set(p["backdrop"])
        self.cut.set(p.get("cut", "strip"))
        self.master.set(100)
        for k in ("shred_w", "shred_chaos"):
            self.vars[k].set(int(p.get(k, 0)))
        self.preset_vals = {k: int(p.get(k, 0)) for k in self.vars}
        self._loading = False
        self._sync_combos()
        if request:
            self.request()

    def randomize(self):
        self._loading = True
        for v in self.vars.values():
            v.set(0)
        keys = list(self.vars)
        for k in random.sample([k for k in keys if k not in ("shred_w", "shred_chaos")], random.randint(6, 11)):
            self.vars[k].set(random.randint(25, 95))
        self.tint.set(random.choice([t for t, _ in TINTS]))
        self.backdrop.set(random.choice(["dark", "paper", "none"]))
        self.cut.set(random.choice(["strip", "cross"]))
        self.vars["shred_w"].set(random.randint(20, 60))
        self.vars["shred_chaos"].set(random.randint(20, 80))
        self.seed.set(random.randint(1, 99999))
        self._loading = False
        self._sync_combos()
        self.preset.set("")
        self.request()

    def set_mode(self, preset, group):
        self.preset.set(preset)
        self.apply_preset(preset)
        self.root.update_idletasks()
        total = max(1, self.inner.winfo_height())
        self.sc.yview_moveto(max(0.0, (self.sections[group].winfo_y() - 6) / total))

    def reroll(self):
        self.seed.set(random.randint(1, 99999))
        self.request()

    # ───────────────────────── loading ─────────────────────────
    def open_dialog(self):
        p = filedialog.askopenfilename(title="Open photo", filetypes=[("Images", "*.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"), ("All files", "*.*")])
        if p:
            self.load(p)

    def load(self, path):
        try:
            im = load_image(path)
        except Exception as e:
            messagebox.showerror(APP, "Cannot open this file:\n%s" % e)
            return
        self.src, self.path = im, path
        pv = im.copy()
        pv.thumbnail((PREVIEW_SIDE * 2, PREVIEW_SIDE * 2))
        self.preview_src = pv
        self.status.set("%s  -  %dx%d" % (os.path.basename(path), im.width, im.height))
        self.request()

    # ───────────────────────── live render ─────────────────────────
    def request(self):
        if self._loading or self.preview_src is None:
            return
        if self._after:
            self.root.after_cancel(self._after)
        self._after = self.root.after(90, self._start)

    def _start(self):
        self._after = None
        if self.busy:
            self.dirty = True
            return
        self.busy, self.dirty = True, False
        params, seed, master, src = self.snapshot(), self.seed.get(), self.master.get(), self.preview_src

        def work():
            try:
                out = render(src, params, seed, master, PREVIEW_SIDE)
            except Exception as e:  # shown in the status bar
                out = e
            self.q.put(("preview", out))
        threading.Thread(target=work, daemon=True).start()

    def _poll(self):
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "preview":
                    self.busy = False
                    if isinstance(payload, Exception):
                        self.status.set("render error: %s" % payload)
                    else:
                        self.result = payload
                        self.redraw()
                    if self.dirty:
                        self._start()
                elif kind == "progress":
                    done, total, msg = payload
                    self.bar["maximum"], self.bar["value"] = total, done
                    self.status.set(msg)
                elif kind == "done":
                    self.working = False
                    self.bar["value"] = 0
                    self.status.set(payload)
                elif kind == "error":
                    self.working = False
                    self.bar["value"] = 0
                    messagebox.showerror(APP, payload)
        except queue.Empty:
            pass
        self.root.after(40, self._poll)

    def redraw(self):
        c = self.canvas
        c.delete("all")
        w, h = max(10, c.winfo_width()), max(10, c.winfo_height())
        im = self.preview_src if self.show_original else self.result
        if im is None:
            c.create_text(w // 2, h // 2, text="Open a photo  (Ctrl+O)", fill=DIM, font=("Consolas", 12))
            return
        if im.mode == "RGBA":
            im = im.copy()
            im.thumbnail((w - 20, h - 20), Image.BILINEAR)
            base = checker(im.width, im.height).convert("RGBA")
            base.alpha_composite(im)
            im = base.convert("RGB")
        else:
            im = im.convert("RGB")
            im.thumbnail((w - 20, h - 20), Image.BILINEAR)
        self.photo = ImageTk.PhotoImage(im)
        c.create_image(w // 2, h // 2, image=self.photo)
        if self.show_original:
            c.create_text(14, 12, anchor="nw", text="ORIGINAL", fill=ACC, font=FONT_B)

    def _canvas_press(self, e):
        if self.preview_src is None:
            self.open_dialog()          # empty stage: click to open a photo
        else:
            self._orig_on(e)

    def _orig_on(self, e):
        if not isinstance(e.widget, (ttk.Combobox,)) and not self.show_original and self.preview_src is not None:
            self.show_original = True
            self.redraw()

    def _orig_off(self, e):
        if self.show_original:
            self.show_original = False
            self.redraw()

    # ───────────────────────── exports (background) ─────────────────────────
    def _guard(self):
        if self.src is None:
            messagebox.showinfo(APP, "Open a photo first.")
            return False
        if self.working:
            messagebox.showinfo(APP, "An export is already running.")
            return False
        return True

    def _run(self, fn):
        self.working = True

        def wrap():
            try:
                fn()
            except Exception as e:
                self.q.put(("error", "Export failed:\n%s" % e))
        threading.Thread(target=wrap, daemon=True).start()

    def save_dialog(self):
        if not self._guard():
            return
        stem = os.path.splitext(os.path.basename(self.path))[0]
        dst = filedialog.asksaveasfilename(title="Save", defaultextension=".png", initialfile=stem + "_destroyed.png",
                                           filetypes=[("PNG", "*.png"), ("JPEG", "*.jpg")])
        if not dst:
            return
        params, seed, master = self.snapshot(), self.seed.get(), self.master.get()
        size = EXPORT_SIZES[self.export_size.get()]
        src = self.src
        self.q.put(("progress", (0, 1, "rendering full size...")))

        def job():
            im = render(src, params, seed, master, size)
            if dst.lower().endswith((".jpg", ".jpeg")) and im.mode == "RGBA":
                bg = Image.new("RGBA", im.size, (14, 14, 14, 255))
                bg.alpha_composite(im)
                im = bg.convert("RGB")
            im.save(dst, quality=95)
            self.q.put(("done", "saved " + dst))
        self._run(job)

    def batch_dialog(self):
        if self.working:
            messagebox.showinfo(APP, "An export is already running.")
            return
        d = filedialog.askdirectory(title="Folder with photos")
        if not d:
            return
        out = filedialog.askdirectory(title="Output folder", initialdir=d)
        if not out:
            return
        files = sorted(f for f in os.listdir(d) if f.lower().endswith(EXTS))
        if not files:
            messagebox.showinfo(APP, "No images in that folder.")
            return
        params, seed, master = self.snapshot(), self.seed.get(), self.master.get()
        size = EXPORT_SIZES[self.export_size.get()]

        def job():
            for i, f in enumerate(files):
                self.q.put(("progress", (i, len(files), "%d/%d  %s" % (i + 1, len(files), f))))
                im = render(load_image(os.path.join(d, f)), params, seed + i, master, size)
                im.save(os.path.join(out, os.path.splitext(f)[0] + "_destroyed.png"))
            self.q.put(("done", "batch finished: %d files -> %s" % (len(files), out)))
        self._run(job)

    def stages_dialog(self):
        if not self._guard():
            return
        n = 6
        out = filedialog.askdirectory(title="Where to write the decay series?")
        if not out:
            return
        stem = os.path.splitext(os.path.basename(self.path))[0]
        folder = os.path.join(out, stem + "_decay")
        params, seed, master = self.snapshot(), self.seed.get(), self.master.get()
        size = min(EXPORT_SIZES[self.export_size.get()] or 2400, 2400)
        src = self.src

        def job():
            for done, total in export_stages(src, params, seed, master, n, folder, stem, size):
                self.q.put(("progress", (done, total, "stage %d/%d" % (done, total))))
            self.q.put(("done", "decay series (PNG frames, GIF, strip) -> " + folder))
        self._run(job)


def main():
    root = tk.Tk()
    App(root, sys.argv[1] if len(sys.argv) > 1 and os.path.isfile(sys.argv[1]) else None)
    root.mainloop()


if __name__ == "__main__":
    main()
