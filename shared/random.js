'use strict';

const crypto = require('node:crypto');

const RANDOM_UNIT_SCALE = 1000000000;

function randomUnit() {
  return crypto.randomInt(0, RANDOM_UNIT_SCALE) / RANDOM_UNIT_SCALE;
}

/**
 * Inclusive integer random in [min, max].
 */
function randomIntInclusive(min, max) {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) {
    return lo;
  }
  return crypto.randomInt(lo, hi + 1);
}

function rollRange(range) {
  if (!Array.isArray(range) || range.length !== 2) {
    return 0;
  }
  return randomIntInclusive(range[0], range[1]);
}

/**
 * Deterministic PRNG for tests / reproducible sequences.
 */
function createSeededRandom(seedInput) {
  let seed = 0;
  const str = String(seedInput);
  for (let index = 0; index < str.length; index += 1) {
    seed = (seed * 31 + str.charCodeAt(index)) >>> 0;
  }

  return function next() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function weightedPick(items, randomFn, weightOf = (item) => item.weight || 0) {
  const pool = items.filter((item) => weightOf(item) > 0);
  const totalWeight = pool.reduce((sum, item) => sum + weightOf(item), 0);
  if (!pool.length || totalWeight <= 0) {
    return null;
  }

  let cursor = randomFn() * totalWeight;
  for (const item of pool) {
    cursor -= weightOf(item);
    if (cursor <= 0) {
      return item;
    }
  }

  return pool[pool.length - 1];
}

module.exports = {
  randomUnit,
  randomIntInclusive,
  rollRange,
  createSeededRandom,
  weightedPick
};
