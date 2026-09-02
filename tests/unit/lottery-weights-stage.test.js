'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createFixture } = require('../helpers/fixture');
const weights = require('../../server/domain/weights');
const regions = require('../../server/domain/regions');
const lottery = require('../../server/domain/lottery');
const stage = require('../../server/domain/stage');
const contributions = require('../../server/domain/contributions');

test('base weight prefers stored base and falls back to code type', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  const config = fixture.seeds.lottery;

  assert.equal(weights.calcBaseWeight(user, config), 1);
  user.weight_base = 0; // 模拟旧数据缺权重：回落到票种配置
  user.code_type = 'special';
  assert.equal(weights.calcBaseWeight(user, config), 2);

  user.code_type = 'ordinary';
  assert.equal(weights.calcContributionBonus(0, config.contribution_bonus_tiers), 0);
  assert.equal(weights.calcContributionBonus(999, config.contribution_bonus_tiers), 0);
  assert.equal(weights.calcContributionBonus(1000, config.contribution_bonus_tiers), 0.5);
  assert.equal(weights.calcContributionBonus(10000, config.contribution_bonus_tiers), 3);
});

test('region rank bonus counts only cleared regions by default', () => {
  const fixture = createFixture({ userCount: 3 });
  const [top, second, elsewhere] = fixture.registered;
  const config = fixture.seeds.lottery;
  const first = fixture.seeds.regions[0];
  const secondRegion = fixture.seeds.regions[1];

  top.region_contributions[first.id] = 900;
  second.region_contributions[first.id] = 500;
  elsewhere.region_contributions[secondRegion.id] = 4000; // 未解锁区域也有贡献

  assert.equal(weights.calcRegionRankBonus(fixture.state, top, config), 0, '未 CLEAR 前不计名次加成');
  assert.equal(weights.calcRegionRankBonus(fixture.state, elsewhere, config), 0);

  regions.reduceAnomaly(fixture.state, first, first.max_anomaly, fixture.now);
  assert.equal(weights.calcRegionRankBonus(fixture.state, top, config), 3);
  assert.equal(weights.calcRegionRankBonus(fixture.state, second, config), 2);
  assert.equal(weights.calcRegionRankBonus(fixture.state, elsewhere, config), 0);
});

test('calculateUserWeight combines base, tiers, rank bonus and admin override with floor', () => {
  const fixture = createFixture({ userCount: 2 });
  const [user] = fixture.registered;
  const config = fixture.seeds.lottery;
  const first = fixture.seeds.regions[0];

  user.region_contributions[first.id] = 100;
  regions.reduceAnomaly(fixture.state, first, first.max_anomaly, fixture.now);
  user.total_contribution = 3500;

  // base 1 + contribution 1 + rank 3 = 5
  assert.equal(weights.calculateUserWeight(fixture.state, user, config), 5);

  user.weight_override = -10; // 触发下限
  assert.equal(weights.calculateUserWeight(fixture.state, user, config), config.min_weight);

  user.weight_override = 0.5;
  assert.equal(weights.calculateUserWeight(fixture.state, user, config), 5.5);
});

test('prizes stay locked until their region clears; base pool always available', () => {
  const fixture = createFixture({ userCount: 2 });
  const first = fixture.seeds.regions[0];

  let statuses = lottery.listPrizesWithStatus(fixture.state, fixture.seeds);
  assert.equal(statuses.find((prize) => prize.source === 'base').available, true);
  assert.equal(statuses.find((prize) => prize.source === first.id).available, false);

  regions.reduceAnomaly(fixture.state, first, first.max_anomaly, fixture.now);
  statuses = lottery.listPrizesWithStatus(fixture.state, fixture.seeds);
  assert.equal(statuses.find((prize) => prize.source === first.id).available, true);
  assert.equal(statuses.find((prize) => prize.source === first.id).remaining, 1);
});

test('drawPrize records snapshot and respects repeat-winner policy', () => {
  const fixture = createFixture({ userCount: 3 });
  const [a, b] = fixture.registered;
  a.total_contribution = 10000; // 权重 1 + 3
  b.total_contribution = 3000;  // 权重 1 + 1

  const poolBefore = lottery.buildEligiblePool(fixture.state, fixture.seeds, { preventRepeatWinners: true });
  assert.equal(poolBefore.length, 3);

  const firstDraw = lottery.drawPrize(fixture.state, 'prize_base_bookmark', fixture.seeds, fixture.now);
  assert.ok(!firstDraw.error, firstDraw.message);
  assert.ok(firstDraw.draw.weight_snapshot >= 1);
  assert.equal(firstDraw.draw.status, 'pending');
  const winner = firstDraw.winner;

  // 默认 prevent_repeat_winners：已中奖玩家退出候选池
  const poolAfter = lottery.buildEligiblePool(fixture.state, fixture.seeds, { preventRepeatWinners: true });
  assert.equal(poolAfter.length, 2);
  assert.ok(!poolAfter.some((item) => item.user.id === winner.id));

  const secondDraw = lottery.drawPrize(fixture.state, 'prize_base_bookmark', fixture.seeds, fixture.now);
  assert.ok(!secondDraw.error, secondDraw.message);
  assert.notEqual(secondDraw.winner.id, winner.id);

  // 作废后重新进入候选池，占坑释放；首个赢家仍持有有效记录
  lottery.voidDraw(fixture.state, secondDraw.draw.id, '测试作废', fixture.now);
  const poolAfterVoid = lottery.buildEligiblePool(fixture.state, fixture.seeds, { preventRepeatWinners: true });
  assert.equal(poolAfterVoid.length, 2);
  assert.ok(poolAfterVoid.some((item) => item.user.id === secondDraw.winner.id), '被作废者重新可选');
  assert.ok(!poolAfterVoid.some((item) => item.user.id === winner.id), '首个赢家仍被排除');
  const status = lottery.listPrizesWithStatus(fixture.state, fixture.seeds)
    .find((prize) => prize.id === 'prize_base_bookmark');
  assert.equal(status.drawn, 1);
  assert.equal(status.remaining, 1);
});

