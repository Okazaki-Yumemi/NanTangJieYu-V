'use strict';

// 金额以整数分记账；行情、成交价、持仓和榜单全部由服务端生成。
const { randomInt } = require('node:crypto');
const { newId } = require('../auth');
const events = require('./fx-events');
const pricing = require('./fx-market');
const credit = require('./fx-credit');
const profile = require('./fx-profile');
const instruments = require('./fx-pairs');
const { DEFAULT_PAIR, PAIRS, CURRENCIES, marketFor } = instruments;
const { memo } = require('../state-cache');

const RULES = Object.freeze({
  initial_cash: 1000000, min_margin: 10000, max_margin: 10000000000,
  leverages: [1, 5, 10, 20, 50, 100], max_positions: 12,
  fee_rate: 0.0005, half_spread: 0.0004, maintenance_rate: 0.2, tick_ms: 2000,
  loan_amount: 500000, credit_limit: 5000000, credit_min: 10000, credit_hourly_rate: credit.HOURLY_RATE,
  work_pay: 150000, work_ms: 15 * 60 * 1000, work_minutes: [5, 15, 30, 60], work_pay_per_minute: 10000,
  candle_ms: pricing.CANDLE_MS,
});
const fail = (message, error = 'BAD_REQUEST') => ({ error, message });
const priceRound = value => Math.round(value * 10000) / 10000;

function normalize(state) {
  if (!state.fx || typeof state.fx !== 'object' || Array.isArray(state.fx)) state.fx = {};
  if (!state.fx.players || typeof state.fx.players !== 'object' || Array.isArray(state.fx.players)) state.fx.players = {};
  if (!state.fx.market || !Number.isFinite(state.fx.market.price) || state.fx.market.price <= 0) state.fx.market = null;
  if (state.fx.market) { events.normalizeMarket(state.fx.market); pricing.normalizeMarket(state.fx.market); ensurePairs(state.fx.market); }
  for (const account of Object.values(state.fx.players)) {
    if (!Number.isSafeInteger(account.debt) || account.debt < 0) account.debt = 0;
    if (!account.job || !Number.isSafeInteger(account.job.ready_at)) account.job = null;
    if (account.job && !Number.isSafeInteger(account.job.pay)) account.job.pay = RULES.work_pay;
    profile.normalize(account);
    for (const position of [...account.positions, ...account.history]) position.pair_id ??= DEFAULT_PAIR;
  }
}

function ensurePairs(market) {
  if (!market.pairs || typeof market.pairs !== 'object' || Array.isArray(market.pairs)) market.pairs = {};
  for (const pair of PAIRS.slice(1)) {
    if (!market.pairs[pair.id]) {
      const initial = pair.quote === 'human' ? instruments.currency(pair.base).initial
        : instruments.round(market.price / market.pairs.moon_human.price, pair.precision);
      market.pairs[pair.id] = { price: initial, previous: initial, updated_at: market.updated_at, history: [{ at: market.updated_at, price: initial }] };
    }
    pricing.normalizeMarket(market.pairs[pair.id]);
  }
}

function quotes(market, pairId = DEFAULT_PAIR) {
  const pair = instruments.pair(pairId), price = marketFor(market, pairId).price;
  return { bid: instruments.round(price * (1 - RULES.half_spread), pair.precision), ask: instruments.round(price * (1 + RULES.half_spread), pair.precision) };
}

function markedPosition(position, market) {
  const pairId = position.pair_id || DEFAULT_PAIR;
  const quote = quotes(market, pairId);
  const exit_price = position.side === 'long' ? quote.bid : quote.ask;
  const direction = position.side === 'long' ? 1 : -1;
  const rawPnl = Math.round(position.margin * position.leverage * direction * (exit_price / position.entry_price - 1));
  const pnl = Math.max(-position.margin, rawPnl);
  return { ...position, pair_id: pairId, exit_price, pnl, value: position.margin + pnl };
}

