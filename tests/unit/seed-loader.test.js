'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { loadSeeds, validateSeeds } = require('../../server/seed-loader');

test('bundled seeds load and validate cleanly', () => {
  const seeds = loadSeeds(path.resolve(__dirname, '../../shared/seeds'));

  assert.equal(seeds.activity.name, '东方南堂界域 V');
  assert.equal(seeds.teams.length, 2);
  assert.equal(seeds.regions.length, 6);
  assert.ok(seeds.interactions.length >= 4);
  assert.ok(seeds.prizes.length >= 6);

  const regions = [...seeds.regions].sort((a, b) => a.order - b.order);
  assert.deepEqual(
    regions.map((region) => region.name),
    ['思源门', '思源湖', '凯旋门', '电草', '涵泽湖', '行政楼']
  );

  const unlockChain = regions.slice(1).map((region) => region.unlock_after[0]);
  assert.deepEqual(unlockChain, regions.slice(0, -1).map((region) => region.id));
});

test('validateSeeds reports broken references', () => {
  const problems = validateSeeds({
    activity: { name: 'x', energy_cap: 5, energy_regen_interval_sec: 60, team_join_max_diff: 10 },
    teams: [
      { id: 'reimu', name: '灵梦队' },
      { id: 'marisa', name: '魔理沙队' }
    ],
    regions: [
      { id: 'a', name: 'A', order: 1, max_anomaly: 100, map: { x: 1, y: 2 }, unlock_after: ['ghost'], prize_ids: ['nope'] }
    ],
    interactions: [
      { id: 'act', outcomes: [{ weight: -1, contribution: [10, 5] }], team_restriction: 'unknown', regions: ['ghost2'] }
    ],
    prizes: [
      { id: 'p1', name: 'P', source: 'nowhere', count: 1 }
    ],
    lottery: {
      code_type_base_weights: { ordinary: 1 },
      contribution_bonus_tiers: [{ min_total: 0 }],
      region_rank_bonus: [{ bonus: 1 }],
      region_rank_bonus_scope: 'sometimes'
    },
    titles: [{ min_contribution: 0, title: 'T' }]
  });

  const joined = problems.join('\n');
  assert.match(joined, /ghost/);
  assert.match(joined, /nope/);
  assert.match(joined, /unknown/);
  assert.match(joined, /nowhere/);
  assert.match(joined, /contribution_bonus_tiers/);
  assert.match(joined, /region_rank_bonus/);
  assert.match(joined, /region_rank_bonus_scope/);
});
