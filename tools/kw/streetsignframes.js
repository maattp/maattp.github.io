// VIEW_PROBE_FILE (with VIEW_PRE_FILE=tools/kw/streetsignpre.js): turns
// tools/kw/streetsignviews.json's `eval` views into fixed { c, t, fov } views,
// so a before/after (window.__noStreetSigns = true in VIEW_BOOT_JS) frames the
// same corners. Pass the views in window.__ssViews (VIEW_PRE) or edit below.
(() => {
  const V = window.__ssViews || [];
  return JSON.stringify(V.map((v) => {
    const r = eval(v.eval);
    const f = (a) => a.map((q) => Math.round(q * 100) / 100);
    return { name: v.name, c: f(r.c), t: f(r.t), fov: r.fov };
  }));
})()