function accountView(account, market) {
  if (!account) return null;
  const positions = account.positions.map(position => markedPosition(position, market));
  const used_margin = positions.reduce((sum, position) => sum + position.margin, 0);
  const floating_pnl = positions.reduce((sum, position) => sum + position.pnl, 0);
  return {
    cash: account.cash, equity: account.cash + used_margin + floating_pnl - credit.debt(account), used_margin, floating_pnl,
    debt: credit.debt(account), free_debt: account.debt || 0,
    credit: account.credit ? { principal: account.credit.principal, interest: account.credit.interest, accrued_at: account.credit.accrued_at } : null, job: account.job || null,
    needs_rescue: needsRescue(account),
    profile: profile.view(account),
    positions, history: account.history, revision: account.revision, started_at: account.started_at,
  };
}

function needsRescue(account) {
  return account.positions.length === 0 && account.cash < RULES.min_margin + Math.ceil(RULES.min_margin * RULES.fee_rate);
}

function settle(account, position, market, now, reason) {
  const marked = markedPosition(position, market);
  profile.closed(account, marked.pnl - position.fee, reason);
  account.cash += marked.value;
  account.positions = account.positions.filter(item => item.id !== position.id);
  account.history.unshift({ ...marked, closed_at: now, reason, net_pnl: marked.pnl - position.fee });
  account.history = account.history.slice(0, 30);
  return { action: 'close', pair_id: marked.pair_id, price: marked.exit_price, amount: marked.value, pnl: marked.pnl };
}

function advanceMarket(state, now = Date.now(), pick = randomInt) {
  now = Math.floor(now / RULES.tick_ms) * RULES.tick_ms;
  normalize(state);
  for (const account of Object.values(state.fx.players)) credit.accrue(account, now);
  if (!state.fx.market) {
    state.fx.market = {
      seq: 1, price: 100, previous: 100, updated_at: now,
      history: [{ at: now, price: 100 }], news: { text: '天弓交易所开市，河童货币报 100 人里元。', at: now },
      news_history: [], event_cooldown: 0, event_effect: null, major_event_ticks: null,
    };
    pricing.normalizeMarket(state.fx.market);
    ensurePairs(state.fx.market);
    return true;
  }
  const market = state.fx.market;
  if (now - market.updated_at < RULES.tick_ms) return false;
  // 停服期间行情暂停，不补造玩家无法观察的历史行情。
  const effect = market.event_effect;
  const moves = { kappa: pricing.nextMove(market, pick, { aftershock: (effect?.volatility || 0) * Math.abs(instruments.exposure('kappa', effect?.currency)) }) };
  if (market.event_effect && --market.event_effect.remaining_ticks <= 0) market.event_effect = null;
  const event = events.nextEvent(market, pick);
  for (const currency of CURRENCIES.slice(1)) {
    moves[currency.id] = pricing.nextMove(marketFor(market, `${currency.id}_human`), pick, {
      shared: market.last_noise, regime: market.regime, beta: currency.beta, volatility: currency.volatility,
      reference: currency.initial, aftershock: (effect?.volatility || 0) * Math.abs(instruments.exposure(currency.id, effect?.currency)),
    });
  }
  applyMove(state, moves, event, now);
  return true;
}

