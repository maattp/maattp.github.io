// DOM HUD: score/distance, shield pips, speed bar, boost flash, and the
// start / game-over panels. Kept as HTML overlay (not in-canvas text) so it
// stays crisp on retina and is trivial to style.

import { MAX_SHIELDS } from './config.js';

export class Hud {
    constructor() {
        this.elScore = document.getElementById('score');
        this.elBest = document.getElementById('best-line');
        this.elShields = document.getElementById('shields');
        this.elHud = document.getElementById('hud');
        this.elSpeedWrap = document.getElementById('speed-wrap');
        this.elSpeedFill = document.getElementById('speed-fill');
        this.elStart = document.getElementById('screen-start');
        this.elOver = document.getElementById('screen-over');
        this.elOverScore = document.getElementById('over-score');
        this.elOverBest = document.getElementById('over-best');
        this.elOverOrbs = document.getElementById('over-orbs');
        this.elStartHint = document.getElementById('start-hint');

        this._pips = [];
        for (let i = 0; i < MAX_SHIELDS; i++) {
            const p = document.createElement('div');
            p.className = 'pip';
            this.elShields.appendChild(p);
            this._pips.push(p);
        }
        this._lastScore = -1;
    }

    showStart() {
        this.elStart.classList.remove('hidden');
        this.elOver.classList.add('hidden');
        this.elHud.classList.remove('live');
        this.elSpeedWrap.classList.remove('live');
    }

    showPlaying() {
        this.elStart.classList.add('hidden');
        this.elOver.classList.add('hidden');
        this.elHud.classList.add('live');
        this.elSpeedWrap.classList.add('live');
    }

    showOver(score, best, orbs) {
        this.elOver.classList.remove('hidden');
        this.elHud.classList.remove('live');
        this.elSpeedWrap.classList.remove('live');
        this.elOverScore.textContent = score.toLocaleString();
        this.elOverBest.textContent = best.toLocaleString();
        this.elOverOrbs.textContent = orbs.toLocaleString();
    }

    setHintNoMotion() {
        this.elStartHint.innerHTML =
            'Motion access unavailable — use ← → / A D keys or drag to steer.<br>' +
            'Dodge the red rings, grab gold orbs, hit green ramps to boost.';
    }

    setShields(n, max) {
        for (let i = 0; i < this._pips.length; i++) {
            const visible = i < max;
            this._pips[i].style.display = visible ? '' : 'none';
            this._pips[i].classList.toggle('spent', i >= n);
        }
    }

    setScore(score, best) {
        if (score !== this._lastScore) {
            this.elScore.textContent = score.toLocaleString();
            this._lastScore = score;
        }
        this.elBest.textContent = 'best ' + best.toLocaleString();
    }

    setSpeed(frac) {
        this.elSpeedFill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
    }
}
