'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { randomIntInclusive, rollRange, weightedPick, createSeededRandom } = require('../../shared/random');
const {
  hashPassword,
  verifyPassword,
  generateRegistrationCode,
  normalizeDisplayName
} = require('../../server/auth');
const { parseEnvFile } = require('../../server/config');

test('randomIntInclusive is inclusive on both ends', () => {
  const random = createSeededRandom('bounds');
  for (let index = 0; index < 200; index += 1) {
    const value = randomIntInclusive(2, 5);
    assert.ok(value >= 2 && value <= 5, `value ${value} out of range`);
  }
  assert.equal(randomIntInclusive(3, 3), 3);
});

test('rollRange handles ranges and invalid input', () => {
  for (let index = 0; index < 50; index += 1) {
    const value = rollRange([10, 20]);
    assert.ok(value >= 10 && value <= 20);
  }
  assert.equal(rollRange(null), 0);
  assert.equal(rollRange([5, 5]), 5);
  assert.ok(rollRange([20, 10]) >= 10);
});

test('weightedPick respects weights and skips zero weights', () => {
  const items = [
    { id: 'a', weight: 0 },
    { id: 'b', weight: 1 },
    { id: 'c', weight: 3 }
  ];
  const counts = { b: 0, c: 0 };
  const random = createSeededRandom('pick');
  for (let index = 0; index < 1000; index += 1) {
    const picked = weightedPick(items, random);
    assert.notEqual(picked, null);
    assert.notEqual(picked.id, 'a');
    counts[picked.id] += 1;
  }
  assert.ok(counts.c > counts.b * 1.5, `expected c dominant, got ${JSON.stringify(counts)}`);
  assert.equal(weightedPick([], () => 1), null);
  assert.equal(weightedPick([{ id: 'x', weight: 0 }], () => 1), null);
});

test('seeded random is deterministic for the same seed', () => {
  const first = createSeededRandom('seed-1');
  const second = createSeededRandom('seed-1');
  const seqA = [first(), first(), first()];
  const seqB = [second(), second(), second()];
  assert.deepEqual(seqA, seqB);
});

test('password hash and verify roundtrip', () => {
  const { salt, hash } = hashPassword('secret123');
  assert.ok(verifyPassword('secret123', salt, hash));
  assert.ok(!verifyPassword('wrong', salt, hash));
  assert.ok(!verifyPassword('secret123', '', hash));
  assert.ok(!verifyPassword('secret123', salt, ''));
});

test('registration code format uses unambiguous alphabet', () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateRegistrationCode();
    assert.match(code, /^[23456789A-Z]{4}-[23456789A-Z]{4}-[23456789A-Z]{4}$/);
    assert.ok(!/[01OIL]/.test(code));
  }
});

test('normalizeDisplayName trims and lowercases', () => {
  assert.equal(normalizeDisplayName('  Alice  '), 'alice');
  assert.equal(normalizeDisplayName(''), '');
});

test('parseEnvFile parses key values and quotes', () => {
  const parsed = parseEnvFile(`
# comment
A=1
B = hello world
C="quoted value"
D='single'
broken line
=empty
  `);
  assert.deepEqual(parsed, {
    A: '1',
    B: 'hello world',
    C: 'quoted value',
    D: 'single'
  });
});
