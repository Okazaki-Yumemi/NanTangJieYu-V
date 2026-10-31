'use strict';

/* 浏览器与服务端复用同一固定步长模拟。只回传操作轨迹，不信任客户端成绩。 */
(function exposeFishing(root) {
  const DT = .02;
  const MAX_TICKS = 2250;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function zoneSize(config) { return .28 - clamp(config.difficulty, 0, 1) * .19; }
  function fishPosition(tick, config) {
    const t = tick * DT;
    const d = config.difficulty;
    const phase = (config.seed % 1000) / 1000 * Math.PI * 2;
    return clamp(.5 + .27 * Math.sin(t * (.7 + d * 1.5) + phase) + .12 * Math.sin(t * (1.3 + d * 3) + phase * 1.7) + .045 * d * Math.sin(t * (3.1 + d * 2.4) + phase * .7), .07, .93);
  }
  function createGame(config) {
    return { tick: 0, y: .72, velocity: 0, fish: fishPosition(0, config), progress: .25, status: 'playing' };
  }
  function step(state, held, config) {
    if (state.status !== 'playing') return state;
    state.tick += 1;
    state.velocity = clamp(state.velocity + (held ? -3.2 : 2.4) * DT, -.9, .9);
    const half = zoneSize(config) / 2;
    state.y = clamp(state.y + state.velocity * DT, half, 1 - half);
    if (state.y === half || state.y === 1 - half) state.velocity = 0;
    state.fish = fishPosition(state.tick, config);
    const inside = Math.abs(state.fish - state.y) <= half;
    if (inside) state.progress += DT * (.12 - config.difficulty * .025);
    else if (state.tick > 75) state.progress -= DT * (.09 + config.difficulty * .09);
    state.progress = clamp(state.progress, 0, 1);
    if (state.progress >= 1) state.status = 'caught';
    else if (state.progress <= 0 || state.tick >= MAX_TICKS) state.status = 'escaped';
    return state;
  }
  function replay(config, controls, ticks) {
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS || !Array.isArray(controls) || controls.length > MAX_TICKS) return null;
    let previous = -1;
    for (const input of controls) {
      if (!input || !Number.isInteger(input.tick) || input.tick <= previous || input.tick < 0 || input.tick >= ticks || typeof input.held !== 'boolean') return null;
      previous = input.tick;
    }
    const state = createGame(config);
    let index = 0;
    let held = false;
    while (state.tick < ticks && state.status === 'playing') {
      if (controls[index] && controls[index].tick === state.tick) held = controls[index++].held;
      step(state, held, config);
    }
    return state.tick === ticks ? state : null;
  }
  const api = { DT, MAX_TICKS, createGame, step, replay, fishPosition, zoneSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FishingGame = api;
})(typeof window === 'undefined' ? globalThis : window);
