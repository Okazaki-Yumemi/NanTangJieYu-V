'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../../web/public/danmaku-game');

function quiet(mode = 'normal') {
  const state = game.createGame(mode, () => .5);
  state.nextWave = Infinity;
  state.lantern = { x: 20, y: 20 };
  return state;
}
function bullet(x, y, vx = 0, vy = 0) { return { x, y, vx, vy, grazed: false }; }
function advance(state, ticks, input = {}) {
  for (let i = 0; i < ticks; i += 1) game.step(state, input, () => .5);
}

test('relative drag works away from the character and scales with the phone canvas', () => {
  const target = { x: 180, y: 324 };
  const finger = { x: 20, y: 30 };
  const rect = { width: 180, height: 200 };
  assert.deepEqual(game.dragTarget(target, finger, finger, rect), target);
  assert.deepEqual(game.dragTarget(target, finger, { x: 30, y: 20 }, rect), { x: 200, y: 304 });
  assert.deepEqual(game.dragTarget(target, finger, { x: -1000, y: 1000 }, rect), { x: 9, y: 391 });
});

test('releasing a drag stops movement immediately without residual motion', () => {
  const state = quiet();
  game.step(state, { target: { x: 350, y: 200 } });
  const stopped = { ...state.player };
  advance(state, 120);
  assert.deepEqual(state.player, stopped);
});

test('keyboard and pointer use the same speed; focus slows both and diagonals stay normalized', () => {
  const keyboard = quiet();
  const touch = quiet();
  const focused = quiet();
  const diagonal = quiet();
  game.step(keyboard, { dx: 1 });
  game.step(touch, { target: { x: 350, y: 324 } });
  game.step(focused, { dx: 1, focus: true });
  game.step(diagonal, { dx: 1, dy: -1 });
  assert.equal(keyboard.player.x, touch.player.x);
  assert.ok(focused.player.x - 180 < (keyboard.player.x - 180) / 2);
  assert.ok(Math.abs(Math.hypot(diagonal.player.x - 180, diagonal.player.y - 324) - (keyboard.player.x - 180)) < 1e-10);
  advance(touch, 1000, { target: { x: -100, y: 1000 } });
  assert.deepEqual(touch.player, { x: 9, y: 391 });
});

test('each bullet grants graze and charge only once', () => {
  const state = quiet();
  state.bullets = [bullet(195, 324)];
  advance(state, 120);
  assert.equal(state.grazes, 1);
  assert.equal(state.guard, 1);
  assert.equal(state.score, 2);
});

test('burst spends the full charge, scores only nearby bullets, and cannot be repeated for free', () => {
  const state = quiet();
  state.guard = 8;
  state.bullets = [bullet(181, 324), bullet(200, 330), bullet(10, 10)];
  assert.equal(game.burst(state), true);
  assert.equal(state.guard, 0);
  assert.equal(state.burstPoints, 6);
  assert.equal(state.score, 6);
  assert.equal(state.bullets.length, 1);
  assert.equal(state.bullets[0].x, 10);
  assert.equal(game.burst(state), false);
  assert.equal(state.score, 6);
  assert.equal(state.bursts, 1);
});

test('burst has short protection, cannot farm graze while protected, and does not collect distant lamps', () => {
  const state = quiet();
  state.guard = 8;
  game.burst(state);
  state.bullets = [bullet(180, 324), bullet(195, 324)];
  advance(state, 30);
  assert.equal(state.phase, 'playing');
  assert.equal(state.guard, 0);
  assert.equal(state.grazes, 0);
  assert.equal(state.lamps, 0);
  advance(state, 20);
  assert.equal(state.phase, 'over');
});

test('saving charge shields one hit but breaks the lamp chain and awards no cancel points', () => {
  const state = quiet();
  state.guard = 8;
  state.chain = 4;
  state.lastLamp = 0;
  state.bullets = [bullet(180, 324), bullet(195, 324)];
  game.step(state);
  assert.equal(state.phase, 'playing');
  assert.equal(state.guard, 0);
  assert.equal(state.shields, 1);
  assert.equal(state.chain, 0);
  assert.equal(state.score, 0);
  assert.equal(state.bullets.length, 0);
});

