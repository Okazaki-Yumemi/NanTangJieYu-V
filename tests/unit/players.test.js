'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createFixture } = require('../helpers/fixture');
const codes = require('../../server/domain/codes');
const players = require('../../server/domain/players');
const { computeEnergy } = require('../../server/domain/players');

function registerPayload(overrides = {}) {
  return {
    code: 'TEST-CODE-0000',
    display_name: '新玩家',
    password: 'abcd1234',
    team: 'reimu',
    ...overrides
  };
}

function prepareUsableCode(fixture, type = 'ordinary') {
  const generation = codes.generateCodes(fixture.state, { count: 1, type }, fixture.now);
  return generation.created[0];
}

test('register with a valid code creates account, binds code and joins team', () => {
  const fixture = createFixture();
  const codeEntry = prepareUsableCode(fixture);
  const result = players.registerPlayer(
    fixture.state,
    registerPayload({ code: codeEntry.code, team: 'marisa' }),
    { seeds: fixture.seeds },
    fixture.now
  );

  assert.ok(!result.error, result.message);
  assert.equal(result.user.team, 'marisa');
  assert.equal(result.user.weight_base, 1);
  assert.equal(codeEntry.status, 'bound');
  assert.equal(codeEntry.bound_user_id, result.user.id);
  assert.equal(fixture.state.teams.marisa.member_count, 1);
  assert.ok(result.session_id);

  const view = players.buildPlayerView(fixture.state, result.user, { seeds: fixture.seeds, now: fixture.now });
  assert.ok(!JSON.stringify(view).includes('password_hash'));
  assert.ok(!JSON.stringify(view).includes('password_salt'));
});

test('special code grants higher base weight', () => {
  const fixture = createFixture();
  const codeEntry = prepareUsableCode(fixture, 'special');
  const result = players.registerPlayer(
    fixture.state,
    registerPayload({ code: codeEntry.code }),
    { seeds: fixture.seeds },
    fixture.now
  );
  assert.ok(!result.error);
  assert.equal(result.user.weight_base, 2);
});

test('a code can only be used once', () => {
  const fixture = createFixture();
  const codeEntry = prepareUsableCode(fixture);
  const first = players.registerPlayer(fixture.state, registerPayload({ code: codeEntry.code, display_name: '甲' }), { seeds: fixture.seeds }, fixture.now);
  assert.ok(!first.error);
  const second = players.registerPlayer(fixture.state, registerPayload({ code: codeEntry.code, display_name: '乙' }), { seeds: fixture.seeds }, fixture.now);
  assert.equal(second.error, 'CODE_ALREADY_USED');
});

test('invalid, disabled code and duplicate nickname are rejected', () => {
  const fixture = createFixture();
  const disabled = prepareUsableCode(fixture);
  disabled.disabled = true;

  const invalid = players.registerPlayer(fixture.state, registerPayload({ code: 'NOPE-NOPE-NOPE' }), { seeds: fixture.seeds }, fixture.now);
  assert.equal(invalid.error, 'INVALID_CODE');

  const bannedCode = players.registerPlayer(fixture.state, registerPayload({ code: disabled.code }), { seeds: fixture.seeds }, fixture.now);
  assert.equal(bannedCode.error, 'CODE_DISABLED');

  const firstCode = prepareUsableCode(fixture);
  const first = players.registerPlayer(
    fixture.state,
    registerPayload({ code: firstCode.code, display_name: '重复昵称' }),
    { seeds: fixture.seeds },
    fixture.now
  );
  assert.ok(!first.error, first.message);
  const duplicate = players.registerPlayer(fixture.state, registerPayload({ code: firstCode.code, display_name: '重复昵称' }), { seeds: fixture.seeds }, fixture.now);
  assert.equal(duplicate.error, 'DUPLICATE_DISPLAY_NAME');
});

test('team balance restriction blocks joining the larger side', () => {
  const fixture = createFixture();
  for (let index = 0; index < 15; index += 1) {
    fixture.registerUser(index + 100, 'reimu');
  }
  fixture.registerUser(200, 'marisa');
  // 当前 15 : 1，注册 marisa 后为 15:2（差 13），允许
  const balancedCode = prepareUsableCode(fixture);
  const ok = players.registerPlayer(
    fixture.state,
    registerPayload({ code: balancedCode.code, display_name: '平衡玩家', team: 'marisa' }),
    { seeds: fixture.seeds },
    fixture.now
  );
  assert.ok(!ok.error, ok.message);
});

test('registration closed when activity ended', () => {
  const fixture = createFixture();
  fixture.state.activity.status = 'ended';
  prepareUsableCode(fixture);
  const result = players.registerPlayer(
    fixture.state,
    registerPayload(),
    { seeds: fixture.seeds },
    fixture.now
  );
  assert.equal(result.error, 'REGISTRATION_CLOSED');
});

test('login verifies credentials and bans blocked users', () => {
  const fixture = createFixture({ userCount: 1 });
  const [user] = fixture.registered;

  const ok = players.loginPlayer(fixture.state, { display_name: '测试玩家1', password: 'pass1234' }, { seeds: fixture.seeds }, fixture.now);
  assert.ok(!ok.error);
  assert.equal(ok.user.id, user.id);

  const wrong = players.loginPlayer(fixture.state, { display_name: '测试玩家1', password: 'nope' }, { seeds: fixture.seeds }, fixture.now);
  assert.equal(wrong.error, 'INVALID_CREDENTIALS');

  user.banned = true;
  const banned = players.loginPlayer(fixture.state, { display_name: '测试玩家1', password: 'pass1234' }, { seeds: fixture.seeds }, fixture.now);
  assert.equal(banned.error, 'USER_BANNED');
});

test('computeEnergy regenerates over time and caps', () => {
  const config = { energy_cap: 5, energy_regen_interval_sec: 90 };
  const user = { energy: 2, last_energy_at: 1000 };

  assert.equal(computeEnergy(user, config, 1000).energy, 2);
  const afterOneInterval = computeEnergy(user, config, 1090);
  assert.equal(afterOneInterval.energy, 3);
  assert.equal(afterOneInterval.lastEnergyAt, 1090);
  const afterTwo = computeEnergy(user, config, 1180);
  assert.equal(afterTwo.energy, 4);
  assert.equal(afterTwo.lastEnergyAt, 1180);
  assert.equal(computeEnergy(user, config, 5000).energy, 5);
  assert.equal(computeEnergy(user, config, 5000).lastEnergyAt, 5000);
  assert.equal(computeEnergy({ energy: 9, last_energy_at: 0 }, config, 1000).energy, 5);
});
