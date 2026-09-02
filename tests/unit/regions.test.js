'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createFixture } = require('../helpers/fixture');
const regions = require('../../server/domain/regions');

test('unlock chain: only first region is available initially', () => {
  const fixture = createFixture();
  const statuses = fixture.seeds.regions.map((region) => regions.deriveStatus(fixture.state, region));
  assert.deepEqual(statuses, [
    'available',
    'locked',
    'locked',
    'locked',
    'locked',
    'locked'
  ]);
});

test('clearing a region unlocks the next one and flips status', () => {
  const fixture = createFixture();
  const first = fixture.seeds.regions[0];
  const second = fixture.seeds.regions[1];

  regions.reduceAnomaly(fixture.state, first, first.max_anomaly, fixture.now);
  assert.equal(regions.deriveStatus(fixture.state, first), 'cleared');
  assert.equal(regions.deriveStatus(fixture.state, second), 'available');
  assert.ok(fixture.state.regions[second.id].unlocked_at > 0 || regions.isRegionUnlocked(fixture.state, second));
});

test('reduceAnomaly clamps and marks cleared exactly once', () => {
  const fixture = createFixture();
  const first = fixture.seeds.regions[0];

  const partial = regions.reduceAnomaly(fixture.state, first, 1000, fixture.now);
  assert.equal(partial.actual_reduction, 1000);
  assert.equal(partial.just_cleared, false);
  assert.equal(fixture.state.regions[first.id].anomaly_remaining, first.max_anomaly - 1000);
  assert.equal(regions.deriveStatus(fixture.state, first), 'investigating');

  const overflow = regions.reduceAnomaly(fixture.state, first, first.max_anomaly * 10, fixture.now);
  assert.equal(overflow.actual_reduction, first.max_anomaly - 1000);
  assert.equal(overflow.just_cleared, true);
  assert.equal(fixture.state.regions[first.id].anomaly_remaining, 0);

  const again = regions.reduceAnomaly(fixture.state, first, 500, fixture.now);
  assert.equal(again.just_cleared, false);
  assert.equal(fixture.state.system_events.filter((event) => event.kind === 'region_cleared').length, 1);
});

test('admin setAnomaly can reopen a cleared region', () => {
  const fixture = createFixture();
  const first = fixture.seeds.regions[0];
  regions.reduceAnomaly(fixture.state, first, first.max_anomaly, fixture.now);
  assert.equal(regions.deriveStatus(fixture.state, first), 'cleared');

  const result = regions.setAnomaly(fixture.state, first, 5000, fixture.now);
  assert.ok(!result.error);
  assert.equal(fixture.state.regions[first.id].cleared, false);
  assert.equal(regions.deriveStatus(fixture.state, first), 'investigating');
});

test('setAnomaly validates range', () => {
  const fixture = createFixture();
  const first = fixture.seeds.regions[0];
  assert.ok(regions.setAnomaly(fixture.state, first, -1, fixture.now).error);
  assert.ok(regions.setAnomaly(fixture.state, first, first.max_anomaly + 1, fixture.now).error);
  assert.ok(regions.setAnomaly(fixture.state, first, 'abc', fixture.now).error);
});

test('forced unlock opens a region before its prerequisites', () => {
  const fixture = createFixture();
  const third = fixture.seeds.regions[2];
  assert.equal(regions.deriveStatus(fixture.state, third), 'locked');

  regions.setForcedUnlock(fixture.state, third, true, fixture.now);
  assert.equal(regions.deriveStatus(fixture.state, third), 'available');

  regions.setClosed(fixture.state, third, true, fixture.now);
  const interactionCheck = require('../../server/domain/interactions').checkRegionUsable(
    fixture.state,
    third,
    fixture.ctx
  );
  assert.equal(interactionCheck.error, 'REGION_CLOSED');
});

test('region leaderboard ranks by regional contribution', () => {
  const fixture = createFixture({ userCount: 3 });
  const [a, b, c] = fixture.registered;
  a.region_contributions.siyuan_gate = 500;
  b.region_contributions.siyuan_gate = 900;
  c.region_contributions.siyuan_lake = 300;

  const board = regions.buildRegionLeaderboard(fixture.state, 'siyuan_gate', 10);
  assert.deepEqual(board.map((row) => row.user_id), [b.id, a.id]);
  assert.equal(board[0].rank, 1);

  assert.equal(regions.getUserRegionRank(fixture.state, 'siyuan_gate', b.id), 1);
  assert.equal(regions.getUserRegionRank(fixture.state, 'siyuan_gate', a.id), 2);
  assert.equal(regions.getUserRegionRank(fixture.state, 'siyuan_gate', c.id), null);
});

test('region view exposes derived status and prize availability', () => {
  const fixture = createFixture();
  const first = fixture.seeds.regions[0];
  const view = regions.buildRegionView(fixture.state, first, fixture.seeds, fixture.ctx);
  assert.equal(view.status, 'available');
  assert.equal(view.anomaly_remaining, first.max_anomaly);
  assert.equal(view.prizes_available, false);

  regions.reduceAnomaly(fixture.state, first, first.max_anomaly, fixture.now);
  const clearedView = regions.buildRegionView(fixture.state, first, fixture.seeds, fixture.ctx);
  assert.equal(clearedView.status, 'cleared');
  assert.equal(clearedView.prizes_available, true);
  assert.equal(clearedView.anomaly_progress, 1);
});
