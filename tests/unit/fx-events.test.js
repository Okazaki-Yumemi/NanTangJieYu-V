'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../../server/domain/fx');
const events = require('../../server/domain/fx-events');

function setup() {
  const state = { users: { long: { id: 'long', display_name: '多头' }, short: { id: 'short', display_name: '空头' } } };
  fx.advanceMarket(state, 10000);
  return state;
}
function sequence(...values) {
  return (min, max) => {
    const value = values.shift();
    assert.ok(Number.isInteger(value) && value >= min && value < max, `random ${value} outside [${min}, ${max})`);
    return value;
  };
}
function trigger(state, tier = 'quake', index = 0, bps = events.TIERS[tier].min_bps) {
  state.fx.market.major_event_ticks = tier === 'rumor' ? 900 : 1;
  fx.advanceMarket(state, state.fx.market.updated_at + 2000, tier === 'rumor'
    ? sequence(10000, 0, index, bps)
    : sequence(10000, tier === 'surge' ? 0 : 99, index, bps, 450));
}

test('36 distinct fictional events have both directions in every severity tier', () => {
  assert.equal(events.CATALOG.length, 36);
  assert.equal(new Set(events.CATALOG.map(event => event.id)).size, 36);
  for (const tier of Object.keys(events.TIERS)) {
    assert.deepEqual([...new Set(events.CATALOG.filter(event => event.tier === tier).map(event => event.direction))].sort(), [-1, 1]);
  }
});

test('all tiers apply the configured jump and archive the actual move at the chart timestamp', () => {
  for (const tier of Object.keys(events.TIERS)) {
    for (const bps of [events.TIERS[tier].min_bps, events.TIERS[tier].max_bps]) {
      for (const index of [0, 1]) {
        const state = setup(); trigger(state, tier, index, bps);
        const event = events.CATALOG.filter(item => item.tier === tier)[index];
        const market = state.fx.market;
        assert.equal(market.price, 100 + event.direction * bps / 100);
        assert.equal(market.news.headline, event.headline);
        assert.equal(market.news.change_bps, event.direction * bps);
        assert.equal(market.news.at, market.history.at(-1).at);
        assert.deepEqual(market.news_history, [market.news]);
        assert.equal(market.event_effect?.remaining_ticks || 0, events.TIERS[tier].aftershock_ticks);
      }
    }
  }
});

test('earthquake settles losing long/short positions immediately and updates shared net-worth ranking', () => {
  for (const [eventIndex, loser, winner] of [[0, 'long', 'short'], [1, 'short', 'long']]) {
    const state = setup();
    for (const side of ['long', 'short']) {
      const user = state.users[side];
      fx.trade(state, user, 'join', { request_id: `join_${side}`, expected_revision: 0 }, 10000);
      fx.trade(state, user, 'open', { request_id: `open_${side}`, expected_revision: 1, quote_seq: 1, side, margin: 100000, leverage: 10 }, 10001);
    }
    trigger(state, 'quake', eventIndex, 1800);
    const market = state.fx.market;
    assert.equal(state.fx.players[loser].positions.length, 0);
    assert.equal(state.fx.players[loser].history[0].reason, 'liquidation');
    assert.equal(state.fx.players[loser].cash, 899500, 'gap loss stays capped at isolated margin');
    assert.equal(state.fx.players[winner].positions.length, 1);
    assert.equal(fx.rankings(state)[0].user_id, winner);
    assert.deepEqual(fx.view(state, state.users.long).market, fx.view(state, state.users.short).market);
    assert.equal(fx.advanceMarket(state, market.updated_at + 500, () => { throw new Error('same tick must not draw again'); }), false);
  }
});

test('aftershocks fluctuate both ways, expire after ten ticks, and survive a save/reopen without replaying news', () => {
  let state = setup(); trigger(state);
  const news = structuredClone(state.fx.market.news);
  state = JSON.parse(JSON.stringify(state)); fx.normalize(state);
  for (let tick = 1; tick <= 10; tick++) {
    const before = state.fx.market.price;
    const up = tick % 2 === 0;
    fx.advanceMarket(state, state.fx.market.updated_at + 2000, sequence(up ? 20000 : 0));
    const change = state.fx.market.price / before - 1;
    assert.equal(Math.sign(change), up ? 1 : -1);
    assert.ok(Math.abs(change) > .035, 'earthquake aftershocks amplify both directions');
    assert.equal(state.fx.market.event_effect?.remaining_ticks || 0, 10 - tick);
    assert.deepEqual(state.fx.market.news, news);
    assert.equal(state.fx.market.news_history.length, 1);
  }
  assert.equal(state.fx.market.event_effect, null);
  const before = state.fx.market.price;
  fx.advanceMarket(state, state.fx.market.updated_at + 2000, sequence(20000, 99));
  const change = state.fx.market.price / before - 1;
  assert.ok(change > 0 && change < .033, 'normal volatility resumes after the aftershock expires');
});

