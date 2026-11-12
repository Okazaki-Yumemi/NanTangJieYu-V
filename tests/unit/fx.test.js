'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../../server/domain/fx');

function setup() {
  const state = { users: { a: { id: 'a', display_name: '甲' }, b: { id: 'b', display_name: '乙' } } };
  fx.advanceMarket(state, 10000);
  let sequence = 0;
  function act(id, action, fields = {}, at) {
    return fx.trade(state, state.users[id], action, {
      request_id: `request_${++sequence}`, expected_revision: state.fx.players[id]?.revision || 0,
      quote_seq: state.fx.market.seq, ...fields,
    }, at ?? 10000 + sequence);
  }
  return { state, act };
}

test('old states migrate without changing existing economies and join grants money only once', () => {
  const { state, act } = setup();
  state.fishing = { players: { a: { wallet_cm: 500 } } };
  const before = JSON.stringify(state.fishing);
  assert.equal(act('a', 'join').ok, true);
  assert.equal(act('a', 'join').error, 'CONFLICT');
  assert.equal(state.fx.players.a.cash, 1000000);
  assert.equal(JSON.stringify(state.fishing), before);
  assert.equal(fx.view(state, null).account, null);
});

test('server prices long and short positions, applies spread/fees and settles exact integer cash', () => {
  const { state, act } = setup();
  act('a', 'join'); act('b', 'join');
  act('a', 'open', { side: 'long', margin: 100000, leverage: 10, entry_price: 1, cash: 999999999 });
  act('b', 'open', { side: 'short', margin: 100000, leverage: 10 });
  assert.equal(state.fx.players.a.cash, 899500);
  assert.equal(state.fx.players.a.positions[0].entry_price, 100.04);
  assert.equal(state.fx.players.b.positions[0].entry_price, 99.96);
  assert.ok(fx.accountView(state.fx.players.a, state.fx.market).floating_pnl < 0);
  state.fx.market.price = 102;
  const long = fx.accountView(state.fx.players.a, state.fx.market);
  const short = fx.accountView(state.fx.players.b, state.fx.market);
  assert.ok(long.floating_pnl > 0); assert.ok(short.floating_pnl < 0);
  assert.equal(long.equity, long.cash + long.used_margin + long.floating_pnl);
  const position = long.positions[0];
  assert.equal(act('a', 'close', { position_id: position.id }).ok, true);
  assert.equal(state.fx.players.a.cash, long.equity);
  assert.equal(state.fx.players.a.history[0].net_pnl, position.pnl - position.fee);
  assert.equal(act('b', 'close', { position_id: position.id }).error, 'CONFLICT');
});

test('bad margins, leverage, stale quotes, stale account revisions and overspending leave cash unchanged', () => {
  const { state, act } = setup(); act('a', 'join');
  const base = { side: 'long', margin: 100000, leverage: 10 };
  for (const invalid of [{ margin: -1 }, { margin: 9999 }, { margin: 1.1 }, { margin: NaN }, { margin: Infinity },
    { margin: '100000' }, { leverage: 0 }, { leverage: 200 }, { side: '__proto__' }, { margin: 1000000 },
    { quote_seq: 0 }, { expected_revision: 0 }]) {
    const before = JSON.stringify(state.fx.players.a);
    assert.ok(act('a', 'open', { ...base, ...invalid }).error);
    assert.equal(JSON.stringify(state.fx.players.a), before);
  }
  assert.equal(fx.trade(state, null, 'join', {}).error, 'USER_NOT_FOUND');
  state.users.a.banned = true;
  assert.equal(act('a', 'open', base).error, 'FORBIDDEN');
});

