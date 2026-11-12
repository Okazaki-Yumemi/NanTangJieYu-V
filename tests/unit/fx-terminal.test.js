'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../../server/domain/fx');
const pricing = require('../../server/domain/fx-market');
const credit = require('../../server/domain/fx-credit');
const admin = require('../../server/domain/fx-admin');
const { aggregate, series } = require('../../web/public/fx-chart');
function fixture() {
  const state = { users: { a: { id: 'a', display_name: '测试' } }, admin_logs: [] };
  fx.advanceMarket(state, 10000);
  let request = 0;
  const act = (action, fields = {}, now = 10000) => fx.trade(state, state.users.a, action, { request_id: `terminal-${++request}`, expected_revision: state.fx.players.a?.revision || 0, quote_seq: state.fx.market.seq, ...fields }, now);
  act('join');
  return { state, act, account: state.fx.players.a };
}

test('candles preserve real high/low, migrate history, aggregate periods and never invent offline bars', () => {
  const market = { updated_at: 10000, price: 100, history: [{ at: 10000, price: 100 }, { at: 12000, price: 105 }, { at: 14000, price: 98 }] };
  pricing.normalizeMarket(market);
  assert.deepEqual(market.candles, [{ at: 10000, open: 100, high: 105, low: 98, close: 98 }]);
  pricing.recordCandle(market, 20000, 102, 98);
  pricing.recordCandle(market, 22000, 103, 102);
  assert.deepEqual(aggregate(market.candles, 30), [{ at: 0, open: 100, high: 105, low: 98, close: 103 }]);
  pricing.recordCandle(market, 86400000, 101, 103);
  assert.equal(market.candles.length, 3);
  for (let i = 1; i <= 400; i++) pricing.recordCandle(market, 86400000 + i * 10000, 101);
  assert.equal(market.candles.length, 360);
  const restored = JSON.parse(JSON.stringify(market)); pricing.normalizeMarket(restored);
  assert.deepEqual(restored, market);
});

test('two-second candles use each real tick, including intra-tick manual events, while longer periods keep their history', () => {
  const coarse = [{ at: 0, open: 99, high: 101, low: 98, close: 100 }];
  const market = { updated_at: 14000, price: 102, candles: structuredClone(coarse), history: [
    { at: 10000, price: 100 }, { at: 12000, price: 105 }, { at: 12000, price: 97 }, { at: 14000, price: 102 },
  ] };
  pricing.normalizeMarket(market);
  assert.deepEqual(market.candles, coarse, 'migration must preserve old ten-second candles');
  assert.deepEqual(series(market, 2), [
    { at: 10000, open: 100, high: 100, low: 100, close: 100 },
    { at: 12000, open: 100, high: 105, low: 97, close: 97 },
    { at: 14000, open: 97, high: 102, low: 97, close: 102 },
  ]);
  pricing.recordCandle(market, 16000, 101, 102);
  pricing.recordCandle(market, 16000, 106, 101);
  assert.deepEqual(series(market, 2).at(-1), { at: 16000, open: 102, high: 106, low: 101, close: 106 });
  assert.equal(series(market, 10).length, 2);
  assert.equal(series(market, 30).length, 1);
  assert.equal(series(market, 60).length, 1);
  const restored = JSON.parse(JSON.stringify(market)); pricing.normalizeMarket(restored);
  assert.deepEqual(restored, market, 'restart does not duplicate or rebuild saved ticks');
});

test('two-second history is bounded and does not invent fine quotes from old coarse bars or downtime', () => {
  const market = { updated_at: 10000, price: 100, candles: [{ at: 0, open: 80, high: 120, low: 60, close: 100 }] };
  pricing.normalizeMarket(market);
  assert.deepEqual(series(market, 2), [{ at: 10000, open: 100, high: 100, low: 100, close: 100 }]);
  pricing.recordCandle(market, 86400000, 105, 100);
  assert.equal(market.tick_candles.length, 2, 'no candles are fabricated between quotes');
  for (let i = 1; i <= 200; i++) pricing.recordCandle(market, 86400000 + i * 2000, 105);
  assert.equal(market.tick_candles.length, 180);
  assert.equal(market.tick_candles.at(-1).at - market.tick_candles[0].at, 179 * 2000);
  assert.equal(market.candles[0].at, 0, 'fine history eviction leaves coarse history intact');
});

