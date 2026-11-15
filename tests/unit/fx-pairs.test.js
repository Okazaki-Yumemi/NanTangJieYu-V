'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../../server/domain/fx');
const admin = require('../../server/domain/fx-admin');
const { PAIRS, CURRENCIES, DEFAULT_PAIR, marketFor, round } = require('../../server/domain/fx-pairs');

function fixture() {
  const state = { users: { a: { id: 'a', display_name: '多品种交易员' } }, admin_logs: [] };
  fx.advanceMarket(state, 10000);
  let request = 0;
  const act = (action, fields = {}) => fx.trade(state, state.users.a, action, {
    request_id: `multipair-${++request}`, expected_revision: state.fx.players.a?.revision || 0,
    quote_seq: state.fx.market.seq, ...fields,
  }, state.fx.market.updated_at);
  act('join');
  return { state, act, account: state.fx.players.a, market: state.fx.market };
}
function seeded(seed) {
  return (min, max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return min + seed % (max - min); };
}

test('single-pair saves migrate without changing balances, debt, positions, receipts or retained prices', () => {
  const { state, act, account, market } = fixture();
  act('open', { side: 'long', margin: 100000, leverage: 5 });
  act('close', { position_id: account.positions[0].id });
  act('open', { side: 'short', margin: 100000, leverage: 5 });
  account.debt = 300000;
  delete market.pairs;
  for (const position of [...account.positions, ...account.history]) delete position.pair_id;
  const before = structuredClone(state), expected = fx.accountView(account, market);
  fx.normalize(state);
  assert.equal(account.cash, before.fx.players.a.cash);
  assert.equal(account.debt, 300000);
  assert.deepEqual(account.requests, before.fx.players.a.requests);
  assert.deepEqual(market.history, before.fx.market.history);
  assert.equal(fx.accountView(account, market).equity, expected.equity);
  for (const position of [...account.positions, ...account.history]) assert.equal(position.pair_id, DEFAULT_PAIR);
  for (const pair of PAIRS.slice(1)) {
    const current = marketFor(market, pair.id);
    assert.equal(current.history.length, 1, 'new markets do not invent earlier history');
    assert.equal(current.updated_at, market.updated_at);
  }
  const saved = JSON.parse(JSON.stringify(state)); fx.normalize(state);
  assert.deepEqual(state, saved, 'migration is idempotent');
});

test('long and short trades on all five pairs use their own quotes and share one integer-yen account', () => {
  const { state, act, account, market } = fixture();
  for (const pair of PAIRS) for (const side of ['long', 'short']) {
    const result = act('open', { pair_id: pair.id, side, margin: 10000, leverage: 5 });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.pair_id, pair.id);
    assert.equal(result.receipt.price, fx.quotes(market, pair.id)[side === 'long' ? 'ask' : 'bid']);
  }
  assert.equal(account.cash, 899750);
  fx.triggerEvent(state, 'moon-rate', 12000, min => min);
  const marked = fx.accountView(account, market);
  let total = account.cash;
  for (const position of marked.positions) {
    const quote = fx.quotes(market, position.pair_id)[position.side === 'long' ? 'bid' : 'ask'];
    const pnl = Math.max(-position.margin, Math.round(position.margin * position.leverage * (position.side === 'long' ? 1 : -1) * (quote / position.entry_price - 1)));
    assert.equal(position.pnl, pnl); assert.equal(position.exit_price, quote);
    total += position.margin + pnl;
  }
  assert.equal(marked.equity, total); assert.equal(fx.rankings(state)[0].equity, total);
  for (const position of marked.positions) {
    const before = account.cash;
    const result = act('close', { pair_id: position.pair_id, position_id: position.id });
    assert.equal(result.receipt.price, position.exit_price);
    assert.equal(account.cash, before + position.value);
  }
  assert.equal(account.cash, total); assert.equal(account.positions.length, 0);
});

test('currency validation, quote revisions and pair-aware idempotency prevent cross-pair or stale execution', () => {
  const { state, act, account, market } = fixture();
  const fields = { side: 'long', margin: 100000, leverage: 1 };
  for (const pair_id of ['bad', '__proto__', '', null, {}, []]) assert.equal(act('open', { ...fields, pair_id }).error, 'BAD_REQUEST');
  assert.equal(account.cash, 1000000);
  const body = { ...fields, pair_id: 'moon_human', request_id: 'multipair-replay', expected_revision: 1, quote_seq: 1 };
  const result = fx.trade(state, state.users.a, 'open', body, 10000);
  const position = account.positions[0], before = account.cash;
  assert.equal(act('close', { position_id: position.id, pair_id: 'kappa_human' }).error, 'CONFLICT');
  assert.equal(fx.trade(state, state.users.a, 'open', { ...body, pair_id: 'tengu_human' }).error, 'CONFLICT');
  fx.triggerEvent(state, 'tengu-exclusive', 12000, min => min);
  assert.equal(act('close', { position_id: position.id, pair_id: position.pair_id, quote_seq: 1 }).error, 'STALE_QUOTE');
  assert.equal(act('open', { ...fields, pair_id: 'kappa_moon', quote_seq: 1 }).error, 'STALE_QUOTE');
  assert.equal(account.cash, before);
  const replay = fx.trade(state, state.users.a, 'open', body, 12000);
  assert.equal(replay.repeated, true); assert.deepEqual(replay.receipt, result.receipt);
  assert.equal(account.positions.length, 1); assert.equal(market.seq, 2);
});

