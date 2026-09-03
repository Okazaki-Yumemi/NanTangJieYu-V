'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createFixture } = require('../helpers/fixture');
const players = require('../../server/domain/players');
const codes = require('../../server/domain/codes');
const regions = require('../../server/domain/regions');
const weights = require('../../server/domain/weights');

test('rename validates uniqueness and sensitive words', () => {
  const fixture = createFixture({ userCount: 2 });
  const [a, b] = fixture.registered;

  const ok = players.renamePlayer(fixture.state, a, '新的名字', fixture.seeds);
  assert.ok(!ok.error, ok.message);
  assert.equal(a.display_name, '新的名字');
  assert.equal(a.display_name_lower, '新的名字');

  const duplicate = players.renamePlayer(fixture.state, a, '测试玩家2', fixture.seeds);
  assert.equal(duplicate.error, 'DUPLICATE_DISPLAY_NAME');

  const sensitive = players.renamePlayer(fixture.state, a, '习近平观看异变', fixture.seeds);
  assert.equal(sensitive.error, 'VALIDATION_FAILED');

  const porn = players.renamePlayer(fixture.state, a, '色情内容测试', fixture.seeds);
  assert.equal(porn.error, 'VALIDATION_FAILED');

  const abuse = players.renamePlayer(fixture.state, a, '你是傻逼吗', fixture.seeds);
  assert.equal(abuse.error, 'VALIDATION_FAILED');

  const separatorTrick = players.renamePlayer(fixture.state, a, '傻.逼', fixture.seeds);
  assert.equal(separatorTrick.error, 'VALIDATION_FAILED');

  // 保留自己原来的名字（大小写不敏感）应当允许
  const same = players.renamePlayer(fixture.state, a, '新的名字', fixture.seeds);
  assert.ok(!same.error, same.message);
});

test('switch team moves member count and personal contribution', () => {
  const fixture = createFixture({ userCount: 2 });
  const [reimuUser] = fixture.registered;
  reimuUser.total_contribution = 500;
  fixture.state.teams.reimu.total_contribution = 500;

  const result = players.switchTeam(fixture.state, reimuUser, 'marisa');
  assert.ok(!result.error, result.message);
  assert.equal(reimuUser.team, 'marisa');
  assert.equal(fixture.state.teams.reimu.member_count, 0);
  assert.equal(fixture.state.teams.marisa.member_count, 2);
  assert.equal(fixture.state.teams.reimu.total_contribution, 0);
  assert.equal(fixture.state.teams.marisa.total_contribution, 500);
  assert.equal(result.moved_contribution, 500);

  const same = players.switchTeam(fixture.state, reimuUser, 'marisa');
  assert.equal(same.error, 'NO_CHANGE');
});

test('force logout removes every session of the player', () => {
  const fixture = createFixture({ userCount: 2 });
  const [user, other] = fixture.registered;
  const s1 = players.createSession(fixture.state, user.id, fixture.now);
  const s2 = players.createSession(fixture.state, user.id, fixture.now);
  const outsider = players.createSession(fixture.state, other.id, fixture.now);

  const removed = players.forceLogout(fixture.state, user.id);
  assert.equal(removed, 2);
  assert.equal(players.getSessionUser(fixture.state, s1.session_id), null);
  assert.equal(players.getSessionUser(fixture.state, s2.session_id), null);
  assert.equal(players.getSessionUser(fixture.state, outsider.session_id).id, other.id, '其他会话不受影响');
});

test('rebind code retires the old code and switches type weight base', () => {
  const fixture = createFixture({ userCount: 1 });
  const user = fixture.registered[0];
  const generated = codes.generateCodes(fixture.state, { count: 1, type: 'special' }, fixture.now);
  const newCode = generated.created[0];
  const oldCodeEntry = fixture.state.codes[user.code];

  const result = codes.rebindPlayerCode(fixture.state, user, newCode.code, fixture.seeds, fixture.now + 1);
  assert.ok(!result.error, result.message);
  assert.equal(user.code, newCode.code);
  assert.equal(user.code_type, 'special');
  assert.equal(user.weight_base, 2);
  assert.equal(oldCodeEntry.disabled, true, '旧码退役');
  assert.equal(oldCodeEntry.status, 'bound', '旧码保留绑定历史');

  // 旧码不能再用
  const reuse = players.registerPlayer(
    fixture.state,
    { code: oldCodeEntry.code, display_name: '捡码的人', password: 'pass1234', team: 'marisa' },
    { seeds: fixture.seeds },
    fixture.now + 2
  );
  assert.equal(reuse.error, 'CODE_DISABLED');
});

test('rank bonus follows the player after a team switch', () => {
  const fixture = createFixture({ userCount: 3 });
  const [top] = fixture.registered;
  const first = fixture.seeds.regions[0];
  top.region_contributions[first.id] = 100;
  regions.reduceAnomaly(fixture.state, first, first.max_anomaly, fixture.now);
  top.total_contribution = 13000;
  assert.equal(weights.calculateUserWeight(fixture.state, top, fixture.seeds.lottery), 5);

  players.switchTeam(fixture.state, top, top.team === 'reimu' ? 'marisa' : 'reimu');
  assert.equal(weights.calculateUserWeight(fixture.state, top, fixture.seeds.lottery), 5, '权重与阵营无关');
});