test('market has larger ordinary swings, clustered volatility and private trend state', () => {
  let seed = 42;
  const pick = (min, max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return min + seed % (max - min); };
  const { state } = fixture(), market = state.fx.market;
  const moves = Array.from({ length: 10000 }, () => pricing.nextMove(market, pick));
  const average = moves.reduce((sum, n) => sum + Math.abs(n), 0) / moves.length;
  assert.ok(average > .003 && average < .012, `mean absolute move ${average}`);
  const quiet = { price: 100, variance: .000025, momentum: 0 };
  const turbulent = { ...quiet };
  for (let i = 0; i < 10; i++) { pricing.nextMove(quiet, () => 10000); pricing.nextMove(turbulent, () => i % 2 ? 0 : 20000); }
  assert.ok(turbulent.variance > quiet.variance * 2);
  const publicMarket = fx.view(state, null).market;
  for (const secret of ['momentum', 'variance', 'major_event_ticks']) assert.equal(secret in publicMarket, false);
});

test('credit uses hourly 0.5% simple interest offline, exact remainders, partial repayment and net wealth', () => {
  const { state, act, account } = fixture();
  assert.equal(act('borrow-credit', { amount: 5000000 }).ok, true);
  assert.equal(account.cash, 6000000);
  assert.equal(fx.rankings(state)[0].equity, 1000000);
  const repeatedTicks = structuredClone(account);
  for (let now = 12000; now <= 3610000; now += 2000) credit.accrue(repeatedTicks, now);
  credit.accrue(account, 3610000);
  assert.deepEqual(repeatedTicks.credit, account.credit);
  assert.equal(account.credit.interest, 25000);
  credit.accrue(account, 7210000);
  assert.equal(account.credit.interest, 50000, 'no compound interest');
  assert.equal(fx.rankings(state)[0].equity, 950000);
  account.cash = 1050000;
  assert.equal(act('repay', {}, 7210000).ok, true);
  assert.equal(account.credit.principal, 4000000); assert.equal(account.credit.interest, 0);
  credit.accrue(account, 10810000);
  assert.equal(account.credit.interest, 20000, 'interest falls with remaining principal');
  account.cash = 4020000;
  act('repay', {}, 10810000); assert.equal(account.credit, null);
  assert.equal(act('borrow-credit', { amount: 10000 }, 10810000).ok, true);
});

test('credit rejects forged amounts and request reuse, existing debt survives migration', () => {
  const { state, act, account } = fixture();
  for (const amount of [-1, 0, 9999, 5000001, 10000.5, '10000']) assert.ok(act('borrow-credit', { amount }).error);
  const body = { request_id: 'unique-credit', amount: 10000, expected_revision: account.revision };
  assert.equal(fx.trade(state, state.users.a, 'borrow-credit', body, 10000).ok, true);
  assert.equal(fx.trade(state, state.users.a, 'borrow-credit', body, 20000).repeated, true);
  assert.equal(fx.trade(state, state.users.a, 'borrow-credit', { ...body, amount: 20000 }).error, 'CONFLICT');
  assert.ok(act('borrow-credit', { amount: 10000 }).error);
  account.debt = 300000;
  const restored = JSON.parse(JSON.stringify(state)); fx.normalize(restored);
  assert.equal(restored.fx.players.a.debt, 300000, 'legacy loan is not enlarged');
  fx.advanceMarket(restored, 3610000, (min, max) => max === 20001 ? 10000 : min);
  assert.equal(restored.fx.players.a.credit.interest, 50, 'offline time accrues on reopening');
});

