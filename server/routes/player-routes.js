'use strict';

/**
 * 玩家端 API 路由。
 */

const { ERROR_CODES, SESSION_COOKIE } = require('../../shared/constants');
const { newToken } = require('../auth');
const interactions = require('../domain/interactions');
const players = require('../domain/players');
const contributions = require('../domain/contributions');
const views = require('../views');
const regions = require('../domain/regions');
const {
  sendJson,
  collectBody,
  getCookie,
  setSessionCookie,
  clearSessionCookie
} = require('../http-utils');

const ERROR_STATUS = {
  [ERROR_CODES.USER_NOT_FOUND]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.REGION_NOT_FOUND]: 404,
  [ERROR_CODES.INTERACTION_NOT_FOUND]: 404,
  [ERROR_CODES.PRIZE_NOT_FOUND]: 404,
  [ERROR_CODES.RATE_LIMITED]: 429
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sendDomainError(res, result) {
  sendJson(res, ERROR_STATUS[result.error] || 400, result);
}

function sendPersistenceError(res, error) {
  console.error('[api] 状态事务失败:', error);
  sendJson(res, 500, {
    error: ERROR_CODES.INTERNAL_ERROR,
    message: '服务器状态保存失败，请稍后重试或联系工作人员。'
  });
}

async function readBodyOr400(req, res) {
  try {
    return await collectBody(req);
  } catch {
    sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
    return null;
  }
}

function buildHomeResponse(store, seeds, userId, stateOverride = null) {
  const state = stateOverride || store.getLatest();
  const user = players.getUser(state, userId);
  return {
    ok: true,
    state: views.buildPlayerHomeState(state, seeds, user)
  };
}

/**
 * 在一个状态事务内完成「解析/创建玩家会话 → 执行变更」。
 * 事务成功且会话为新建时，向浏览器种下会话 Cookie。
 */
function transactWithSession(appCtx, req, res, mutator) {
  return appCtx.store.transact((state) => {
    const now = nowSec();
    let sessionId = getCookie(req, SESSION_COOKIE);
    let isNew = false;
    let session = sessionId ? state.sessions[sessionId] : null;
    if (!session) {
      sessionId = newToken(24);
      isNew = true;
      session = { user_id: '', created_at: now, last_seen_at: now };
      state.sessions[sessionId] = session;
    } else {
      session.last_seen_at = now;
    }

    const outcome = mutator(state, { seeds: appCtx.seeds, now }, { sessionId, session });
    if (outcome && outcome.error) {
      return appCtx.store.abort(outcome);
    }
    return { ...outcome, __session: { id: sessionId, isNew } };
  }).then((result) => {
    if (result && result.__session) {
      if (result.__session.isNew) {
        setSessionCookie(res, SESSION_COOKIE, result.__session.id, {
          secure: appCtx.config.cookieSecure
        });
      }
      const { __session, ...rest } = result;
      return rest;
    }
    return result;
  });
}

function registerRoutes(router, appCtx) {
  const { seeds, store } = appCtx;

  router.post('/api/player/register', async (req, res) => {
    const body = await readBodyOr400(req, res);
    if (body === null) {
      return;
    }
    try {
      const result = await transactWithSession(appCtx, req, res, (state, ctx, sessionInfo) => {
        const registered = players.registerPlayer(state, body, ctx, ctx.now);
        if (registered.error) {
          return registered;
        }
        sessionInfo.session.user_id = registered.user.id;
        return { user_id: registered.user.id };
      });
      if (result.error) {
        sendDomainError(res, result);
        return;
      }
      sendJson(res, 200, buildHomeResponse(store, seeds, result.user_id));
    } catch (error) {
      sendPersistenceError(res, error);
    }
  });

  router.post('/api/player/login', async (req, res) => {
    const body = await readBodyOr400(req, res);
    if (body === null) {
      return;
    }
    try {
      const result = await transactWithSession(appCtx, req, res, (state, ctx, sessionInfo) => {
        const loggedIn = players.loginPlayer(state, body, ctx, ctx.now);
        if (loggedIn.error) {
          return loggedIn;
        }
        sessionInfo.session.user_id = loggedIn.user.id;
        return { user_id: loggedIn.user.id };
      });
      if (result.error) {
        sendDomainError(res, result);
        return;
      }
      sendJson(res, 200, buildHomeResponse(store, seeds, result.user_id));
    } catch (error) {
      sendPersistenceError(res, error);
    }
  });

  router.post('/api/player/logout', async (req, res) => {
    try {
      await store.transact((state) => {
        players.destroySession(state, getCookie(req, SESSION_COOKIE));
        return { ok: true };
      });
      clearSessionCookie(res, SESSION_COOKIE, { secure: appCtx.config.cookieSecure });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendPersistenceError(res, error);
    }
  });

  router.get('/api/player/state', async (req, res) => {
    try {
      const state = store.getLatest();
      const user = players.getSessionUser(state, getCookie(req, SESSION_COOKIE));
      if (!user) {
        sendJson(res, 401, { error: ERROR_CODES.USER_NOT_FOUND, message: '请先注册或登录。' });
        return;
      }
      sendJson(res, 200, buildHomeResponse(store, seeds, user.id));
    } catch (error) {
      sendPersistenceError(res, error);
    }
  });

  router.post('/api/player/interact', async (req, res) => {
    const body = await readBodyOr400(req, res);
    if (body === null) {
      return;
    }
    try {
      const result = await store.transact((state) => {
        const now = nowSec();
        const cookieSessionId = getCookie(req, SESSION_COOKIE);
        const user = players.getSessionUser(state, cookieSessionId);
        if (!user) {
          return store.abort({ error: ERROR_CODES.USER_NOT_FOUND, message: '请先注册或登录。' });
        }
        // 活跃玩家的会话按滑动窗口续期，避免 TTL 从登录时刻起算误伤长时间在线用户。
        if (cookieSessionId && state.sessions[cookieSessionId]) {
          state.sessions[cookieSessionId].last_seen_at = now;
        }
        const outcome = interactions.performInteraction(state, user, body, { seeds, now });
        if (outcome.error) {
          return store.abort(outcome);
        }
        return {
          action_result: outcome.action_result,
          duplicate: Boolean(outcome.duplicate),
          ledger_entry: outcome.ledger_entry,
          state: buildHomeResponse(store, seeds, user.id, state).state
        };
      });
      if (result.error) {
        sendDomainError(res, result);
        return;
      }
      if (result.ledger_entry) {
        contributions.appendToLedgerFile(
          appCtx.config.dataDir,
          appCtx.config.ledgerFileName,
          [result.ledger_entry]
        );
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendPersistenceError(res, error);
    }
  });

  router.get('/api/player/leaderboard/:regionId', async (req, res, context) => {
    const state = store.getLatest();
    const configRegion = regions.getConfigRegion(seeds, context.params.regionId);
    if (!configRegion) {
      sendJson(res, 404, { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' });
      return;
    }
    sendJson(res, 200, {
      region_id: configRegion.id,
      rows: regions.buildRegionLeaderboard(state, configRegion.id, 20)
    });
  });
}

module.exports = {
  registerRoutes,
  sendPersistenceError,
  buildHomeResponse,
  nowSec
};
