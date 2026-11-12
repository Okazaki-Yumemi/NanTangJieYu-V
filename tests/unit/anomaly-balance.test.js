'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('../helpers/fixture');
const { normalizeState } = require('../../server/domain/state');

test('all six anomaly caps are halved, fresh games and repeated normalization keep the new caps', () => {
  const { state, seeds } = createFixture();
  assert.deepEqual(seeds.regions.map(region => region.max_anomaly), [100000, 145000, 180000, 210000, 230000, 260000]);
  normalizeState(state, seeds); normalizeState(state, seeds);
  for (const region of seeds.regions) assert.equal(state.regions[region.id].anomaly_remaining, region.max_anomaly);
});
test('legacy remaining anomaly halves once while contribution, clears, unlocks and progress survive', () => {
  const { state, seeds } = createFixture({ userCount: 1 });
  const player = Object.values(state.users)[0]; player.total_contribution = 12345;
  for (const region of seeds.regions) {
    const runtime = state.regions[region.id];
    delete runtime.anomaly_balance_version;
    runtime.anomaly_remaining = region.max_anomaly * 2 * .6;
    runtime.participant_ids = [player.id];
  }
  state.regions.siyuan_gate.cleared = true; state.regions.siyuan_gate.cleared_at = 123;
  state.regions.siyuan_lake.forced_unlock = true;
  state.regions.admin_building.anomaly_remaining = 1;
  normalizeState(state, seeds);
  assert.equal(state.regions.siyuan_gate.anomaly_remaining, 0);
  assert.equal(state.regions.siyuan_gate.cleared_at, 123);
  assert.equal(state.regions.siyuan_lake.anomaly_remaining, 87000);
  assert.equal(state.regions.siyuan_lake.forced_unlock, true);
  assert.deepEqual(state.regions.siyuan_lake.participant_ids, [player.id]);
  assert.equal(state.regions.admin_building.anomaly_remaining, 1, 'rounding does not auto-clear a region');
  assert.equal(player.total_contribution, 12345);
  const restored = JSON.parse(JSON.stringify(state)); normalizeState(restored, seeds);
  assert.deepEqual(restored.regions, state.regions);
});
