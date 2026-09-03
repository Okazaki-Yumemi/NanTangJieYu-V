'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createFixture } = require('../helpers/fixture');
const weights = require('../../server/domain/weights');
const regions = require('../../server/domain/regions');
const lottery = require('../../server/domain/lottery');
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
  assert.equal(weights.calcContributionBonus(4999, config.contribution_bonus_tiers), 0);
  assert.equal(weights.calcContributionBonus(5000, config.contribution_bonus_tiers), 0.5);
  assert.equal(weights.calcContributionBonus(12000, config.contribution_bonus_tiers), 1);
  assert.equal(weights.calcContributionBonus(35000, config.contribution_bonus_tiers), 3);
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
  user.total_contribution = 13000;

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

test('drawPrize allows repeat winners across prizes but not the same prize', () => {
  const fixture = createFixture({ userCount: 3 });
  const [a, b] = fixture.registered;
  a.total_contribution = 10000; // 权重 1 + 3
  b.total_contribution = 3000;  // 权重 1 + 1

  const poolBefore = lottery.buildEligiblePool(
    fixture.state,
    fixture.seeds,
    { preventRepeatWinners: true, prizeId: 'prize_base_bookmark' }
  );
  assert.equal(poolBefore.length, 3);

  const firstDraw = lottery.drawPrize(fixture.state, 'prize_base_bookmark', fixture.seeds, fixture.now);
  assert.ok(!firstDraw.error, firstDraw.message);
  assert.ok(firstDraw.draw.weight_snapshot >= 1);
  assert.equal(firstDraw.draw.status, 'pending');
  const winner = firstDraw.winner;

  // 同一奖品：已中奖玩家退出候选池
  const poolAfterSamePrize = lottery.buildEligiblePool(
    fixture.state,
    fixture.seeds,
    { preventRepeatWinners: true, prizeId: 'prize_base_bookmark' }
  );
  assert.equal(poolAfterSamePrize.length, 2);
  assert.ok(!poolAfterSamePrize.some((item) => item.user.id === winner.id));

  // 不同奖品：同一玩家仍然可以再次进入候选池
  const poolForOtherPrize = lottery.buildEligiblePool(
    fixture.state,
    fixture.seeds,
    { preventRepeatWinners: true, prizeId: 'prize_base_postcard' }
  );
  assert.equal(poolForOtherPrize.length, 3);
  assert.ok(poolForOtherPrize.some((item) => item.user.id === winner.id));
  assert.equal(lottery.hasActiveWinForPrize(fixture.state, winner.id, 'prize_base_bookmark'), true);
  assert.equal(lottery.hasActiveWinForPrize(fixture.state, winner.id, 'prize_base_postcard'), false);

  const secondDraw = lottery.drawPrize(fixture.state, 'prize_base_bookmark', fixture.seeds, fixture.now);
  assert.ok(!secondDraw.error, secondDraw.message);
  assert.notEqual(secondDraw.winner.id, winner.id);

  // 作废后重新进入同一奖品候选池，占坑释放；首个赢家仍持有有效记录
  lottery.voidDraw(fixture.state, secondDraw.draw.id, '测试作废', fixture.now);
  const poolAfterVoid = lottery.buildEligiblePool(
    fixture.state,
    fixture.seeds,
    { preventRepeatWinners: true, prizeId: 'prize_base_bookmark' }
  );
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

test('draw lifecycle: confirm before claim, void frees winner', () => {
  const fixture = createFixture({ userCount: 2 });
  const draw = lottery.drawPrize(fixture.state, 'prize_base_bookmark', fixture.seeds, fixture.now);

  // 未确认不能直接领取
  const premature = lottery.markClaimed(fixture.state, draw.draw.id, fixture.now);
  assert.equal(premature.error, 'NO_CHANGE');

  const confirmed = lottery.markConfirmed(fixture.state, draw.draw.id, fixture.now + 5);
  assert.equal(confirmed.draw.status, 'confirmed');

  const claimed = lottery.markClaimed(fixture.state, draw.draw.id, fixture.now + 10);
  assert.equal(claimed.draw.status, 'claimed');

  // 已领取的奖品也允许作废（现场发错奖时需要）
  const voided = lottery.voidDraw(fixture.state, draw.draw.id, '发错奖', fixture.now + 20);
  assert.equal(voided.draw.status, 'void');
  assert.equal(voided.draw.void_reason, '发错奖');

  const voidAgain = lottery.voidDraw(fixture.state, draw.draw.id, '重复', fixture.now + 21);
  assert.equal(voidAgain.error, 'NO_CHANGE');

  const another = lottery.drawPrize(fixture.state, 'prize_base_postcard', fixture.seeds, fixture.now + 30);
  const voided2 = lottery.voidDraw(fixture.state, another.draw.id, '测试', fixture.now + 40);
  assert.equal(voided2.draw.status, 'void');
});

test('latestDraw returns the most recent non-void draw', () => {
  const fixture = createFixture({ userCount: 3 });
  const first = lottery.drawPrize(fixture.state, 'prize_base_bookmark', fixture.seeds, fixture.now);
  const second = lottery.drawPrize(fixture.state, 'prize_base_postcard', fixture.seeds, fixture.now + 10);
  lottery.voidDraw(fixture.state, second.draw.id, '不在场', fixture.now + 20);

  const latest = lottery.latestDraw(fixture.state, fixture.seeds);
  assert.equal(latest.id, first.draw.id);
  assert.equal(latest.status, 'pending');
  assert.ok(latest.prize_name);
  assert.ok(latest.winner_display_name);
});

test('admin can add and edit prizes at runtime', () => {
  const fixture = createFixture({ userCount: 2 });
  const added = lottery.addCustomPrize(
    fixture.state,
    fixture.seeds,
    { name: '现场加赠・神秘色纸', source: 'base', count: 2 },
    fixture.now
  );
  assert.ok(!added.error, added.message);
  assert.equal(added.prize.custom, true);
  assert.equal(added.prize.count, 2);

  // 目录包含自定义奖品，且立即可抽
  const catalog = lottery.getPrizeCatalog(fixture.state, fixture.seeds);
  assert.ok(catalog.some((prize) => prize.id === added.prize.id));
  const drawn = lottery.drawPrize(fixture.state, added.prize.id, fixture.seeds, fixture.now + 1);
  assert.ok(!drawn.error, drawn.message);

  // 修改种子奖品走覆盖表，不破坏原始定义
  const target = fixture.seeds.prizes[0].id;
  const updated = lottery.updatePrize(
    fixture.state,
    fixture.seeds,
    target,
    { name: '现场确认的真实奖品', count: 3 }
  );
  assert.ok(!updated.error, updated.message);
  assert.equal(updated.previous.name, fixture.seeds.prizes[0].name);
  const merged = lottery.getPrize(fixture.state, fixture.seeds, target);
  assert.equal(merged.name, '现场确认的真实奖品');
  assert.equal(merged.count, 3);
  assert.equal(fixture.seeds.prizes[0].name, updated.previous.name, '种子定义保持不变');

  // 非法输入被拒绝
  assert.ok(lottery.addCustomPrize(fixture.state, fixture.seeds, { name: '  ' }, fixture.now).error);
  assert.ok(lottery.addCustomPrize(fixture.state, fixture.seeds, { name: 'X', count: 0 }, fixture.now).error);
  assert.ok(lottery.addCustomPrize(fixture.state, fixture.seeds, { name: 'X', source: 'ghost' }, fixture.now).error);
  assert.equal(lottery.updatePrize(fixture.state, fixture.seeds, 'nope', { name: 'X' }).error, 'PRIZE_NOT_FOUND');
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
