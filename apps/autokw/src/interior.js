// Auto KW: an interior owns the screen (the Aud's bowl, a festhalle). The
// game's own HUD -- minimap, money, the pad, toasts, the objective -- is
// hidden under it while it is up, and comes back when it closes.

let styled = false;
export function setInterior(on) {
  const app = document.getElementById('app');
  if (!app) return;
  if (!styled) {
    styled = true;
    const st = document.createElement('style');
    st.textContent = `#app.interior #hud, #app.interior #pad, #app.interior #topBtns, #app.interior #objective, #app.interior #toast,
      #app.interior #stickZone, #app.interior #lookZone, #app.interior #fireBtns, #app.interior #hurt { visibility: hidden !important; }`;
    document.head.appendChild(st);
  }
  app.classList.toggle('interior', !!on);
}
