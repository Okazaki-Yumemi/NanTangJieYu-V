'use strict';

// 金额以整数分记账；行情、成交价、持仓和榜单全部由服务端生成。
const { randomInt } = require('node:crypto');
const { newId } = require('../auth');
const events = require('./fx-events');

const RULES = Object.freeze({
  initial_cash: 1000000, min_margin: 10000, max_margin: 10000000000,
  leverages: [1, 5, 10, 20, 50, 100], max_positions: 12,
  fee_rate: 0.0005, half_spread: 0.0004, maintenance_rate: 0.2, tick_ms: 2000,
  loan_amount: 300000, work_pay: 150000, work_ms: 15 * 60 * 1000,
});
const fail = (message, error = 'BAD_REQUEST') => ({ error, message });
const priceRound = value => Math.round(value * 10000) / 10000;

function normalize(state) {
  if (!state.fx || typeof state.fx !== 'object' || Array.isArray(state.fx)) state.fx = {};
  if (!state.fx.players || typeof state.fx.players !== 'object' || Array.isArray(state.fx.players)) state.fx.players = {};
  if (!state.fx.market || !Number.isFinite(state.fx.market.price) || state.fx.market.price <= 0) state.fx.market = null;
  if (state.fx.market) events.normalizeMarket(state.fx.market);
  for (const account of Object.values(state.fx.players)) {
    if (!Number.isSafeInteger(account.debt) || account.debt < 0) account.debt = 0;
    if (!account.job || !Number.isSafeInteger(account.job.ready_at)) account.job = null;
  }
}

function quotes(market) {
  return { bid: priceRound(market.price * (1 - RULES.half_spread)), ask: priceRound(market.price * (1 + RULES.half_spread)) };
}

function markedPosition(position, market) {
  const quote = quotes(market);
  const exit_price = position.side === 'long' ? quote.bid : quote.ask;
  const direction = position.side === 'long' ? 1 : -1;
  const rawPnl = Math.round(position.margin * position.leverage * direction * (exit_price / position.entry_price - 1));
  const pnl = Math.max(-position.margin, rawPnl);
  return { ...position, exit_price, pnl, value: position.margin + pnl };
}

function accountView(account, market) {
  if (!account) return null;
  const positions = account.positions.map(position => markedPosition(position, market));
  const used_margin = positions.reduce((sum, position) => sum + position.margin, 0);
  const floating_pnl = positions.reduce((sum, position) => sum + position.pnl, 0);
  return {
    cash: account.cash, equity: account.cash + used_margin + floating_pnl - (account.debt || 0), used_margin, floating_pnl,
    debt: account.debt || 0, job: account.job || null,
    needs_rescue: needsRescue(account),
    positions, history: account.history, revision: account.revision, started_at: account.started_at,
  };
}

function needsRescue(account) {
  return account.positions.length === 0 && account.cash < RULES.min_margin + Math.ceil(RULES.min_margin * RULES.fee_rate);
}

function settle(account, position, market, now, reason) {
  const marked = markedPosition(position, market);
  account.cash += marked.value;
  account.positions = account.positions.filter(item => item.id !== position.id);
  account.history.unshift({ ...marked, closed_at: now, reason, net_pnl: marked.pnl - position.fee });
  account.history = account.history.slice(0, 30);
}

function advanceMarket(state, now = Date.now(), pick = randomInt) {
  now = Math.floor(now / RULES.tick_ms) * RULES.tick_ms;
  normalize(state);
  if (!state.fx.market) {
    state.fx.market = {
      seq: 1, price: 100, previous: 100, updated_at: now,
      history: [{ at: now, price: 100 }], news: { text: '天弓交易所开市，河童货币报 100 人里元。', at: now },
      news_history: [], event_cooldown: 0, event_effect: null, major_event_ticks: null,
    };
    return true;
  }
  const market = state.fx.market;
  if (now - market.updated_at < RULES.tick_ms) return false;
  // 停服期间行情暂停，不补造玩家无法观察的历史行情。
  const volatility = 0.003 + (market.event_effect?.volatility || 0);
  let move = (pick(0, 20001) - 10000) / 10000 * volatility;
  if (market.event_effect && --market.event_effect.remaining_ticks <= 0) market.event_effect = null;
  const event = events.nextEvent(market, pick);
  if (event) move += event.shock_bps / 10000;
  market.previous = market.price;
  market.price = priceRound(Math.max(20, Math.min(500, market.price * (1 + move))));
  if (event) {
    market.news = {
      id: `fx-news-${market.seq + 1}`, event_id: event.id, tier: event.tier,
      headline: event.headline, text: event.text, at: now,
      change_bps: Math.round((market.price / market.previous - 1) * 10000),
    };
    market.news_history.unshift(market.news);
    market.news_history = market.news_history.slice(0, events.HISTORY_LIMIT);
  }
  market.updated_at = now;
  market.seq += 1;
  market.history.push({ at: now, price: market.price });
  market.history = market.history.slice(-180);
  for (const account of Object.values(state.fx.players)) {
    let liquidated = false;
    for (const position of [...account.positions]) {
      if (markedPosition(position, market).value <= position.margin * RULES.maintenance_rate) {
        settle(account, position, market, now, 'liquidation');
        liquidated = true;
      }
    }
    if (liquidated) account.revision += 1;
  }
  return true;
}