test('cooldown prevents consecutive disasters, recent headlines avoid repetition, archive remains bounded', () => {
  const state = setup();
  for (let iteration = 0; iteration < 17; iteration++) {
    const previous = state.fx.market.news_history.slice(0, 3).map(item => item.event_id);
    trigger(state, 'rumor');
    assert.ok(!previous.includes(state.fx.market.news.event_id));
    assert.equal(state.fx.market.news_history.length, Math.min(12, iteration + 1));
    for (let tick = 0; tick < 10; tick++) {
      fx.advanceMarket(state, state.fx.market.updated_at + 2000, sequence(10000));
    }
  }
  assert.equal(state.fx.market.event_cooldown, 0);
});

test('legacy markets migrate, offline time cannot consume aftershocks, and extreme prices get inward events', () => {
  const state = setup();
  delete state.fx.market.news_history; delete state.fx.market.event_effect; delete state.fx.market.event_cooldown;
  const previous = structuredClone(state.fx.market.news);
  fx.normalize(state);
  assert.deepEqual(state.fx.market.news, previous);
  assert.deepEqual(state.fx.market.news_history, []);
  trigger(state);
  fx.advanceMarket(state, state.fx.market.updated_at + 86400000, sequence(10000));
  assert.equal(state.fx.market.event_effect.remaining_ticks, 9);
  for (const boundary of [20, 500]) {
    const fresh = setup(); fresh.fx.market.price = boundary;
    trigger(fresh, 'quake', 0, 1800);
    assert.ok(boundary === 20 ? fresh.fx.market.price > boundary : fresh.fx.market.price < boundary);
    assert.ok(fresh.fx.market.price >= 20 && fresh.fx.market.price <= 500);
    assert.equal(Math.sign(fresh.fx.market.news.change_bps), boundary === 20 ? 1 : -1);
  }
});

test('major events wait a full random 15–30 minutes independently of small news and persist across reloads', () => {
  for (const interval of [450, 900]) {
    let state = setup();
    fx.advanceMarket(state, 12000, sequence(10000, interval, 99));
    assert.equal(state.fx.market.major_event_ticks, interval);
    assert.equal('major_event_ticks' in fx.view(state, null).market, false);
    const started = state.fx.market.updated_at;
    const noisyNews = (min, max) => max === 20001 ? 10000 : min;
    for (let tick = 1; tick < interval; tick++) {
      fx.advanceMarket(state, state.fx.market.updated_at + 2000, noisyNews);
      assert.equal(state.fx.market.major_event_ticks, interval - tick);
      assert.ok(state.fx.market.news_history.every(item => item.tier === 'rumor'));
      if (tick === 200) { state = JSON.parse(JSON.stringify(state)); fx.normalize(state); }
    }
    assert.ok(state.fx.market.news_history.length > 0, 'ordinary news stays active');
    fx.advanceMarket(state, state.fx.market.updated_at + 2000, sequence(10000, 99, 0, 800, 900));
    assert.equal(state.fx.market.news.tier, 'quake');
    assert.equal(state.fx.market.updated_at - started, interval === 450 ? 15 * 60000 : 30 * 60000);
    assert.equal(state.fx.market.major_event_ticks, 900, 'next interval is drawn anew');
    // 停服一整天仍只推进一拍，不把停服时间算作等待时间，也不会重抽间隔。
    fx.advanceMarket(state, state.fx.market.updated_at + 86400000, sequence(10000));
    assert.equal(state.fx.market.major_event_ticks, 899);
  }
});

test('upgrading an old market starts a fresh major-event interval without resetting news or positions', () => {
  const state = setup();
  delete state.fx.market.major_event_ticks;
  state.fx.market.event_cooldown = 8;
  const price = state.fx.market.price;
  const news = structuredClone(state.fx.market.news);
  fx.normalize(state);
  assert.equal(state.fx.market.major_event_ticks, null);
  fx.advanceMarket(state, 12000, sequence(10000, 675));
  assert.equal(state.fx.market.major_event_ticks, 675);
  assert.equal(state.fx.market.event_cooldown, 7);
  assert.equal(state.fx.market.price, price);
  assert.deepEqual(state.fx.market.news, news);
});
