// Auto KW: the HUD readouts follow the game (v112 writes them only on change).
//   VIEW_PROBE_FILE=tools/kw/hudprobe.js AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. node tools/kw/kwshots.mjs /tmp/x
// Steps hud.update through money, health, wanted, armed and a race starting
// and ending, reading the DOM back after each: ALL OK or the first mismatch.
(() => {
  const d = window.__dbg, H = d.hud, g = d.game, p = d.player;
  const $ = (id) => document.getElementById(id);
  const step = () => H.update(1 / 30, g, p, d.traffic);
  const bad = [];
  const ok = (c, m) => { if (!c) bad.push(m); };
  const m0 = g.money, w0 = g.wanted, h0 = p.health, a0 = p.armed, am0 = p.ammo;
  try {
    g.money = 1234567; step();
    ok(H.money.textContent === '$1,234,567', 'money ' + H.money.textContent);
    g.money = 89; step(); step();
    ok(H.money.textContent === '$89', 'money again ' + H.money.textContent);
    p.health = 30; step();
    ok(H.healthFill.style.width === '30%' && /240, 180, 41|f0b429/.test(H.healthFill.style.background), 'health 30 ' + H.healthFill.style.width + ' ' + H.healthFill.style.background);
    p.health = 90; step();
    ok(H.healthFill.style.width === '90%', 'health 90 ' + H.healthFill.style.width);
    g.wanted = 3; step();
    ok(H.stars.querySelectorAll('.star.on').length === 3, 'stars 3');
    g.wanted = 0; step();
    ok(H.stars.querySelectorAll('.star.on').length === 0, 'stars 0');
    g.wanted = 3; step();
    ok(H.stars.querySelectorAll('.star.on').length === 3, 'stars 3 again');
    g.wanted = 0; step();
    const foot = p.onFoot;
    step();
    ok(H.armourRow.classList.contains('hidden') === !!foot, 'speedo hidden on foot ' + foot);
    if (foot) {
      p.armed = true; p.ammo = 17; step();
      ok(!H.ammoEl.classList.contains('hidden') && H.ammoEl.textContent === '⌖ 17', 'ammo shown ' + H.ammoEl.textContent);
      p.ammo = 16; step();
      ok(H.ammoEl.textContent === '⌖ 16', 'ammo 16 ' + H.ammoEl.textContent);
      p.armed = false; step();
      ok(H.ammoEl.classList.contains('hidden'), 'ammo hidden');
    }
    H.race = { name: 'Test Run', time: '0:12.3', left: '3 left', delta: '-0.4', ahead: true, best: '0:40.0' }; step();
    ok($('racePanel').classList.contains('on') && $('raceTime').textContent === '0:12.3' && $('raceDelta').className === 'ahead' && $('raceBest').textContent === 'best 0:40.0', 'race on');
    H.race = Object.assign({}, H.race, { time: '0:13.0', delta: '+0.2', ahead: false }); step();
    ok($('raceTime').textContent === '0:13.0' && $('raceDelta').className === 'behind', 'race tick');
    H.race = null; step();
    ok(!$('racePanel').classList.contains('on'), 'race off');
  } finally {
    g.money = m0; g.wanted = w0; p.health = h0; p.armed = a0; p.ammo = am0; H.race = null; step();
  }
  return bad.length ? 'FAIL: ' + bad.join('; ') : 'ALL OK';
})()
