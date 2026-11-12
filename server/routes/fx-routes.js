'use strict';

const { SESSION_COOKIE } = require('../../shared/constants');
const { sendJson, collectBody, getCookie } = require('../http-utils');
const { getSessionUser } = require('../domain/players');
const fx = require('../domain/fx');
const { sendPersistenceError } = require('./player-routes');

function registerRoutes(router, { store }) {
  let refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    const market = store.getLatest().fx?.market;
    if (market && Date.now() - market.updated_at < fx.RULES.tick_ms) return Promise.resolve();
    refreshing = store.transact(state => {
      if (!fx.advanceMarket(state)) return store.abort(null);
    }).finally(() => { refreshing = null; });
    return refreshing;
  }

  router.get('/api/fx/state', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await refresh();
      const state = store.getLatest();
      sendJson(res, 200, fx.view(state, getSessionUser(state, getCookie(req, SESSION_COOKIE))));
    } catch (error) { sendPersistenceError(res, error); }
  });

  for (const action of ['join', 'open', 'close', 'borrow', 'repay', 'work', 'claim-work']) {
    router.post(`/api/fx/${action}`, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      let body;
      try { body = await collectBody(req); }
      catch { return sendJson(res, 400, { error: 'BAD_REQUEST', message: '交易请求格式不正确。' }); }
      try {
        await refresh();
        const result = await store.transact(state => {
          const session = getCookie(req, SESSION_COOKIE);
          const user = getSessionUser(state, session);
          // 错误订单也不能回滚这一拍行情或强平结果。
          const advanced = fx.advanceMarket(state);
          const outcome = fx.trade(state, user, action, body);
          const payload = { ...outcome, ...fx.view(state, user) };
          if (outcome.error && !advanced) return store.abort(payload);
          if (user && !outcome.error) state.sessions[session].last_seen_at = Math.floor(Date.now() / 1000);
          return payload;
        });
        const statuses = { USER_NOT_FOUND: 401, FORBIDDEN: 403, CONFLICT: 409, STALE_QUOTE: 409 };
        sendJson(res, result.error ? statuses[result.error] || 400 : 200, result);
      } catch (error) { sendPersistenceError(res, error); }
    });
  }
  return { refresh };
}

module.exports = { registerRoutes };
