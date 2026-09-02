'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createFixture, performInteract } = require('../helpers/fixture');
const interactions = require('../../server/domain/interactions');
const { ACTIVITY_STATUS } = require('../../shared/constants');

function interact(fixture, user, overrides = {}) {
  return performInteract(fixture, user, {
    regionId: 'siyuan_gate',
    actionId: 'investigate',
    ...overrides
  });
}

test('interaction applies contribution to user, region and team, and reduces anomaly', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  const before = fixture.state.regions.siyuan_gate.anomaly_remaining;

  const result = interact(fixture, user, { requestId: 'req-1' });
  assert.ok(!result.error, result.message);
  assert.ok(result.action_result.contribution_gain > 0);
  assert.ok(result.action_result.anomaly_reduction > 0);

  assert.equal(user.total_contribution, result.action_result.contribution_gain);
  assert.equal(user.region_contributions.siyuan_gate, result.action_result.contribution_gain);
  assert.equal(fixture.state.teams.reimu.total_contribution, result.action_result.contribution_gain);
  assert.equal(
    fixture.state.regions.siyuan_gate.anomaly_remaining,
    before - result.action_result.anomaly_reduction
  );
  assert.ok(fixture.state.regions.siyuan_gate.participant_ids.includes(user.id));

  const ledger = fixture.state.contribution_log.at(-1);
  assert.equal(ledger.user_id, user.id);
  assert.equal(ledger.region_id, 'siyuan_gate');
  assert.equal(ledger.user_delta, result.action_result.contribution_gain);
  assert.equal(ledger.request_id, 'req-1');
});

test('duplicate client_request_id returns first result without double counting', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];

  const first = interact(fixture, user, { requestId: 'same-req' });
  assert.ok(!first.error);
  const contributionAfterFirst = user.total_contribution;

  const second = interact(fixture, user, { requestId: 'same-req' });
  assert.ok(second.duplicate);
  assert.deepEqual(second.action_result, first.action_result);
  assert.equal(user.total_contribution, contributionAfterFirst);
  assert.equal(fixture.state.contribution_log.length, 1);
});

test('energy is consumed and regen state stays consistent', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  assert.equal(user.energy, 5);

  interact(fixture, user, { requestId: 'e1' });
  assert.equal(user.energy, 4);

  interact(fixture, user, { requestId: 'e2', actionId: 'deep_scan' });
  assert.equal(user.energy, 2);
});

test('insufficient energy is rejected without state changes', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  user.energy = 1;

  const result = interact(fixture, user, { requestId: 'big', actionId: 'deep_scan' });
  assert.equal(result.error, 'ENERGY_NOT_ENOUGH');
  assert.equal(user.energy, 1);
  assert.equal(user.total_contribution, 0);
});

test('cooldown blocks repeated special interactions', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];

  const first = interact(fixture, user, { requestId: 'c1', actionId: 'deep_scan' });
  assert.ok(!first.error);
  const second = interact(fixture, user, { requestId: 'c2', actionId: 'deep_scan' });
  assert.equal(second.error, 'COOLDOWN_ACTIVE');
  assert.ok(second.retry_in_sec > 0);

  const later = interact(fixture, user, { requestId: 'c3', actionId: 'deep_scan', now: fixture.now + 301 });
  assert.ok(!later.error, later.message);
});

test('team restriction blocks the other team', () => {
  const fixture = createFixture({ userCount: 2 });
  const reimuUser = fixture.registered[0];
  const marisaUser = fixture.registered[1];

  assert.ok(!interact(fixture, reimuUser, { requestId: 't1', actionId: 'ask_reimu' }).error);
  const blocked = interact(fixture, marisaUser, { requestId: 't2', actionId: 'ask_reimu' });
  assert.equal(blocked.error, 'INTERACTION_UNAVAILABLE');

  assert.ok(!interact(fixture, marisaUser, { requestId: 't3', actionId: 'ask_marisa' }).error);
});

test('region restrictions: locked / closed / cleared regions reject interactions', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];

  const locked = interact(fixture, user, { requestId: 'r1', regionId: 'admin_building' });
  assert.equal(locked.error, 'REGION_LOCKED');

  fixture.state.regions.siyuan_gate.closed = true;
  const closed = interact(fixture, user, { requestId: 'r2' });
  assert.equal(closed.error, 'REGION_CLOSED');
  fixture.state.regions.siyuan_gate.closed = false;

  fixture.state.regions.siyuan_gate.cleared = true;
  fixture.state.regions.siyuan_gate.anomaly_remaining = 0;
  const cleared = interact(fixture, user, { requestId: 'r3' });
  assert.equal(cleared.error, 'REGION_CLEARED');
});

test('interaction that reduces anomaly to zero clears the region', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  fixture.state.regions.siyuan_gate.anomaly_remaining = 10;

  const result = interact(fixture, user, { requestId: 'clear' });
  assert.ok(!result.error);
  assert.equal(result.action_result.region_just_cleared, true);
  assert.equal(fixture.state.regions.siyuan_gate.cleared, true);
  assert.equal(fixture.state.regions.siyuan_lake.unlocked_at > 0 || fixture.state.regions.siyuan_lake.forced_unlock, false);
  // 下一区域此时应已解锁（解锁是推导值）
  const regions = require('../../server/domain/regions');
  const second = fixture.seeds.regions[1];
  assert.equal(regions.deriveStatus(fixture.state, second), 'available');
});

test('interactions are blocked unless activity is running', () => {
  const fixture = createFixture({ userCount: 1, running: false });
  fixture.state.activity.status = ACTIVITY_STATUS.PAUSED;
  const result = interact(fixture, fixture.registered[0], { requestId: 'x' });
  assert.equal(result.error, 'ACTIVITY_NOT_RUNNING');
});

test('rate limiter rejects burst requests within window', () => {
  const fixture = createFixture({ userCount: 1, rateLimitMs: 400 });
  const user = fixture.registered[0];
  interactions.resetRateLimiter();

  const first = interact(fixture, user, { requestId: 'burst-1' });
  assert.ok(!first.error);
  const second = interact(fixture, user, { requestId: 'burst-2', now: fixture.now });
  assert.equal(second.error, 'RATE_LIMITED');

  const afterWindow = interact(fixture, user, { requestId: 'burst-3', now: fixture.now + 1 });
  assert.ok(!afterWindow.error, afterWindow.message);
  interactions.resetRateLimiter();
});

test('lake_netting only applies to lake regions', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  const wrong = interact(fixture, user, { requestId: 'l1', actionId: 'lake_netting' });
  assert.equal(wrong.error, 'INTERACTION_UNAVAILABLE');

  // 解锁思源湖后再试
  fixture.state.regions.siyuan_gate.cleared = true;
  fixture.state.regions.siyuan_gate.anomaly_remaining = 0;
  const right = interact(fixture, user, { requestId: 'l2', actionId: 'lake_netting', regionId: 'siyuan_lake' });
  assert.ok(!right.error, right.message);
  assert.equal(user.region_contributions.siyuan_lake, right.action_result.contribution_gain);
});
