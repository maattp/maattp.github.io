// VIEW_PROBE_FILE for kwshots: the real calendar (kwcalendar.js).
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/calprobe.js node tools/kw/kwshots.mjs <dir>
(() => {
  const d = window.__dbg, c = d.calendar, out = {}, ok = (k, v) => { out[k] = v; };
  const meshes = () => c.group.children.length;
  // 1. a date with no season builds and draws nothing
  c.setDate('2026-06-15');
  ok('off: themes any', c.th.any); ok('off: group children', meshes()); ok('off: carveAll', d.world.decor.carveAll); ok('off: costume hook', !!d.peds.costume);
  // 2. each season builds, and tears down again
  for (const [name, date] of [['halloween', '2026-10-31'], ['remembrance', '2026-11-05'], ['christmas', '2026-12-10'], ['canada', '2026-07-01']]) {
    c.setDate(date);
    ok(name + ': children', c.group.children.map((m) => m.name).join(','));
    ok(name + ': greeting', c.th.greeting);
  }
  c.setDate('2026-06-15');
  ok('after teardown: children', meshes());
  // 3. Remembrance Day silence
  c.setDate('2026-11-11');
  const a = d.audio, tb = a && a.trafficBus ? a.trafficBus.gain.value : null;
  c.silence(120);
  ok('silence: hush', a.hush); ok('silence: trafficBus', a.trafficBus ? [tb, a.trafficBus.gain.value] : null);
  c._unsilence(true);
  ok('unsilence: hush', a.hush); ok('unsilence: trafficBus', a.trafficBus ? a.trafficBus.gain.value : null);
  // 4. Canada Day fireworks reuse kwevents.js
  c.setDate('2026-07-01');
  d.events.stop && d.events.stop();
  ok('fireworks started', c.fireworks(true)); ok('fireworks event', d.events.cur && d.events.cur.constructor.name + ' ' + (d.events.cur.hint || ''));
  d.events.stop && d.events.stop();
  // 5. the day's toast, once
  c.setDate('2026-10-31');
  try { localStorage.removeItem('autokw-caltoast'); } catch (e) { /* */ }
  c.greeted = false; c._greet();
  ok('toast', d.hud.toast.textContent);
  d.hud.toast.textContent = '';
  c.greeted = false; c._greet();
  ok('toast again (must be empty)', d.hud.toast.textContent);
  // 6. the date override, ?date= or __calDate, is what the game booted with
  ok('booted date', c.date.toDateString());
  return JSON.stringify(out, null, 1);
})()
