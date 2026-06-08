import { PLAYER } from './config.js';
import { $ } from './utils.js';

export class Shop {
  constructor(game) {
    this.game = game;
    this.items = [
      { name: 'REFILL AMMO', desc: 'Top up current weapon reserve', price: () => 250,
        can: () => game.weapons.current.reserve < game.weapons.current.reserveMax, buy: () => game.weapons.refillReserve(game.weapons.current) },
      { name: 'MAX AMMO (ALL)', desc: 'Refill every owned weapon', price: () => 700,
        can: () => true, buy: () => game.weapons.weapons.forEach(w => { if (w.owned) { w.reserve = w.reserveMax; w.ammo = w.mag; } }) },
      { name: 'NANO-REPAIR', desc: 'Restore full integrity', price: () => 500,
        can: () => game.player.hp < PLAYER.maxHp, buy: () => { game.player.hp = PLAYER.maxHp; } },
      { name: 'SHIELD CELL', desc: '+50 shield (absorbs damage)', price: () => 600,
        can: () => game.player.armor < PLAYER.maxArmor, buy: () => { game.player.armor = Math.min(PLAYER.maxArmor, game.player.armor + 50); } },
      { name: () => `DAMAGE UP · ${game.weapons.current.name}`, desc: () => `+30% damage (Lv ${game.weapons.current.dmgLvl}→${game.weapons.current.dmgLvl + 1})`,
        price: () => 800 * (game.weapons.current.dmgLvl + 1), can: () => game.weapons.current.dmgLvl < 5, buy: () => { game.weapons.current.dmgLvl++; } },
    ];
  }
  weaponDesc(w) {
    return w.id === 'smg' ? 'Full-auto · high rate of fire' : w.id === 'shotgun' ? '9-pellet plasma spread · close range'
      : w.id === 'rail' ? 'Piercing rail beam · massive damage' : 'Reliable sidearm';
  }
  render() {
    const g = this.game, val = v => typeof v === 'function' ? v() : v;
    $('buyCred').textContent = g.stats.credits.toLocaleString();
    const list = $('shopList'); list.innerHTML = '';
    const addRow = (name, desc, price, onbuy, disabled) => {
      const afford = g.stats.credits >= price && !disabled;
      const row = document.createElement('div'); row.className = 'shopItem' + (afford ? '' : ' cant');
      row.innerHTML = `<div class="nm"><b>${name}</b><span>${desc}</span></div><div class="pr">¢${price.toLocaleString()}</div>`;
      if (afford) row.onclick = () => {
        g.stats.credits -= price; $('credVal').textContent = g.stats.credits.toLocaleString();
        onbuy(); g.audio.buy(); g.hud.ammo(); g.hud.vitals(); this.render();
      };
      list.appendChild(row);
    };
    g.weapons.weapons.forEach((w, i) => {
      if (w.owned) return;
      addRow(`ACQUIRE · ${w.name}`, this.weaponDesc(w), w.price, () => { w.owned = true; w.ammo = w.mag; g.weapons.switchTo(i); });
    });
    this.items.forEach(it => addRow(val(it.name), val(it.desc), val(it.price), it.buy, !it.can()));
  }
}
