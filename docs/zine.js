/* PHOTO DESTROYER - zine page decoration: cut-out title, mode shortcuts. */
(function () {
  'use strict';
  const title = document.getElementById('title'); if (!title) return;
  const styles = [
    'background:#0d0d0d;color:#e8e3d4;font-family:Impact,"Arial Black",sans-serif',
    'background:#e8e3d4;color:#0d0d0d;border:3px solid #0d0d0d;font-family:"Courier New",monospace;font-weight:bold',
    'background:#d6482b;color:#0d0d0d;font-family:Impact,"Arial Black",sans-serif',
    'background:#e8e3d4;color:#0d0d0d;font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:bold',
    'background:#0d0d0d;color:#d6482b;font-family:"Courier New",monospace;font-weight:bold',
    'background:#cfc9b6;color:#0d0d0d;font-family:"Arial Black",Impact,sans-serif'
  ];
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let word = null;
  'PHOTO DESTROYER'.split('').forEach((ch) => {
    if (ch === ' ') { const g = document.createElement('span'); g.className = 'gap'; title.appendChild(g); word = null; return; }
    if (!word) { word = document.createElement('span'); word.className = 'word'; title.appendChild(word); }
    const i = document.createElement('i'); i.textContent = ch;
    i.style.cssText = styles[Math.floor(rnd() * styles.length)] + ';transform:rotate(' + ((rnd() - 0.5) * 9).toFixed(1) + 'deg) translateY(' + Math.round((rnd() - 0.5) * 10) + 'px);font-size:' + (0.82 + rnd() * 0.32).toFixed(2) + 'em';
    word.appendChild(i);
  });
  const go = (preset) => {
    const b = document.querySelector('#modes button[data-preset="' + preset + '"]');
    document.getElementById('app').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (b) setTimeout(() => b.click(), 350);
  };
  document.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); go(el.dataset.go); }));
})();