function applyMove(state, moves, event, now) {
  const market = state.fx.market;
  const changes = {};
  for (const pair of PAIRS) marketFor(market, pair.id).previous = marketFor(market, pair.id).price;
  for (const currency of CURRENCIES) {
    const current = marketFor(market, `${currency.id}_human`);
    const shock = event ? event.shock_bps / 10000 * instruments.exposure(currency.id, event.currency) : 0;
    current.price = priceRound(Math.max(currency.initial * .2, Math.min(currency.initial * 5, current.price * Math.exp(moves[currency.id] || 0) * (1 + shock))));
    if (event) current.anchor *= 1 + shock * .7; // 新闻部分改变重心，部分在后续波动中消化。
  }
  market.pairs.kappa_moon.price = instruments.round(market.price / market.pairs.moon_human.price, 6);
  for (const pair of PAIRS) {
    const current = marketFor(market, pair.id);
    changes[pair.id] = Math.round((current.price / current.previous - 1) * 10000) || 0;
    current.updated_at = now;
    current.history.push({ at: now, price: current.price });
    current.history = current.history.slice(-180);
    pricing.recordCandle(current, now, current.price, current.previous);
  }
  if (event) {
    market.news = {
      id: `fx-news-${market.seq + 1}`, event_id: event.id, tier: event.tier,
      headline: event.headline, text: event.text, at: now,
      source: event.source || '文文日报',
      currency: event.currency || 'kappa', changes, change_bps: changes[DEFAULT_PAIR],
    };
    market.news_history.unshift(market.news);
    market.news_history = market.news_history.slice(0, events.HISTORY_LIMIT);
  }
  market.updated_at = now;
  market.seq += 1;
  for (const account of Object.values(state.fx.players)) {
    const exposed = account.positions.length > 0;
    let liquidated = false;
    for (const position of [...account.positions]) {
      if (markedPosition(position, market).value <= position.margin * RULES.maintenance_rate) {
        settle(account, position, market, now, 'liquidation');
        liquidated = true;
      }
    }
    if (liquidated) account.revision += 1;
    if (event && exposed) profile.witnessed(account, event, account.positions.length > 0);
    profile.check(account, account.cash - credit.debt(account) + account.positions.reduce((sum, position) => sum + markedPosition(position, market).value, 0), now);
  }
}

function triggerEvent(state, eventId, now = Date.now(), pick = randomInt) {
  const item = events.CATALOG.find(item => item.id === eventId);
  if (!item) return fail('请选择有效的新闻事件。');
  normalize(state);
  if (!state.fx.market) advanceMarket(state, now, pick);
  const market = state.fx.market;
  const relativePrice = events.relativePrice(market, item);
  if ((relativePrice <= 25 && item.direction < 0) || (relativePrice >= 420 && item.direction > 0)) return fail('目标货币汇率接近边界，请选择向区间内冲击的事件。');
  const tier = events.TIERS[item.tier];
  const event = { ...item, shock_bps: item.direction * pick(tier.min_bps, tier.max_bps + 1) };
  market.event_cooldown = events.COOLDOWN_TICKS;
  market.event_effect = tier.aftershock_ticks ? { tier: item.tier, currency: item.currency, headline: item.headline, remaining_ticks: tier.aftershock_ticks, volatility: tier.volatility } : null;
  if (item.tier !== 'rumor') market.major_event_ticks = pick(events.MAJOR_EVENT_MIN_TICKS, events.MAJOR_EVENT_MAX_TICKS + 1);
  for (const account of Object.values(state.fx.players)) credit.accrue(account, now);
  applyMove(state, {}, event, Math.floor(now / RULES.tick_ms) * RULES.tick_ms);
  return { ok: true, event: market.news };
}

function rankings(state) {
  if (!state.fx?.market) return [];
  return memo(state, 'fx-rankings', () => Object.entries(state.fx.players)
    .filter(([id]) => state.users[id] && !state.users[id].banned)
    .map(([id, account]) => ({ user_id: id, display_name: state.users[id].display_name, title: profile.title(account),
      equity: account.cash - credit.debt(account) + account.positions.reduce((sum, position) => sum + markedPosition(position, state.fx.market).value, 0), started_at: account.started_at }))
    .sort((a, b) => b.equity - a.equity || a.started_at - b.started_at || a.user_id.localeCompare(b.user_id))
    .map((row, index) => ({ ...row, rank: index + 1 })));
}

function pairSummaries(market) {
  return market ? PAIRS.map(pair => {
    const current = marketFor(market, pair.id);
    return { ...pair, price: current.price, previous: current.previous, ...quotes(market, pair.id) };
  }) : [];
}

