import { waveConfig, pickEnemyType, PLAYER } from './config.js';
import { $ } from './utils.js';

export class WaveDirector {
  constructor(game) {
    this.game = game; this.waveNum = 0; this.toSpawn = 0;
    this.spawnTimer = 0; this.spawnInterval = 1; this.intermission = 0; this.inWave = false; this.cfg = null;
  }
  start(n) {
    this.waveNum = n; this.cfg = waveConfig(n);
    this.toSpawn = this.cfg.count; this.spawnInterval = this.cfg.spawnInterval; this.spawnTimer = 0.6;
    this.inWave = true; this.intermission = 0;
    $('waveNum').textContent = 'WAVE ' + n;
    this.game.hud.banner('WAVE ' + n, this.cfg.elite ? '⚠ ELITE SURGE' : 'SURVIVE', this.cfg.elite ? '#ff3b3b' : '#ff4ddb');
    this.game.audio.round(); this.info();
  }
  update(dt) {
    if (this.intermission > 0) {
      this.intermission -= dt; this.info();
      if (this.intermission <= 0) this.start(this.waveNum + 1);
      return;
    }
    if (!this.inWave) return;
    if (this.toSpawn > 0 && this.game.enemies.aliveCount < this.cfg.maxAlive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.game.enemies.spawn(pickEnemyType(this.waveNum), this.cfg.hpScale, this.cfg.speedScale);
        this.toSpawn--; this.spawnTimer = this.spawnInterval; this.info();
      }
    }
  }
  notifyKill() {
    this.info();
    if (this.inWave && this.toSpawn <= 0 && this.game.enemies.aliveCount <= 0) {
      this.inWave = false; this.intermission = 6;
      const bonus = 200 + this.waveNum * 80; this.game.hud.addCredits(bonus);
      this.game.hud.banner('WAVE ' + this.waveNum + ' CLEAR', `+${bonus} CREDITS · UPGRADE [B]`, '#7affc4');
      this.game.audio.power();
      this.game.player.hp = Math.min(PLAYER.maxHp, this.game.player.hp + 20); this.game.hud.vitals();
    }
  }
  info() {
    $('waveSub').textContent = this.inWave ? `ENEMIES: ${this.toSpawn + this.game.enemies.aliveCount}`
      : (this.intermission > 0 ? `NEXT WAVE IN ${Math.ceil(this.intermission)}s` : 'ENEMIES: 0');
  }
  reset() { this.waveNum = 0; this.inWave = false; this.intermission = 0; this.toSpawn = 0; }
}
