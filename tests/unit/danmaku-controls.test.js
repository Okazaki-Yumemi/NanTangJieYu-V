'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../../web/public/danmaku-game');
const publicDir = path.join(__dirname, '../../web/public');

function setup() {
  const nodes = new Map();
  function node(id) {
    const handlers = new Map();
    const classes = new Set();
    return {
      id, value: id === 'firefly-mode' ? 'normal' : '', textContent: '', disabled: false,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, on) { on ? classes.add(name) : classes.delete(name); } },
      setAttribute() {}, focus() {}, scrollIntoView() {}, setPointerCapture() {},
      addEventListener: (name, handler) => handlers.set(name, handler),
      fire(name, event = {}) { handlers.get(name)?.({ target: { tagName: 'CANVAS' }, preventDefault() {}, ...event }); }
    };
  }
  for (const match of fs.readFileSync(path.join(publicDir, 'danmaku.html'), 'utf8').matchAll(/id="([^"]+)"/g)) nodes.set(match[1], node(match[1]));
  const canvas = nodes.get('firefly-field');
  canvas.width = 360;
  canvas.height = 400;
  canvas.getBoundingClientRect = () => ({ width: 180, height: 200, left: 0, top: 0 });
  canvas.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
  const document = Object.assign(node('document'), {
    getElementById(id) { assert.ok(nodes.has(id), id); return nodes.get(id); },
    querySelector: () => node('shell')
  });
  const window = node('window');
  const requests = [];
  let current;
  let lastInput;
  window.NTJDanmaku = { ...engine,
    createGame(mode) { current = engine.createGame(mode, () => .5); return current; },
    step(state, input) { lastInput = input; return engine.step(state, input, () => .5); }
  };
  window.NTJArcadeScores = { mount: (...args) => requests.push(['mount', ...args]), submit: async () => { requests.push(['submit']); return { ok: false }; } };
  let callback;
  let now = 0;
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'danmaku.js'), 'utf8'), {
    window, document, Image: class { addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    performance: { now: () => now },
    requestAnimationFrame(fn) { callback = fn; return 1; }, cancelAnimationFrame() { callback = null; }
  });
  return {
    get: id => nodes.get(`firefly-${id}`), document, window, requests,
    input: () => lastInput, state: () => current,
    frame() { now += 1000 / 60; const fn = callback; callback = null; fn?.(now); }
  };
}

test('a second thumb using low speed or burst does not drop the first thumb drag', () => {
  const ui = setup();
  ui.get('start').fire('click');
  ui.get('field').fire('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
  ui.get('field').fire('pointermove', { pointerId: 1, clientX: 20, clientY: 20 });
  ui.frame();
  assert.equal(ui.input().target.x, 200);
  ui.get('field').fire('blur');
  ui.get('focus').fire('click');
  ui.get('field').fire('pointermove', { pointerId: 1, clientX: 25, clientY: 20 });
  ui.frame();
  assert.equal(ui.input().target.x, 210);
  assert.equal(ui.input().focus, true);
  ui.get('field').fire('blur');
  ui.get('burst').fire('click');
  ui.get('field').fire('pointermove', { pointerId: 1, clientX: 30, clientY: 20 });
  ui.frame();
  assert.equal(ui.input().target.x, 220);
  ui.get('field').fire('pointercancel', { pointerId: 1 });
  ui.frame();
  assert.equal(ui.input().target, null);
});

test('backgrounding pauses the simulation, clears the drag and resumes without a time jump', () => {
  const ui = setup();
  ui.get('start').fire('click');
  ui.get('field').fire('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
  ui.frame();
  ui.window.fire('blur');
  const pausedAt = ui.state().elapsed;
  assert.equal(ui.state().phase, 'paused');
  for (let i = 0; i < 300; i += 1) ui.frame();
  assert.equal(ui.state().elapsed, pausedAt);
  ui.get('start').fire('click');
  ui.frame();
  assert.equal(ui.input().target, null);
  assert.ok(ui.state().elapsed - pausedAt < .03);
});

test('simulation frames do not send score or polling requests to the server', () => {
  const ui = setup();
  ui.get('start').fire('click');
  const initialRequests = ui.requests.length;
  for (let i = 0; i < 60; i += 1) ui.frame();
  assert.equal(ui.requests.length, initialRequests);
  assert.equal(ui.requests.filter(([kind]) => kind === 'submit').length, 0);
});
