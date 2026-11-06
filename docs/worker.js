/* PHOTO DESTROYER - render worker. Keeps the UI responsive while the engine runs. */
importScripts('data.js', 'engine.js');
let src = null, tsrc = null;
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'src') { src = { data: m.data, w: m.w, h: m.h }; return; }
  if (m.type === 'tsrc') { tsrc = { data: m.data, w: m.w, h: m.h }; return; }
  if (m.type === 'render') {
    try {
      const t = performance.now();
      const r = self.PD.render(m.thumb && tsrc ? tsrc : src, m.params, m.seed, m.master, m.maxSide);
      postMessage({ type: 'result', id: m.id, w: r.w, h: r.h, alpha: r.alpha, data: r.data, ms: performance.now() - t }, [r.data.buffer]);
    } catch (err) {
      postMessage({ type: 'error', id: m.id, message: String((err && err.stack) || err) });
    }
  }
};
