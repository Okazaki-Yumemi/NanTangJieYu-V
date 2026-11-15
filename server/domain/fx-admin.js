'use strict';
const fx = require('./fx');
const { CATALOG, TIERS } = require('./fx-events');
const { currency } = require('./fx-pairs');
const { logAdminAction } = require('./admin-log');
const fail = message => ({ error: 'BAD_REQUEST', message });

function view(state) {
  const market = state.fx?.market;
  return {
    price: market?.price ?? null, news: market?.news ?? null,
    pairs: fx.pairSummaries(market),
    players: Object.entries(state.fx?.players || {}).filter(([id]) => state.users[id]).map(([id, account]) => ({
      id, display_name: state.users[id].display_name, banned: Boolean(state.users[id].banned),
      cash: account.cash, equity: market ? fx.accountView(account, market).equity : account.cash,
    })).sort((a, b) => b.equity - a.equity),
    events: CATALOG.map(event => ({ ...event, currency_name: currency(event.currency).name, min_bps: TIERS[event.tier].min_bps, max_bps: TIERS[event.tier].max_bps })),
  };
}
function operate(state, action, body, now = Date.now()) {
  if (!body || typeof body !== 'object' || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.request_id || '')) return fail('操作编号无效。');
  const signature = JSON.stringify([action, body.user_id, body.amount, body.reason, body.event_id]);
  const requests = state.fx?.admin_requests || [];
  const previous = requests.find(item => item.id === body.request_id);
  if (previous) return previous.signature === signature ? { ok: true, repeated: true, message: '已确认原操作，没有重复执行。' } : fail('操作编号对应不同内容。');
  let detail;
  if (action === 'credit') {
    const user = state.users[body.user_id], account = state.fx?.players[body.user_id];
    if (!user || user.banned || !account) return fail('请选择已开户且未封禁的玩家。');
    if (!Number.isSafeInteger(body.amount) || body.amount <= 0 || body.amount > 100000000 || !Number.isSafeInteger(account.cash + body.amount)) return fail('单次加款须为 0.01～1,000,000 人里元。');
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 120) return fail('请填写 1～120 字的加款原因。');
    const before = account.cash;
    account.cash += body.amount;
    account.revision++;
    detail = { user_id: user.id, display_name: user.display_name, amount: body.amount, before, after: account.cash, reason: body.reason.trim() };
  } else if (action === 'event') {
    const before = Object.fromEntries(fx.pairSummaries(state.fx?.market).map(pair => [pair.id, pair.price]));
    const result = fx.triggerEvent(state, body.event_id, now);
    if (result.error) return result;
    const pairId = `${result.event.currency}_human`;
    const target = fx.pairSummaries(state.fx.market).find(pair => pair.id === pairId);
    detail = { event_id: body.event_id, currency: result.event.currency, pair_id: pairId, headline: result.event.headline,
      before: before[pairId] ?? currency(result.event.currency).initial, after: target.price,
      change_bps: result.event.changes[pairId], changes: result.event.changes };
  } else return fail('未知操作。');
  logAdminAction(state, `fx_${action}`, { ...detail, request_id: body.request_id }, Math.floor(now / 1000));
  state.fx.admin_requests = [...requests, { id: body.request_id, signature }].slice(-200);
  return { ok: true, message: action === 'credit' ? '模拟资金已到账。' : '新闻已触发，汇率和强平已同步。' };
}
module.exports = { view, operate };