test('drawPrize rejects locked and exhausted prizes', () => {
  const fixture = createFixture({ userCount: 2 });
  const locked = lottery.drawPrize(fixture.state, 'prize_admin_building', fixture.seeds, fixture.now);
  assert.equal(locked.error, 'PRIZE_LOCKED');

  const unknown = lottery.drawPrize(fixture.state, 'nope', fixture.seeds, fixture.now);
  assert.equal(unknown.error, 'PRIZE_NOT_FOUND');
});

test('markClaimed and voidDraw update draw lifecycle', () => {
  const fixture = createFixture({ userCount: 2 });
  const draw = lottery.drawPrize(fixture.state, 'prize_base_bookmark', fixture.seeds, fixture.now);

  const claimed = lottery.markClaimed(fixture.state, draw.draw.id, fixture.now);
  assert.equal(claimed.draw.status, 'claimed');

  // 已领取的奖品也允许作废（现场发错奖时需要）
  const voided = lottery.voidDraw(fixture.state, draw.draw.id, '发错奖', fixture.now + 10);
  assert.equal(voided.draw.status, 'void');
  assert.equal(voided.draw.void_reason, '发错奖');

  const voidAgain = lottery.voidDraw(fixture.state, draw.draw.id, '重复', fixture.now + 11);
  assert.equal(voidAgain.error, 'NO_CHANGE');

  const another = lottery.drawPrize(fixture.state, 'prize_base_postcard', fixture.seeds, fixture.now + 20);
  const voided2 = lottery.voidDraw(fixture.state, another.draw.id, '测试', fixture.now + 30);
  assert.equal(voided2.draw.status, 'void');
});

test('stage team_contribution grants each member and the team pool', () => {
  const fixture = createFixture({ userCount: 4 });
  const event = stage.getStageEvent(fixture.seeds, 'stg_reimu_win');
  const reimuMembers = fixture.registered.filter((user) => user.team === 'reimu');
  const beforeTotals = Object.fromEntries(
    reimuMembers.map((user) => [user.id, user.total_contribution])
  );
  const teamBefore = fixture.state.teams.reimu.total_contribution;

  const result = stage.triggerStageEvent(fixture.state, event, fixture.ctx);
  assert.ok(!result.error, result.message);

  for (const member of reimuMembers) {
    assert.equal(member.total_contribution, beforeTotals[member.id] + 1500);
  }
  assert.equal(fixture.state.teams.reimu.total_contribution, teamBefore + 1500 * reimuMembers.length);
  assert.equal(result.ledger_entries.length, reimuMembers.length);
});

test('stage team_pool_contribution only affects the team total', () => {
  const fixture = createFixture({ userCount: 2 });
  const event = stage.getStageEvent(fixture.seeds, 'quiz_bonus_marisa');
  const marisaUser = fixture.registered.find((user) => user.team === 'marisa');
  const personalBefore = marisaUser.total_contribution;
  const teamBefore = fixture.state.teams.marisa.total_contribution;

  const result = stage.triggerStageEvent(fixture.state, event, fixture.ctx);
  assert.ok(!result.error);
  assert.equal(marisaUser.total_contribution, personalBefore);
  assert.equal(fixture.state.teams.marisa.total_contribution, teamBefore + 3000);
});

test('stage reduce_anomaly and unlock_region affect region runtime', () => {
  const fixture = createFixture();
  const weaken = stage.getStageEvent(fixture.seeds, 'weaken_siyuan_gate');
  const result = stage.triggerStageEvent(fixture.state, weaken, fixture.ctx);
  assert.ok(!result.error);
  assert.equal(fixture.state.regions.siyuan_gate.anomaly_remaining, 10000 - 2000);

  const unlock = stage.getStageEvent(fixture.seeds, 'unlock_hanze_early');
  const unlockResult = stage.triggerStageEvent(fixture.state, unlock, fixture.ctx);
  assert.ok(!unlockResult.error);
  assert.equal(fixture.state.regions.hanze_lake.forced_unlock, true);
  const regionsStatus = regions.deriveStatus(fixture.state, fixture.seeds.regions[4]);
  assert.equal(regionsStatus, 'available');
});

test('ledger file roundtrip tolerates corrupt tails', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntjv-ledger-'));
  try {
    const entries = [
      contributions.buildLedgerEntry({ kind: 'interaction', user_delta: 100 }, 1),
      contributions.buildLedgerEntry({ kind: 'admin', user_delta: -10 }, 2)
    ];
    const fileName = 'ledger.jsonl';
    fs.writeFileSync(
      path.join(dataDir, fileName),
      entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n{"broken'
    );
    const parsed = contributions.readLedgerFile(dataDir, fileName);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].user_delta, 100);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('applyContribution never drives totals negative', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  contributions.applyContribution(
    fixture.state,
    contributions.buildLedgerEntry({
      kind: 'admin',
      user_id: user.id,
      team: user.team,
      reason: '修正',
      user_delta: -100,
      team_delta: -100
    }, fixture.now)
  );
  assert.equal(user.total_contribution, 0);
  assert.equal(fixture.state.teams.reimu.total_contribution, 0);
});