test('targeted news propagates across currencies, recomputes cross rates, and liquidates by each position market', () => {
  const { state, act, account, market } = fixture();
  act('open', { pair_id: 'moon_human', side: 'short', margin: 100000, leverage: 10 });
  act('open', { pair_id: 'kappa_human', side: 'long', margin: 100000, leverage: 1 });
  fx.triggerEvent(state, 'moon-vault', 12000, (min, max) => min === 800 ? 1800 : min);
  assert.equal(market.pairs.moon_human.price, 212.4);
  assert.equal(market.price, 98.38, 'safe-haven shock has a weaker inverse risk-currency impact');
  assert.equal(market.pairs.kappa_moon.price, round(98.38 / 212.4, 6));
  assert.equal(account.positions.length, 1); assert.equal(account.positions[0].pair_id, 'kappa_human');
  assert.equal(account.history[0].pair_id, 'moon_human'); assert.equal(account.history[0].pnl, -100000);
  for (const pair of PAIRS) {
    const current = marketFor(market, pair.id), view = fx.view(state, state.users.a, pair.id);
    assert.equal(current.candles.at(-1).close, current.price);
    assert.equal(current.tick_candles.at(-1).close, current.price);
    assert.equal(view.market.news.change_bps, Math.round((current.price / current.previous - 1) * 10000));
  }
  market.pairs.moon_human.price = 900;
  assert.ok(fx.triggerEvent(state, 'moon-vault', 14000).error, 'boundary check uses event target');
  assert.equal(fx.triggerEvent(state, 'junko-invoice', 14000, min => min).ok, true);
  const beforeNether = market.pairs.nether_human.price;
  const audit = admin.operate(state, 'event', { request_id: 'news-audit-pairs', event_id: 'nether-sakura' }, 16000);
  assert.equal(audit.ok, true);
  assert.equal(state.admin_logs[0].detail.currency, 'nether');
  assert.equal(state.admin_logs[0].detail.pair_id, 'nether_human');
  assert.equal(state.admin_logs[0].detail.before, beforeNether);
  assert.equal(state.admin_logs[0].detail.after, market.pairs.nether_human.price);
  assert.equal(state.admin_logs[0].detail.change_bps, market.news.changes.nether_human);
  assert.equal(Object.keys(state.admin_logs[0].detail.changes).length, 5);
});

test('selected views contain one chart, consistent quotes and whole portfolios, without engine state or mutation', () => {
  const { state, act, account } = fixture();
  act('open', { pair_id: 'tengu_human', side: 'long', margin: 10000, leverage: 1 });
  const before = JSON.stringify(state);
  for (const pair of PAIRS) {
    const result = fx.view(state, state.users.a, pair.id);
    assert.equal(result.market.pair_id, pair.id); assert.equal(result.pairs.length, 5);
    assert.equal(result.market.ask, result.pairs.find(p => p.id === pair.id).ask);
    assert.equal(result.account.positions[0].pair_id, 'tengu_human');
    for (const hidden of ['pairs', 'momentum', 'variance', 'regime', 'anchor', 'last_noise', 'last_innovation', 'major_event_ticks']) assert.equal(hidden in result.market, false);
    assert.ok(result.pairs.every(p => !p.history && !p.candles && !p.regime));
    assert.equal(fx.view(state, null, pair.id).account, null);
  }
  assert.equal(JSON.stringify(state), before);
  assert.equal(account.positions.length, 1);
});

test('correlated regimes keep prices finite, coherent and varied through thousands of ticks and restart', () => {
  let { state } = fixture();
  const pick = seeded(5931), returns = Object.fromEntries(CURRENCIES.map(c => [c.id, []])), modes = new Set();
  let events = 0;
  for (let tick = 1; tick <= 6000; tick++) {
    const previousNews = state.fx.market.news.id;
    fx.advanceMarket(state, 10000 + tick * 2000, pick);
    const market = state.fx.market; modes.add(market.regime.mode);
    if (market.news.id !== previousNews) events++;
    for (const currency of CURRENCIES) {
      const current = marketFor(market, `${currency.id}_human`);
      assert.ok(Number.isFinite(current.price) && current.price >= currency.initial * .2 && current.price <= currency.initial * 5);
      assert.equal(current.updated_at, market.updated_at);
      assert.ok(current.history.length <= 180 && current.candles.length <= 360 && current.tick_candles.length <= 180);
      if (market.news.id === previousNews && !market.event_effect) returns[currency.id].push(Math.log(current.price / current.previous));
    }
    assert.equal(market.pairs.kappa_moon.price, round(market.price / market.pairs.moon_human.price, 6));
    if (tick === 3000) { const saved = JSON.parse(JSON.stringify(state)); fx.normalize(saved); assert.deepEqual(saved, state); state = saved; }
  }
  assert.equal(modes.size, 3); assert.ok(events > 20);
  const correlation = (a, b) => {
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const ma = mean(a), mb = mean(b);
    return a.reduce((sum, value, i) => sum + (value - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((sum, v) => sum + (v - ma) ** 2, 0) * b.reduce((sum, v) => sum + (v - mb) ** 2, 0));
  };
  assert.ok(correlation(returns.kappa, returns.moon) < -.2);
  assert.ok(correlation(returns.kappa, returns.tengu) > .4);
  assert.ok(Math.abs(correlation(returns.kappa, returns.nether)) < .4);
  for (const values of Object.values(returns)) {
    assert.ok(values.some(v => v > .003) && values.some(v => v < -.003));
    assert.ok(values.filter(v => v === 0).length / values.length < .03, 'markets should not stick to hard boundaries');
  }
  const lengths = PAIRS.map(pair => marketFor(state.fx.market, pair.id).tick_candles.length);
  fx.advanceMarket(state, 10000 + 6000 * 2000 + 86400000, pick);
  for (const [i, pair] of PAIRS.entries()) assert.equal(marketFor(state.fx.market, pair.id).tick_candles.length, Math.min(180, lengths[i] + 1));
});
