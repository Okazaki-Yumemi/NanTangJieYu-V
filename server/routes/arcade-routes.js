'use strict';

const { SESSION_COOKIE } = require('../../shared/constants');
const { sendJson, collectBody, getCookie } = require('../http-utils');
const { getSessionUser } = require('../domain/players');
const { sendPersistenceError } = require('./player-routes');

const DAY = 86400000;
const puzzleLevels = new Set(['spring', 'summer', 'autumn', 'winter', 'boundary', 'frost', 'storehouse', 'crossroads']);

function shanghaiDate(now) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

function scoreLimit(game, mode, now) {
  if (typeof mode !== 'string' || mode.length > 40) return 0;
  if (game === 'puzzle' && puzzleLevels.has(mode)) return 99999;
  if (game === 'danmaku' && ['normal', 'expert'].includes(mode)) return 20000;
  if (game === 'dye' && mode === shanghaiDate(now)) return 99;
  if (game === 'rhythm' && /^(four-seasons|hidden-star)-(normal|hard|expert|master|lunatic)-(original(?:-3m)?|practice)$/.test(mode)) return 10000;
  return 0;
}

function leaderboard(state, key) {
  return Object.entries(state.arcade_scores[key] || {})
    .filter(([id]) => state.users[id] && !state.users[id].banned)
    .sort(([aId, a], [bId, b]) => b.score - a.score || a.at - b.at || aId.localeCompare(bId))
    .slice(0, 20)
    .map(([id, entry], index) => ({ rank: index + 1, display_name: state.users[id].display_name, score: entry.score }));
}

function registerRoutes(router, { store }) {
  router.get('/api/arcade/leaderboard', (req, res, { query }) => {
    const game = query.get('game');
    const mode = query.get('mode');
    if (!scoreLimit(game, mode, Date.now())) {
      return sendJson(res, 400, { error: 'BAD_REQUEST', message: '这个榜单已结束或不存在。' });
    }
    sendJson(res, 200, { rows: leaderboard(store.getLatest(), `${game}:${mode}`) });
  });

  router.post('/api/arcade/score', async (req, res) => {
    let body;
    try { body = await collectBody(req); }
    catch { return sendJson(res, 400, { error: 'BAD_REQUEST', message: '成绩格式不正确。' }); }
    const { game, mode, score } = body || {};
    const session = getCookie(req, SESSION_COOKIE);
    const now = Date.now();
    const max = scoreLimit(game, mode, now);
    if (!Number.isInteger(score) || score < 1 || score > max) {
      return sendJson(res, 400, { error: 'BAD_REQUEST', message: '成绩不在本榜单的范围内。' });
    }
    const key = `${game}:${mode}`;
    try {
      const result = await store.transact((state) => {
        const user = getSessionUser(state, session);
        if (!user) return store.abort({ status: 401, error: 'USER_NOT_FOUND', message: '登录校园账号后可上榜。' });
        if (user.banned) return store.abort({ status: 403, error: 'FORBIDDEN', message: '这个账号不能提交成绩。' });
        const board = state.arcade_scores[key] ||= {};
        const previous = board[user.id];
        if (previous && previous.score >= score) {
          return store.abort({ status: 200, improved: false, best: previous.score });
        }
        board[user.id] = { score, at: now };
        if (game === 'dye') {
          const cutoff = `dye:${shanghaiDate(now - 30 * DAY)}`;
          for (const old of Object.keys(state.arcade_scores)) {
            if (old.startsWith('dye:') && old < cutoff) delete state.arcade_scores[old];
          }
        }
        return { status: 200, improved: true, best: score };
      });
      const { status, ...payload } = result;
      sendJson(res, status, payload);
    } catch (error) {
      sendPersistenceError(res, error);
    }
  });
}

module.exports = { registerRoutes };