test('a simultaneous near miss cannot replenish an incomplete shield before a lethal collision', () => {
  const state = quiet();
  state.guard = 7;
  state.bullets = [bullet(195, 324), bullet(180, 324)];
  game.step(state);
  assert.equal(state.phase, 'over');
  assert.equal(state.shields, 0);
});

test('collision detects a fast bullet crossing the hitbox between fixed steps', () => {
  const state = quiet();
  state.bullets = [bullet(150, 324, 7200, 0)];
  game.step(state);
  assert.equal(state.phase, 'over');
});

test('paused and completed rounds cannot move, score, spend charge or advance time', () => {
  for (const phase of ['paused', 'over']) {
    const state = quiet();
    state.phase = phase;
    state.guard = 8;
    const before = structuredClone(state);
    assert.equal(game.burst(state), false);
    game.step(state, { dx: 1, burst: true });
    assert.deepEqual(state, before);
  }
});

test('chain rewards fast pickups and resets after four seconds', () => {
  const state = quiet();
  for (let i = 0; i < 5; i += 1) {
    state.lantern = { ...state.player };
    game.step(state);
  }
  assert.equal(state.lampPoints, 10 + 20 + 30 + 40 + 40);
  state.lantern = { x: 20, y: 20 };
  advance(state, 480);
  state.lantern = { ...state.player };
  game.step(state);
  assert.equal(state.chain, 1);
  assert.equal(state.lampPoints, 150);
});

test('lunatic requires three lamps per spell while expert requires two', () => {
  const hard = quiet('lunatic');
  const expert = quiet('expert');
  hard.spellLamps = expert.spellLamps = 2;
  advance(hard, 1440);
  advance(expert, 1440);
  assert.equal(hard.phase, 'over');
  assert.match(hard.result, /2\/3/);
  assert.equal(expert.phase, 'playing');
  assert.equal(expert.spell, 1);
  assert.equal(expert.spellLamps, 0);
  assert.equal(expert.clearPoints, 30);
});

test('final quota is checked before a clear; successful runs end at exactly 36 seconds', () => {
  const state = quiet('lunatic');
  for (let spell = 0; spell < 3; spell += 1) {
    state.spellLamps = 3;
    advance(state, 1440);
  }
  assert.equal(state.elapsed, 36);
  assert.equal(state.cleared, true);
  assert.equal(state.clearPoints, 200);
  assert.equal(state.phase, 'over');
  const missed = quiet('lunatic');
  missed.tick = 4319;
  missed.spell = 2;
  game.step(missed);
  assert.equal(missed.cleared, false);
  assert.equal(missed.clearPoints, 0);
});

test('lunatic sends denser faster waves, while aimed warnings retain their locked direction', () => {
  for (const time of [.7, 13, 25]) {
    const normal = quiet('normal');
    const hard = quiet('lunatic');
    normal.nextWave = hard.nextWave = time;
    assert.ok(game.planWave(hard).length > game.planWave(normal).length);
  }
  const state = game.createGame('lunatic', () => .5);
  advance(state, 34);
  assert.ok(state.warning);
  const aim = state.warning.at(-2);
  const originalVelocity = [aim.vx, aim.vy];
  state.player.x = 20;
  advance(state, 50);
  assert.ok(state.bullets.includes(aim));
  assert.deepEqual([aim.vx, aim.vy], originalVelocity);
});

test('the displayed score equals the sum of its four breakdown categories', () => {
  const state = quiet('expert');
  state.guard = 8;
  state.bullets = [bullet(181, 324)];
  game.burst(state);
  state.lantern = { ...state.player };
  game.step(state);
  state.spellLamps = 2;
  advance(state, 1439);
  assert.equal(state.score, state.lampPoints + state.grazePoints + state.burstPoints + state.clearPoints);
});