test('work accepts all four durations with cash and positions, server sets payout, legacy jobs keep pay', () => {
  for (const minutes of [5, 15, 30, 60]) {
    const { state, act, account } = fixture();
    act('open', { side: 'long', margin: 10000, leverage: 1 });
    const before = account.cash;
    assert.equal(act('work', { minutes, pay: 999999999, ready_at: 0 }).ok, true);
    assert.equal(account.job.pay, minutes * 10000);
    assert.ok(act('work', { minutes }).error);
    assert.ok(act('claim-work', {}, 10000 + minutes * 60000 - 1).error);
    assert.equal(act('claim-work', {}, 10000 + minutes * 60000).ok, true);
    assert.equal(account.cash, before + minutes * 10000);
    assert.ok(act('work', { minutes: 0 }).error);
    account.job = { started_at: 10000, ready_at: 910000 }; fx.normalize(state);
    assert.equal(account.job.pay, 150000);
  }
});

test('admin credits and events are validated, idempotent, audited and settle liquidations in real candles', () => {
  const { state, act, account } = fixture();
  const body = { request_id: 'admin-credit-test', user_id: 'a', amount: 100000, reason: '测试补偿' };
  assert.equal(admin.operate(state, 'credit', body, 10000).ok, true);
  assert.equal(account.cash, 1100000);
  assert.equal(admin.operate(state, 'credit', body, 10001).repeated, true);
  assert.equal(account.cash, 1100000); assert.equal(state.admin_logs.length, 1);
  assert.ok(admin.operate(state, 'credit', { ...body, amount: 999 }).error);
  for (const amount of [0, -1, 100000001, '100']) assert.ok(admin.operate(state, 'credit', { ...body, request_id: 'invalid-credit', amount }).error);
  act('open', { side: 'long', margin: 100000, leverage: 100 });
  const event = { request_id: 'admin-event-test', event_id: 'tenshi-quake' };
  assert.equal(admin.operate(state, 'event', event, 10002).ok, true);
  assert.equal(account.positions.length, 0); assert.equal(account.history[0].reason, 'liquidation');
  assert.equal(state.fx.market.candles[0].close, state.fx.market.price);
  assert.equal(state.fx.market.candles[0].high, 100);
  assert.equal(state.fx.market.tick_candles.at(-1).close, state.fx.market.price);
  assert.equal(state.fx.market.tick_candles.at(-1).high, 100);
  const price = state.fx.market.price;
  assert.equal(admin.operate(state, 'event', event, 10003).repeated, true);
  assert.equal(state.fx.market.price, price); assert.equal(state.admin_logs.length, 2);
  assert.ok(state.fx.market.major_event_ticks >= 450 && state.fx.market.major_event_ticks <= 900);
});

test('delayed close cannot change cash; exact-price receipts and retries survive new quotes', () => {
  const { state, act, account } = fixture();
  const opened = act('open', { side: 'long', margin: 10000, leverage: 1 });
  assert.deepEqual(opened.receipt, { action: 'open', price: 100.04, margin: 10000, fee: 5, amount: 10005 });
  const position = account.positions[0];
  state.fx.market.price = 101; state.fx.market.seq++;
  const before = account.cash;
  assert.equal(act('close', { position_id: position.id, quote_seq: 1 }).error, 'STALE_QUOTE');
  assert.equal(account.cash, before); assert.equal(account.positions.length, 1);
  const expected = fx.markedPosition(position, state.fx.market);
  const body = { request_id: 'close-exact-quote', position_id: position.id, quote_seq: 2, expected_revision: account.revision };
  const close = fx.trade(state, state.users.a, 'close', body, 11000);
  assert.equal(close.receipt.amount, expected.value); assert.equal(close.receipt.price, expected.exit_price);
  state.fx.market.seq++; state.fx.market.price = 90;
  const retry = fx.trade(state, state.users.a, 'close', body, 12000);
  assert.equal(retry.repeated, true); assert.deepEqual(retry.receipt, close.receipt);
  assert.equal(account.cash, before + expected.value);
});