test('replayed open and close cannot spend or credit twice; reused identifiers reject changed payload', () => {
  const { state, act } = setup(); act('a', 'join');
  const body = { request_id: 'request_idempotent', expected_revision: 1, quote_seq: 1, side: 'long', margin: 100000, leverage: 5 };
  assert.equal(fx.trade(state, state.users.a, 'open', body).ok, true);
  const after = JSON.stringify(state.fx.players.a);
  assert.equal(fx.trade(state, state.users.a, 'open', body).repeated, true);
  assert.equal(JSON.stringify(state.fx.players.a), after);
  assert.equal(fx.trade(state, state.users.a, 'open', { ...body, margin: 200000 }).error, 'CONFLICT');
  const close = { request_id: 'close_idempotent', expected_revision: 2, quote_seq: 1, position_id: state.fx.players.a.positions[0].id };
  assert.equal(fx.trade(state, state.users.a, 'close', close).ok, true);
  const cash = state.fx.players.a.cash;
  assert.equal(fx.trade(state, state.users.a, 'close', close).repeated, true);
  assert.equal(state.fx.players.a.cash, cash);
});

test('quotes must match the displayed tick; delayed and future orders are rejected without spending', () => {
  const { state, act } = setup(); act('a', 'join');
  state.fx.market.seq = 4; state.fx.market.price = 105;
  const base = { side: 'long', margin: 10000, leverage: 1 };
  assert.equal(act('a', 'open', { ...base, quote_seq: 1 }).error, 'STALE_QUOTE');
  assert.equal(act('a', 'open', { ...base, quote_seq: 5 }).error, 'STALE_QUOTE');
  assert.equal(act('a', 'open', { ...base, quote_seq: 2 }).error, 'STALE_QUOTE');
  assert.equal(state.fx.players.a.cash, 1000000);
  assert.equal(act('a', 'open', { ...base, quote_seq: 4 }).ok, true);
  assert.equal(state.fx.players.a.positions[0].entry_price, fx.quotes(state.fx.market).ask);
});

test('market ticks are server-random, bounded, and liquidate offline positions with loss capped at margin', () => {
  const { state, act } = setup(); act('a', 'join');
  act('a', 'open', { side: 'long', margin: 100000, leverage: 100 });
  const cash = state.fx.players.a.cash;
  state.fx.market.major_event_ticks = 1;
  const sequence = [10000, 99, 0, 1800, 450]; // 金融地震：天子踩塌交易所，瞬跌 18%。
  assert.equal(fx.advanceMarket(state, 11999, () => { throw new Error('too soon'); }), false);
  assert.equal(fx.advanceMarket(state, 12000, () => sequence.shift()), true);
  assert.equal(state.fx.players.a.positions.length, 0);
  assert.equal(state.fx.players.a.history[0].reason, 'liquidation');
  assert.equal(state.fx.players.a.cash, cash);
  assert.equal(state.fx.players.a.history[0].pnl, -100000);
  const steady = (min, max) => max === 20001 ? 10000 : 99;
  for (let tick = 1; tick <= 200; tick++) fx.advanceMarket(state, 12000 + tick * 2000, steady);
  assert.equal(state.fx.market.history.length, 180);
  const seq = state.fx.market.seq;
  fx.advanceMarket(state, 100000000, steady);
  assert.equal(state.fx.market.seq, seq + 1, 'downtime does not invent historical ticks');
});

test('rankings use current equity, include unrealized loss, exclude banned users and do not expose others positions', () => {
  const { state, act } = setup(); act('a', 'join'); act('b', 'join');
  act('a', 'open', { side: 'long', margin: 100000, leverage: 10 });
  state.fx.market.price = 110;
  assert.equal(fx.rankings(state)[0].user_id, 'a');
  state.fx.market.price = 99;
  assert.equal(fx.rankings(state)[0].user_id, 'b');
  state.users.b.banned = true;
  const view = fx.view(state, state.users.a);
  assert.equal(view.rows.length, 1); assert.equal(view.rows[0].rank, 1);
  assert.equal(view.rows[0].equity, view.account.equity);
  assert.equal(view.my_rank, 1); assert.equal('positions' in view.rows[0], false);
});