function view(state, user, pairId = DEFAULT_PAIR) {
  const market = state.fx?.market;
  const selected = market && marketFor(market, pairId);
  const newsView = news => news && ({ ...news, change_bps: news.changes?.[pairId] ?? (pairId === DEFAULT_PAIR ? news.change_bps : null) });
  // 只发送当前品种的完整图表；其他货币只发报价，不公开趋势/波动状态或事件倒计时。
  const publicMarket = selected ? {
    pair_id: pairId, name: instruments.pair(pairId).name, precision: instruments.pair(pairId).precision,
    seq: market.seq, updated_at: market.updated_at, price: selected.price, previous: selected.previous,
    history: selected.history, candles: selected.candles, tick_candles: selected.tick_candles,
    news: newsView(market.news), news_history: market.news_history.map(newsView), event_effect: market.event_effect,
    ...quotes(market, pairId),
  } : null;
  const board = rankings(state);
  const publicRow = ({ rank, display_name, equity, user_id, title }) => ({ rank, display_name, equity, title, is_me: user_id === user?.id });
  return {
    rules: RULES, server_time: Date.now(), market: publicMarket, pairs: pairSummaries(market),
    achievements: profile.CATALOG, news_total: events.CATALOG.length,
    authenticated: Boolean(user), can_trade: Boolean(user && !user.banned),
    account: user && !user.banned && market ? accountView(state.fx.players[user.id], market) : null,
    rows: board.slice(0, 20).map(publicRow), total_players: board.length,
    my_rank: board.find(row => row.user_id === user?.id)?.rank || null,
  };
}

