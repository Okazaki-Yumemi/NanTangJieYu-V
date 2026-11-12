'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../../server/domain/fx');
const profile = require('../../server/domain/fx-profile');
const { CATALOG } = require('../../server/domain/fx-events');
function fixture() {
  const state = { users: { a: { id: 'a', display_name: '甲' }, b: { id: 'b', display_name: '乙' } } };
  fx.advanceMarket(state, 10000);
  let sequence = 0;
  const act = (action, fields = {}, now = 10000, id = 'a') => fx.trade(state, state.users[id], action, {
    request_id: `profile-test-${++sequence}`, expected_revision: state.fx.players[id]?.revision || 0,
    quote_seq: state.fx.market.seq, ...fields,
  }, now);
  act('join');
  return { state, act, account: state.fx.players.a };
}
test('borrowing cannot unlock wealth achievements or forge titles; earned titles appear on the public board', () => {
  const { state, act, account } = fixture();
  act('borrow-credit', { amount: 5000000 });
  assert.equal(account.profile.stats.peak_equity, 1000000);
  assert.equal(account.profile.unlocked['nest-egg'], undefined);
  assert.ok(act('set-title', { title: 'partner' }).error);
  assert.ok(act('set-title', { title: '__proto__' }).error);
  act('open', { side: 'long', margin: 10000, leverage: 1 });
  assert.equal(account.profile.stats.opened, 1);
  assert.ok(Object.hasOwn(account.profile.unlocked, 'debut'));
  assert.equal(act('set-title', { title: 'debut' }).ok, true);
  assert.equal(fx.view(state, null).rows[0].title, '见习汇民');
  assert.equal('profile' in fx.view(state, null).rows[0], false);
  assert.equal(fx.view(state, null).account, null);
  assert.equal(act('set-title', { title: null }).ok, true);
  assert.equal(fx.view(state, null).rows[0].title, '未挂名交易员');
});
test('winning streak and realized profit use fees, idempotent settlement cannot farm achievements', () => {
  const { state, act, account } = fixture();
  for (let i = 0; i < 3; i++) {
    state.fx.market.price = 100; state.fx.market.seq++;
    act('open', { side: 'long', margin: 10000, leverage: 1 });
    state.fx.market.price = 102; state.fx.market.seq++;
    const fields = { request_id: `winning-close-${i}`, expected_revision: account.revision, quote_seq: state.fx.market.seq, position_id: account.positions[0].id };
    assert.equal(fx.trade(state, state.users.a, 'close', fields, 10010 + i).ok, true);
    assert.equal(fx.trade(state, state.users.a, 'close', fields, 10020 + i).repeated, true);
  }
  assert.equal(account.profile.stats.wins, 3); assert.equal(account.profile.stats.opened, 3);
  assert.equal(account.profile.stats.realized_pnl, account.history.reduce((sum, item) => sum + item.net_pnl, 0));
  assert.ok(Object.hasOwn(account.profile.unlocked, 'streak'));
  const timestamp = account.profile.unlocked.streak;
  act('open', { side: 'short', margin: 10000, leverage: 1 });
  act('close', { position_id: account.positions[0].id });
  assert.equal(account.profile.stats.losses, 1, 'spread and opening fee make an unchanged-price close a loss');
  assert.equal(account.profile.stats.streak, 0);
  assert.ok(Object.hasOwn(account.profile.unlocked, 'two-sides'));
  const restored = JSON.parse(JSON.stringify(state)); fx.normalize(restored);
  fx.advanceMarket(restored, 12000, (min, max) => max === 20001 ? 10000 : min);
  assert.equal(restored.fx.players.a.profile.unlocked.streak, timestamp);
});
test('work and loan achievements track completed payouts and repayments, not requests', () => {
  const { state, act, account } = fixture();
  act('work', { minutes: 5 });
  assert.equal(account.profile.stats.jobs, 0);
  const body = { request_id: 'profile-work-claim', expected_revision: account.revision };
  assert.equal(fx.trade(state, state.users.a, 'claim-work', body, 310000).ok, true);
  assert.equal(fx.trade(state, state.users.a, 'claim-work', body, 310001).repeated, true);
  assert.equal(account.profile.stats.jobs, 1); assert.equal(account.profile.stats.work_earned, 50000);
  assert.ok(Object.hasOwn(account.profile.unlocked, 'worker'));
  act('borrow-credit', { amount: 10000 }, 310001); act('repay', {}, 310001);
  assert.equal(account.profile.stats.loans_cleared, 1);
  assert.ok(Object.hasOwn(account.profile.unlocked, 'debt-free'));
  assert.ok(act('repay', {}, 310002).error); assert.equal(account.profile.stats.loans_cleared, 1);
});
test('news achievements require exposure; liquidations and surviving quakes are recorded separately', () => {
  const { state, act, account } = fixture();
  act('join', {}, 10000, 'b');
  act('open', { side: 'long', margin: 10000, leverage: 100 });
  fx.triggerEvent(state, 'tenshi-quake', 10002, min => min);
  assert.ok(Object.hasOwn(account.profile.unlocked, 'margin-call'));
  assert.equal(account.profile.stats.quakes_survived, 0);
  assert.equal(state.fx.players.b.profile.stats.news_count, 0, 'unexposed account cannot collect headlines');
  act('open', { side: 'short', margin: 10000, leverage: 1 });
  fx.triggerEvent(state, 'tenshi-quake', 10003, min => min);
  assert.equal(account.profile.stats.quakes_survived, 1);
  assert.equal(account.profile.stats.news_count, 1, 'repeating a headline is not a new discovery');
  for (const [index, event] of CATALOG.filter(item => item.tier === 'rumor').slice(0, 5).entries()) fx.triggerEvent(state, event.id, 10004 + index, min => min);
  assert.equal(account.profile.stats.news_count, 6);
  assert.ok(Object.hasOwn(account.profile.unlocked, 'news-reader'));
});
test('legacy profiles initialize from retained settlements once without granting unverifiable work history', () => {
  const account = { positions: [{ side: 'short' }], history: [{ side: 'long', net_pnl: 200, reason: 'manual' }, { side: 'short', net_pnl: -100, reason: 'liquidation' }] };
  profile.normalize(account); profile.normalize(account);
  assert.equal(account.profile.stats.opened, 3); assert.equal(account.profile.stats.realized_pnl, 100);
  assert.equal(account.profile.stats.jobs, 0); assert.equal(account.profile.stats.wins, 1);
});