test('position cap and bounded settlement and request logs', () => {
  const { state, act } = setup(); act('a', 'join');
  for (let i = 0; i < 12; i++) assert.equal(act('a', 'open', { side: 'short', margin: 10000, leverage: 1 }).ok, true);
  assert.ok(act('a', 'open', { side: 'short', margin: 10000, leverage: 1 }).error);
  assert.equal(act('a', 'work').ok, true);
  for (const position of [...state.fx.players.a.positions]) act('a', 'close', { position_id: position.id });
  for (let i = 0; i < 25; i++) {
    act('a', 'open', { side: 'long', margin: 10000, leverage: 1 });
    act('a', 'close', { position_id: state.fx.players.a.positions[0].id });
  }
  assert.equal(state.fx.players.a.history.length, 30);
  assert.equal(state.fx.players.a.requests.length, 60);
  assert.ok(act('a', 'restart').error);
});

test('interest-free 5000 loan is only for broke players and cannot inflate net worth or repeat before repayment', () => {
  const { state, act } = setup(); act('a', 'join');
  assert.ok(act('a', 'borrow').error);
  state.fx.players.a.cash = 0;
  assert.equal(act('a', 'borrow', { amount: 99999999 }).ok, true);
  assert.equal(state.fx.players.a.cash, 500000);
  assert.equal(state.fx.players.a.debt, 500000);
  assert.equal(fx.view(state, state.users.a).account.equity, 0);
  state.fx.players.a.cash = 50;
  assert.ok(act('a', 'borrow').error);
  assert.equal(act('a', 'repay').ok, true);
  assert.equal(state.fx.players.a.cash, 0);
  assert.equal(state.fx.players.a.debt, 499950);
  assert.ok(act('a', 'repay').error);
  state.fx.players.a.cash = 500000;
  assert.equal(act('a', 'repay').ok, true);
  assert.equal(state.fx.players.a.debt, 0);
  assert.equal(state.fx.players.a.cash, 50);
  assert.equal(act('a', 'borrow').ok, true);
});

test('default work runs for 15 real minutes across reloads, pays 1500 once, and allows loans while working', () => {
  const { state, act } = setup(); act('a', 'join');
  state.fx.players.a.cash = 0;
  const start = 20000;
  assert.equal(act('a', 'work', { ready_at: 0, duration: 0, salary: 999999999 }, start).ok, true);
  assert.deepEqual(state.fx.players.a.job, { started_at: start, ready_at: start + 900000, pay: 150000 });
  assert.ok(act('a', 'work').error);
  assert.ok(act('a', 'claim-work', {}, start + 899999).error);
  assert.equal(state.fx.players.a.cash, 0);
  assert.equal(act('a', 'borrow').ok, true);
  const reloaded = JSON.parse(JSON.stringify(state)); fx.normalize(reloaded);
  assert.deepEqual(reloaded.fx.players.a.job, state.fx.players.a.job);
  const body = { request_id: 'claim_work_once', expected_revision: reloaded.fx.players.a.revision };
  assert.equal(fx.trade(reloaded, reloaded.users.a, 'claim-work', body, start + 900000).ok, true);
  assert.equal(reloaded.fx.players.a.cash, 650000);
  assert.equal(reloaded.fx.players.a.debt, 500000);
  assert.equal(fx.view(reloaded, reloaded.users.a).account.equity, 150000);
  assert.equal(reloaded.fx.players.a.job, null);
  assert.equal(fx.trade(reloaded, reloaded.users.a, 'claim-work', body, start + 900001).repeated, true);
  assert.equal(reloaded.fx.players.a.cash, 650000);
  assert.ok(fx.trade(reloaded, reloaded.users.a, 'claim-work', { ...body, request_id: 'claim_work_twice', expected_revision: reloaded.fx.players.a.revision }, start + 900002).error);
});

test('positions prevent rescue even when available cash is zero, and old accounts get empty debt and job', () => {
  const { state, act } = setup(); act('a', 'join');
  act('a', 'open', { side: 'short', margin: 10000, leverage: 1 });
  state.fx.players.a.cash = 0;
  assert.equal(act('a', 'work').ok, true); assert.ok(act('a', 'borrow').error);
  delete state.fx.players.a.debt; delete state.fx.players.a.job;
  fx.normalize(state);
  assert.equal(state.fx.players.a.debt, 0); assert.equal(state.fx.players.a.job, null);
});
