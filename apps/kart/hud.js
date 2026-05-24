// DOM HUD overlay: speed, drift-charge meter (staged colours), lap counter and
// times, the 3-2-1-GO countdown, the start screen, and the results panel. Kept
// as HTML (not in-canvas text) so it stays crisp on retina and is easy to style.

import { COLORS, TUNING as T } from './config.js';

const STAGE_CSS = ['#39d0ff', '#ff9f1c', '#b06bff'];

export class Hud {
    constructor() {
        this.elSpeed = document.getElementById('speed-val');
        this.elDriftFill = document.getElementById('drift-fill');
        this.elDriftWrap = document.getElementById('drift-wrap');
        this.elLap = document.getElementById('lap-val');
        this.elLapTime = document.getElementById('laptime-val');
        this.elCountdown = document.getElementById('countdown');
        this.elStart = document.getElementById('screen-start');
        this.elResults = document.getElementById('screen-results');
        this.elResultsBody = document.getElementById('results-body');
        this.elHud = document.getElementById('hud');
    }

    showStart() {
        this.elStart.classList.remove('hidden');
        this.elResults.classList.add('hidden');
        this.elHud.classList.remove('live');
        this.elCountdown.classList.add('hidden');
    }

    showPlaying() {
        this.elStart.classList.add('hidden');
        this.elResults.classList.add('hidden');
        this.elHud.classList.add('live');
    }

    setCountdown(text) {
        if (text === null) {
            this.elCountdown.classList.add('hidden');
            return;
        }
        this.elCountdown.classList.remove('hidden');
        this.elCountdown.textContent = text;
        // restart the pop animation
        this.elCountdown.style.animation = 'none';
        void this.elCountdown.offsetWidth;
        this.elCountdown.style.animation = '';
    }

    setSpeed(speed) {
        this.elSpeed.textContent = Math.round(Math.max(0, speed));
    }

    // charge: 0..1 within the current path to max. stage: 0..3. boostActive: bool
    setDrift(charge, stage, boostActive) {
        this.elDriftFill.style.width = Math.max(0, Math.min(1, charge)) * 100 + '%';
        if (stage > 0) {
            const c = STAGE_CSS[Math.min(stage, 3) - 1];
            this.elDriftFill.style.background = c;
            this.elDriftWrap.style.boxShadow = `0 0 12px ${c}`;
        } else if (boostActive) {
            this.elDriftWrap.style.boxShadow = '0 0 14px #fff';
        } else {
            this.elDriftFill.style.background = '#7fa8c9';
            this.elDriftWrap.style.boxShadow = 'none';
        }
    }

    setLap(current, total) {
        this.elLap.textContent = `${Math.min(current, total)}/${total}`;
    }

    setLapTime(seconds) {
        this.elLapTime.textContent = formatTime(seconds);
    }

    showResults(lapTimes, total) {
        this.elHud.classList.remove('live');
        this.elResults.classList.remove('hidden');
        let rows = '';
        lapTimes.forEach((t, i) => {
            const best = t === Math.min(...lapTimes);
            rows += `<div class="result-row${best ? ' best' : ''}">`
                + `<span>Lap ${i + 1}</span><span>${formatTime(t)}</span></div>`;
        });
        rows += `<div class="result-row total"><span>Total</span><span>${formatTime(total)}</span></div>`;
        this.elResultsBody.innerHTML = rows;
    }
}

export function formatTime(seconds) {
    if (!isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds * 1000) % 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
