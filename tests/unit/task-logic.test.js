'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWipeMask, createMemorySequence } = require('../../web/public/task-logic');

test('repeated rubbing in one spot does not manufacture cleaning progress', () => {
  const mask = createWipeMask();
  const point = { x: 200, y: 200 };
  const first = mask.stroke(point, point, 36);
  assert.ok(first > 0 && first < .1);
  for (let i = 0; i < 100; i += 1) assert.equal(mask.stroke(point, point, 36), first);
});

test('fast and slow pointer strokes clean the same area', () => {
  const fast = createWipeMask();
  const slow = createWipeMask();
  const from = { x: 0, y: 100 };
  const to = { x: 640, y: 300 };
  const expected = fast.stroke(from, to, 36);
  let actual = 0;
  for (let i = 0; i < 32; i += 1) {
    actual = slow.stroke({ x: i * 20, y: 100 + i * 6.25 }, { x: (i + 1) * 20, y: 100 + (i + 1) * 6.25 }, 36);
  }
  assert.equal(actual, expected);
});

test('covering the pane clears it; strokes outside the pane do not count', () => {
  const mask = createWipeMask();
  assert.equal(mask.stroke({ x: -100, y: -100 }, { x: -50, y: -50 }, 10), 0);
  let coverage;
  for (let y = 20; y < 400; y += 40) coverage = mask.stroke({ x: 0, y }, { x: 640, y }, 36);
  assert.equal(coverage, 1);
});

test('memory task requires both rounds, and a mistake restarts only the current round', () => {
  const sequence = createMemorySequence([1, 4, 6]);
  assert.equal(sequence.accept(1).complete, false);
  assert.equal(sequence.accept(4).advance, true);
  assert.equal(sequence.accept(1).complete, false);
  assert.equal(sequence.accept(6).matched, false);
  assert.equal(sequence.accept(4).matched, false);
  assert.equal(sequence.accept(1).complete, false);
  assert.equal(sequence.accept(4).complete, false);
  assert.equal(sequence.accept(6).complete, true);
});
