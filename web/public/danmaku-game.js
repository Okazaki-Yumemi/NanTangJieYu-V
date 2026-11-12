'use strict';

/* 固定 120Hz 判定；画面、触屏和键盘共用同一套规则。 */
(function exposeDanmaku(root) {
  const WIDTH = 360;
  const HEIGHT = 400;
  const STEP = 1 / 120;
  const DURATION = 36;
  const GUARD_MAX = 8;
  const BURST_RADIUS = 100;
  const PATTERNS = ['一符 · 花雨', '二符 · 横流', '三符 · 星环'];
  const COLORS = ['#ff9eaa', '#94d9ee', '#e0a6f4'];
  const MODES = {
    normal: { label: '巡夜', quota: 0, interval: 1, clearBonus: 0 },
    expert: { label: '符卡试炼', quota: 2, interval: .83, clearBonus: 30 },
    lunatic: { label: '极限挑战', quota: 3, interval: .64, clearBonus: 50 }
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function dragTarget(target, previous, current, rect) {
    return {
      x: clamp(target.x + (current.x - previous.x) * WIDTH / rect.width, 9, WIDTH - 9),
      y: clamp(target.y + (current.y - previous.y) * HEIGHT / rect.height, 9, HEIGHT - 9)
    };
  }

  function createGame(mode = 'normal', random = Math.random) {
    if (!Object.hasOwn(MODES, mode)) throw new Error('Unknown danmaku mode');
    const state = {
      mode, player: { x: 180, y: 324 }, tick: 0, elapsed: 0, phase: 'playing',
      score: 0, lampPoints: 0, grazePoints: 0, burstPoints: 0, clearPoints: 0,
      lamps: 0, spellLamps: 0, spell: 0, grazes: 0, guard: 0, bursts: 0, shields: 0,
      chain: 0, lastLamp: -Infinity, invulnerableUntil: 0,
      notes: [], effects: [], bullets: [], warning: null, nextWave: .7, wave: 0,
      lantern: null, cleared: false, result: ''
    };
    spawnLantern(state, random);
    return state;
  }

  function spawnLantern(state, random) {
    const left = state.player.x > WIDTH / 2 ? 28 : WIDTH / 2 + 30;
    // 不把下一盏灯直接放在弹丸上；仍需玩家自己穿过弹幕去取。
    let candidate;
    let clearance = -1;
    for (let i = 0; i < 8; i += 1) {
      const point = { x: left + random() * 115, y: 124 + random() * 232 };
      const distance = state.bullets.reduce((min, bullet) => Math.min(min, Math.hypot(point.x - bullet.x, point.y - bullet.y)), Infinity);
      if (distance > clearance) { candidate = point; clearance = distance; }
      if (distance >= 32) break;
    }
    state.lantern = candidate;
  }

  function planWave(state) {
    const pattern = Math.min(2, Math.floor(state.nextWave / 12));
    const hard = state.mode === 'lunatic';
    const wave = state.wave;
    const shots = [];
    const launch = (x, y, angle, speed) => shots.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      color: COLORS[pattern], grazed: false
    });
    if (pattern === 0) {
      const x = 180 + Math.sin(wave * 1.33) * 104;
      const spread = hard ? 4 : 2;
      for (let i = -spread; i <= spread; i += 1) {
        launch(x, 4, Math.PI / 2 + i * (hard ? .18 : .24), hard ? 145 : 111);
      }
    } else if (pattern === 1) {
      const side = wave % 2;
      const count = hard ? 11 : 9;
      const gap = (wave * 3) % (count - 1);
      for (let i = 0; i < count; i += 1) {
        if (i === gap || i === gap + 1) continue;
        launch(side ? WIDTH - 3 : 3, hard ? 24 + i * 35 : 33 + i * 43, side ? Math.PI : 0, hard ? 180 : 148);
      }
    } else {
      const x = 180 + Math.sin(wave * 1.46) * 92;
      const y = 98 + Math.cos(wave * 1.2) * 33;
      const count = hard ? 18 : 12;
      for (let i = 0; i < count; i += 1) {
        // 极限星环留一道会随波次旋转的缺口。
        if (hard && (i === wave % count || i === (wave + 1) % count)) continue;
        launch(x, y, i * Math.PI * 2 / count + wave * .22, hard ? 142 : 115);
      }
    }
    if (state.mode !== 'normal' && (hard || wave % 2 === 0)) {
      const x = wave % 4 ? 4 : WIDTH - 4;
      const y = pattern === 1 ? 4 : 64;
      // 在预警时锁定方向，发射时不再追踪玩家。
      const aim = Math.atan2(state.player.y - y, state.player.x - x);
      for (let i = -1; i <= 1; i += 1) launch(x, y, aim + i * .19, hard ? 186 : 151);
    }
    return shots;
  }

  function note(state, label) {
    state.notes.push({ ...state.player, label, at: state.elapsed });
  }

  function award(state, field, points) {
    state[field] += points;
    state.score += points;
    if (points) note(state, `+${points}`);
  }

  function clearNearby(state, radius) {
    const before = state.bullets.length;
    state.bullets = state.bullets.filter(bullet => Math.hypot(bullet.x - state.player.x, bullet.y - state.player.y) > radius);
    return before - state.bullets.length;
  }

  function burst(state) {
    if (state.phase !== 'playing' || state.guard < GUARD_MAX) return false;
    state.guard = 0;
    state.bursts += 1;
    const cleared = clearNearby(state, BURST_RADIUS);
    award(state, 'burstPoints', cleared * 3);
    state.invulnerableUntil = state.elapsed + .35;
    state.effects.push({ ...state.player, at: state.elapsed, radius: BURST_RADIUS });
    note(state, cleared ? `灵击 · 消弹 ${cleared}` : '灵击');
    return true;
  }

  // 两次模拟之间也检测相对运动，避免高速移动直接穿过弹丸。
  function sweepDistance(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 ? clamp(-(from.x * dx + from.y * dy) / length2, 0, 1) : 0;
    return Math.hypot(from.x + t * dx, from.y + t * dy);
  }

  function finish(state, result, cleared = false) {
    state.phase = 'over';
    state.result = result;
    state.cleared = cleared;
  }

  function step(state, input = {}, random = Math.random) {
    if (state.phase !== 'playing') return state;
    state.tick += 1;
    state.elapsed = state.tick * STEP;
    const rules = MODES[state.mode];
    if (!state.warning && state.elapsed >= state.nextWave - .42) state.warning = planWave(state);
    if (state.elapsed >= state.nextWave) {
      state.bullets.push(...state.warning);
      state.warning = null;
      state.wave += 1;
      const interval = state.elapsed < 12 ? 1.08 : state.elapsed < 24 ? 1.4 : 1.22;
      state.nextWave += interval * rules.interval;
    }
    const previous = { ...state.player };
    const dx = input.target ? input.target.x - state.player.x : input.dx || 0;
    const dy = input.target ? input.target.y - state.player.y : input.dy || 0;
    const distance = Math.hypot(dx, dy);
    if (distance) {
      const movement = (input.focus ? 90 : 220) * STEP;
      const travel = input.target ? Math.min(distance, movement) : movement;
      state.player.x = clamp(state.player.x + dx / distance * travel, 9, WIDTH - 9);
      state.player.y = clamp(state.player.y + dy / distance * travel, 9, HEIGHT - 9);
    }
    if (input.burst) burst(state);
    let hit = false;
    const near = [];
    for (const bullet of state.bullets) {
      const from = { x: bullet.x - previous.x, y: bullet.y - previous.y };
      bullet.x += bullet.vx * STEP;
      bullet.y += bullet.vy * STEP;
      const distanceToPlayer = sweepDistance(from, { x: bullet.x - state.player.x, y: bullet.y - state.player.y });
      if (state.elapsed < state.invulnerableUntil) continue;
      if (distanceToPlayer < 8) hit = true;
      else if (distanceToPlayer < 21 && !bullet.grazed) near.push(bullet);
    }
    if (hit) {
      if (state.guard < GUARD_MAX) {
        finish(state, '撞上弹幕');
        return state;
      }
      state.guard = 0;
      state.shields += 1;
      state.chain = 0;
      state.lastLamp = -Infinity;
      state.invulnerableUntil = state.elapsed + 1.1;
      clearNearby(state, 38);
      state.effects.push({ ...state.player, at: state.elapsed, radius: 38 });
      note(state, '护身符抵挡 · 连灯中断');
    } else {
      for (const bullet of near) {
        bullet.grazed = true;
        state.grazes += 1;
        state.guard = Math.min(GUARD_MAX, state.guard + 1);
        award(state, 'grazePoints', 2);
      }
    }
    state.bullets = state.bullets.filter(({ x, y }) => x > -12 && x < WIDTH + 12 && y > -12 && y < HEIGHT + 12);
    state.notes = state.notes.filter(item => state.elapsed - item.at < 1);
    state.effects = state.effects.filter(item => state.elapsed - item.at < .35);
    if (Math.hypot(state.player.x - state.lantern.x, state.player.y - state.lantern.y) < 15) {
      state.lamps += 1;
      state.spellLamps += 1;
      state.chain = state.elapsed - state.lastLamp < 4 ? Math.min(4, state.chain + 1) : 1;
      state.lastLamp = state.elapsed;
      award(state, 'lampPoints', state.chain * 10);
      spawnLantern(state, random);
    }
    if (state.elapsed >= (state.spell + 1) * 12) {
      if (state.spellLamps < rules.quota) {
        finish(state, `${PATTERNS[state.spell]}未破 · 灯火 ${state.spellLamps}/${rules.quota}`);
      } else if (state.elapsed >= DURATION) {
        award(state, 'clearPoints', 50 + rules.clearBonus);
        finish(state, '三道符卡全部通过', true);
      } else {
        award(state, 'clearPoints', rules.clearBonus);
        state.spell += 1;
        state.spellLamps = 0;
      }
    }
    return state;
  }

  const api = { WIDTH, HEIGHT, STEP, DURATION, GUARD_MAX, BURST_RADIUS, PATTERNS, MODES, dragTarget, createGame, planWave, burst, step };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NTJDanmaku = api;
})(typeof window === 'undefined' ? globalThis : window);
