// Controller layer — translates raw DOM events into game/system calls.
export class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.mouseDown = false;
    this.adsDown = false;
    this._bind();
  }
  reset() { this.keys = {}; this.mouseDown = false; this.adsDown = false; }

  _bind() {
    const g = this.game, canvas = g.engine.canvas;
    addEventListener('keydown', e => {
      const k = e.key.toLowerCase(); this.keys[k] = true;
      if (g.state === 'playing') {
        if (k === 'r') g.weapons.startReload();
        else if (k >= '1' && k <= '4') g.weapons.switchTo(+k - 1);
        else if (k === 'b') g.openBuy();
        else if (k === ' ') { g.player.jump(); e.preventDefault(); }
      } else if (g.state === 'buy' && k === 'b') g.closeBuy();
    });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

    canvas.addEventListener('mousedown', e => {
      if (g.state !== 'playing') return;
      if (e.button === 0) { this.mouseDown = true; if (!g.weapons.current.auto) g.weapons.fire(); }
      else if (e.button === 2) { this.adsDown = true; g.audio.ads(); }
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false; else if (e.button === 2) this.adsDown = false; });
    addEventListener('mousemove', e => {
      if (g.state === 'playing' && document.pointerLockElement === canvas) g.player.look(e.movementX, e.movementY);
    });
    addEventListener('wheel', e => { if (g.state === 'playing') g.weapons.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    addEventListener('contextmenu', e => { if (g.state !== 'menu') e.preventDefault(); });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && g.state === 'playing' && !g._intentionalUnlock) g.pause();
      g._intentionalUnlock = false;
    });
  }
}
