// Pause menu on a phone-size viewport (AUTO_PHONE=1 = 874x402): do all passport rows fit / scroll, and
// is the Resume button reachable? Prints geometry. For kwshots VIEW_PROBE_FILE.
(async () => {
  const d = window.__dbg;
  d.game.paused = false;
  const btn = document.getElementById('pauseBtn') || document.querySelector('[data-pause], #menuBtn');
  const menu = document.getElementById('pauseMenu');
  if (!menu.classList.contains('show')) { (btn || document.getElementById('topBtns').querySelector('button')).click(); }
  await new Promise((r) => setTimeout(r, 800));
  const box = menu.firstElementChild, pass = document.getElementById('passport');
  const cs = getComputedStyle(box), ms = getComputedStyle(menu);
  const rows = document.querySelectorAll('#ppGrid .ppRow');
  const r = box.getBoundingClientRect();
  const cut = [...rows].filter((e) => { const b = e.getBoundingClientRect(); const s = e.querySelector('span'); return s.scrollWidth > s.clientWidth + 1 || e.scrollWidth > e.clientWidth + 1; }).map((e) => e.textContent);
  return JSON.stringify({ vw: innerWidth, vh: innerHeight, menuClass: menu.className, box: [r.x | 0, r.y | 0, r.width | 0, r.height | 0], boxOverflowY: cs.overflowY, menuOverflowY: ms.overflowY,
    boxScrollH: box.scrollHeight, boxClientH: box.clientHeight, menuScrollH: menu.scrollHeight, menuClientH: menu.clientHeight,
    rows: [...rows].map((e) => e.textContent), cut, resume: (() => { const b = document.getElementById('resumeBtn').getBoundingClientRect(); return [b.y | 0, b.height | 0]; })() }, null, 1);
})()