function trade(state, user, action, body, now = Date.now()) {
  if (!user) return fail('请先登录校园账号。', 'USER_NOT_FOUND');
  if (user.banned) return fail('这个账号不能参与交易。', 'FORBIDDEN');
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.request_id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.request_id)) return fail('交易请求格式不正确。');
  const market = state.fx.market;
  let account = state.fx.players[user.id];
  const fields = [action, body.expected_revision, body.side, body.margin, body.leverage, body.quote_seq, body.position_id];
  if (body.amount !== undefined || body.minutes !== undefined || body.title !== undefined) fields.push(body.amount, body.minutes, body.title);
  if (body.pair_id !== undefined) fields.push(['pair', body.pair_id]);
  const signature = JSON.stringify(fields);
  const duplicate = account?.requests.find(item => item.id === body.request_id);
  if (duplicate) return duplicate.signature === signature ? { ok: true, repeated: true, receipt: duplicate.receipt } : fail('重复的请求编号对应不同交易。', 'CONFLICT');
  const pairId = body.pair_id === undefined ? DEFAULT_PAIR : body.pair_id;
  if (!instruments.pair(pairId)) return fail('请选择有效的货币对。');
  if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision !== (account?.revision || 0)) {
    return fail('账户已更新，请查看最新持仓后重试。', 'CONFLICT');
  }
  if (['open', 'close'].includes(action) && body.quote_seq !== market.seq) {
    return fail('行情已变化，本次未成交。请确认最新报价后重新下单。', 'STALE_QUOTE');
  }
  let receipt;
  if (action === 'join') {
    if (account) return fail('你已经领取过初始资金。', 'CONFLICT');
    account = { cash: RULES.initial_cash, debt: 0, job: null, positions: [], history: [], requests: [], revision: 0, started_at: now };
    state.fx.players[user.id] = account;
  } else {
    if (!account) return fail('请先开启模拟账户。');
    profile.normalize(account);
    credit.accrue(account, now);
    if (action === 'open') {
      if (!['long', 'short'].includes(body.side) || !RULES.leverages.includes(body.leverage) ||
          !Number.isSafeInteger(body.margin) || body.margin < RULES.min_margin || body.margin > RULES.max_margin) return fail('请选择有效方向、保证金和杠杆。');
      if (account.positions.length >= RULES.max_positions) return fail('最多同时持有 12 笔仓位，请先平仓。');
      const fee = Math.ceil(body.margin * body.leverage * RULES.fee_rate);
      if (account.cash < body.margin + fee) return fail('可用余额不足以支付保证金和手续费。');
      const quote = quotes(market, pairId);
      profile.opened(account, body.side);
      account.cash -= body.margin + fee;
      account.positions.push({
        id: newId('fx'), pair_id: pairId, side: body.side, margin: body.margin, leverage: body.leverage, fee,
        entry_price: body.side === 'long' ? quote.ask : quote.bid, opened_at: now,
      });
      receipt = { action: 'open', pair_id: pairId, price: body.side === 'long' ? quote.ask : quote.bid, margin: body.margin, fee, amount: body.margin + fee };
    } else if (action === 'close') {
      const position = account.positions.find(item => item.id === body.position_id);
      if (!position) return fail('这笔持仓已平仓或不存在。', 'CONFLICT');
      if (body.pair_id !== undefined && body.pair_id !== (position.pair_id || DEFAULT_PAIR)) return fail('平仓货币对与持仓不符。', 'CONFLICT');
      receipt = settle(account, position, market, now, 'manual');
    } else if (action === 'borrow') {
      if (!needsRescue(account)) return fail('先平掉持仓；余额不足最低下单额时才能借应急贷款。');
      if (credit.debt(account)) return fail('上笔贷款还没还清，河童暂时不肯再借。');
      account.cash += RULES.loan_amount;
      account.debt = RULES.loan_amount;
    } else if (action === 'borrow-credit') {
      if (account.credit) return fail('请先还清上一笔有息贷款。');
      if (!Number.isSafeInteger(body.amount) || body.amount < RULES.credit_min || body.amount > RULES.credit_limit) return fail('有息贷款金额须为 100～50,000 人里元。');
      account.cash += body.amount;
      account.credit = { principal: body.amount, interest: 0, remainder: 0, accrued_at: now };
    } else if (action === 'repay') {
      if (!credit.debt(account)) return fail('目前没有需要偿还的贷款。');
      if (account.cash <= 0) return fail('还没有可用余额，先去赚点工钱。');
      credit.repay(account);
      if (!credit.debt(account)) account.profile.stats.loans_cleared++;
    } else if (action === 'work') {
      if (account.job) return fail('已经在打工了，不能同时接两份活。', 'CONFLICT');
      const minutes = body.minutes === undefined ? 15 : body.minutes;
      if (!RULES.work_minutes.includes(minutes)) return fail('请选择 5、15、30 或 60 分钟的工作。');
      account.job = { started_at: now, ready_at: now + minutes * 60000, pay: minutes * RULES.work_pay_per_minute };
    } else if (action === 'claim-work') {
      if (!account.job) return fail('还没有接下工作，或工钱已经领取。', 'CONFLICT');
      if (now < account.job.ready_at) return fail('还没到下工时间，做满所选时长才有工钱。');
      account.cash += account.job.pay ?? RULES.work_pay;
      account.profile.stats.jobs++;
      account.profile.stats.work_earned += account.job.pay ?? RULES.work_pay;
      account.job = null;
    } else if (action === 'set-title') {
      if (body.title !== null && (!profile.CATALOG.some(item => item.id === body.title) || !Object.hasOwn(account.profile.unlocked, body.title))) return fail('这个称号还没有解锁。');
      account.profile.title = body.title;
    } else return fail('交易操作不存在。');
  }
  profile.check(account, account.cash - credit.debt(account) + account.positions.reduce((sum, position) => sum + markedPosition(position, market).value, 0), now);
  account.revision += 1;
  account.requests.push({ id: body.request_id, signature, ...(receipt ? { receipt } : {}) });
  account.requests = account.requests.slice(-60);
  return { ok: true, ...(receipt ? { receipt } : {}) };
}

module.exports = { RULES, normalize, quotes, accountView, markedPosition, advanceMarket, triggerEvent, rankings, view, trade, pairSummaries };