function rankings(state) {
  if (!state.fx?.market) return [];
  return Object.entries(state.fx.players)
    .filter(([id]) => state.users[id] && !state.users[id].banned)
    .map(([id, account]) => ({ user_id: id, display_name: state.users[id].display_name,
      equity: accountView(account, state.fx.market).equity, started_at: account.started_at }))
    .sort((a, b) => b.equity - a.equity || a.started_at - b.started_at || a.user_id.localeCompare(b.user_id))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function view(state, user) {
  const market = state.fx?.market;
  // 不向客户端预告下一场大事件的时间；重启仍从持久化计时继续。
  const { major_event_ticks, ...publicMarket } = market || {};
  const board = rankings(state);
  const publicRow = ({ rank, display_name, equity, user_id }) => ({ rank, display_name, equity, is_me: user_id === user?.id });
  return {
    rules: RULES, server_time: Date.now(), market: market ? { ...publicMarket, ...quotes(market) } : null,
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
  const signature = JSON.stringify([action, body.expected_revision, body.side, body.margin, body.leverage, body.quote_seq, body.position_id]);
  const duplicate = account?.requests.find(item => item.id === body.request_id);
  if (duplicate) return duplicate.signature === signature ? { ok: true, repeated: true } : fail('重复的请求编号对应不同交易。', 'CONFLICT');
  if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision !== (account?.revision || 0)) {
    return fail('账户已更新，请查看最新持仓后重试。', 'CONFLICT');
  }
  if (action === 'join') {
    if (account) return fail('你已经领取过初始资金。', 'CONFLICT');
    account = { cash: RULES.initial_cash, debt: 0, job: null, positions: [], history: [], requests: [], revision: 0, started_at: now };
    state.fx.players[user.id] = account;
  } else {
    if (!account) return fail('请先开启模拟账户。');
    if (action === 'open') {
      if (!['long', 'short'].includes(body.side) || !RULES.leverages.includes(body.leverage) ||
          !Number.isSafeInteger(body.margin) || body.margin < RULES.min_margin || body.margin > RULES.max_margin) return fail('请选择有效方向、保证金和杠杆。');
      // 允许正常轮询/网络延迟的两拍窗口，但始终按当前报价成交，不能锁定旧价套利。
      if (!Number.isSafeInteger(body.quote_seq) || body.quote_seq < 1 || body.quote_seq > market.seq || market.seq - body.quote_seq > 2) {
        return fail('报价已过期，请按最新报价重新下单。', 'STALE_QUOTE');
      }
      if (account.positions.length >= RULES.max_positions) return fail('最多同时持有 12 笔仓位，请先平仓。');
      const fee = Math.ceil(body.margin * body.leverage * RULES.fee_rate);
      if (account.cash < body.margin + fee) return fail('可用余额不足以支付保证金和手续费。');
      const quote = quotes(market);
      account.cash -= body.margin + fee;
      account.positions.push({
        id: newId('fx'), side: body.side, margin: body.margin, leverage: body.leverage, fee,
        entry_price: body.side === 'long' ? quote.ask : quote.bid, opened_at: now,
      });
    } else if (action === 'close') {
      const position = account.positions.find(item => item.id === body.position_id);
      if (!position) return fail('这笔持仓已平仓或不存在。', 'CONFLICT');
      settle(account, position, market, now, 'manual');
    } else if (action === 'borrow') {
      if (!needsRescue(account)) return fail('先平掉持仓；余额不足最低下单额时才能借应急贷款。');
      if (account.debt) return fail('上笔贷款还没还清，河童暂时不肯再借。');
      account.cash += RULES.loan_amount;
      account.debt = RULES.loan_amount;
    } else if (action === 'repay') {
      if (!account.debt) return fail('目前没有需要偿还的贷款。');
      // 一次偿还可用余额与剩余债务中的较小值，不动用持仓保证金。
      const amount = Math.min(account.cash, account.debt);
      if (amount <= 0) return fail('还没有可用余额，先去赚点工钱。');
      account.cash -= amount;
      account.debt -= amount;
    } else if (action === 'work') {
      if (account.job) return fail('已经在打工了，不能同时接两份活。', 'CONFLICT');
      if (!needsRescue(account)) return fail('先平掉持仓；余额不足最低下单额时可以去打黑工。');
      account.job = { started_at: now, ready_at: now + RULES.work_ms };
    } else if (action === 'claim-work') {
      if (!account.job) return fail('还没有接下工作，或工钱已经领取。', 'CONFLICT');
      if (now < account.job.ready_at) return fail('还没到下工时间，15 分钟做满才有工钱。');
      account.cash += RULES.work_pay;
      account.job = null;
    } else return fail('交易操作不存在。');
  }
  account.revision += 1;
  account.requests.push({ id: body.request_id, signature });
  account.requests = account.requests.slice(-60);
  return { ok: true };
}

module.exports = { RULES, normalize, quotes, accountView, markedPosition, advanceMarket, rankings, view, trade };
