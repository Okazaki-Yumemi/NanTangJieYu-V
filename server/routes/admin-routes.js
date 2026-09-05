'use strict';

/**
 * 管理端 API 路由。所有写操作均写入 AdminLog；贡献调整写入贡献流水。
 */

const { ADMIN_COOKIE, ERROR_CODES, ACTIVITY_STATUS } = require('../../shared/constants');
const { newToken } = require('../auth');
const players = require('../domain/players');
const regions = require('../domain/regions');
const codesModule = require('../domain/codes');
const contributions = require('../domain/contributions');
const lottery = require('../domain/lottery');
const adminLog = require('../domain/admin-log');
const weights = require('../domain/weights');
const views = require('../views');
const {
  sendJson,
  sendText,
  collectBody,
  getCookie,
  setSessionCookie,
  clearSessionCookie
} = require('../http-utils');

const MAX_LOGIN_FAILURES = 20;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginFailures = new Map();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function checkLoginRate(clientKey) {
  const now = Date.now();
  const record = loginFailures.get(clientKey);
  if (!record || now - record.windowStart > LOGIN_WINDOW_MS) {
    loginFailures.delete(clientKey);
    return true;
  }
  return record.count < MAX_LOGIN_FAILURES;
}

function recordLoginFailure(clientKey) {
  const now = Date.now();
  const record = loginFailures.get(clientKey);
  if (!record || now - record.windowStart > LOGIN_WINDOW_MS) {
    loginFailures.set(clientKey, { count: 1, windowStart: now });
    return;
  }
  record.count += 1;
}

function getAdminSession(state, req) {
  const sessionId = getCookie(req, ADMIN_COOKIE);
  if (!sessionId) {
    return null;
  }
  return state.admin_sessions[sessionId] ? { sessionId } : null;
}

function requireAdmin(state, req) {
  const session = getAdminSession(state, req);
  if (!session) {
    return null;
  }
  return session;
}

/**
 * 执行管理事务：校验会话 → 执行 → 收集待写流水。
 */
function adminTransact(appCtx, req, mutator) {
  return appCtx.store.transact((state) => {
    const now = nowSec();
    const session = requireAdmin(state, req);
    if (!session) {
      return appCtx.store.abort({ error: ERROR_CODES.FORBIDDEN, message: '请先登录管理后台。' });
    }
    // 管理操作同样为会话续期：TTL 从最近操作起算而非登录时刻。
    state.admin_sessions[session.sessionId].last_seen_at = now;
    const outcome = mutator(state, { seeds: appCtx.seeds, now }, session);
    if (outcome && outcome.error) {
      return appCtx.store.abort(outcome);
    }
    return outcome;
  }).then((result) => {
    if (result && Array.isArray(result.__ledgerEntries) && result.__ledgerEntries.length > 0) {
      const entries = result.__ledgerEntries;
      delete result.__ledgerEntries;
      contributions.appendToLedgerFile(
        appCtx.config.dataDir,
        appCtx.config.ledgerFileName,
        entries
      );
    }
    return result;
  });
}

function flushPlayerLedger(appCtx, entries) {
  contributions.appendToLedgerFile(appCtx.config.dataDir, appCtx.config.ledgerFileName, entries);
}

function registerRoutes(router, appCtx) {
  const { seeds, store, config } = appCtx;

  router.post('/api/admin/login', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    const clientKey = req.socket.remoteAddress || 'unknown';
    if (!checkLoginRate(clientKey)) {
      sendJson(res, 429, { error: ERROR_CODES.RATE_LIMITED, message: '尝试过于频繁，请稍后再试。' });
      return;
    }
    if (String(body.password || '') !== config.admin.password) {
      recordLoginFailure(clientKey);
      sendJson(res, 401, { error: ERROR_CODES.FORBIDDEN, message: '口令错误。' });
      return;
    }
    try {
      const result = await store.transact((state) => {
        const sessionId = newToken(24);
        state.admin_sessions[sessionId] = { created_at: nowSec(), last_seen_at: nowSec() };
        return { adminSessionId: sessionId, admin: views.buildAdminState(state, seeds) };
      });
      setSessionCookie(res, ADMIN_COOKIE, result.adminSessionId, { secure: config.cookieSecure });
      sendJson(res, 200, { ok: true, admin: result.admin });
    } catch (error) {
      console.error('[admin] 登录失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '登录失败，请重试。' });
    }
  });

  router.post('/api/admin/logout', async (req, res) => {
    try {
      await store.transact((state) => {
        const sessionId = getCookie(req, ADMIN_COOKIE);
        if (sessionId && state.admin_sessions[sessionId]) {
          delete state.admin_sessions[sessionId];
        }
        return { ok: true };
      });
      clearSessionCookie(res, ADMIN_COOKIE, { secure: config.cookieSecure });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error('[admin] 登出失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '登出失败。' });
    }
  });

  router.get('/api/admin/bootstrap', async (req, res) => {
    const state = store.getLatest();
    if (!requireAdmin(state, req)) {
      sendJson(res, 401, { error: ERROR_CODES.FORBIDDEN, message: '请先登录。' });
      return;
    }
    sendJson(res, 200, { ok: true, admin: views.buildAdminState(state, seeds) });
  });

  router.post('/api/admin/activity', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const action = String(body.action || '');
        const activity = state.activity;
        const transitions = {
          start: { from: [ACTIVITY_STATUS.SCHEDULED], to: ACTIVITY_STATUS.RUNNING, stamp: 'started_at' },
          pause: { from: [ACTIVITY_STATUS.RUNNING], to: ACTIVITY_STATUS.PAUSED, stamp: 'paused_at' },
          resume: { from: [ACTIVITY_STATUS.PAUSED], to: ACTIVITY_STATUS.RUNNING, stamp: 'resumed_at' },
          end: { from: [ACTIVITY_STATUS.RUNNING, ACTIVITY_STATUS.PAUSED], to: ACTIVITY_STATUS.ENDED, stamp: 'ended_at' }
        };
        if (action === 'open_registration' || action === 'close_registration') {
          activity.registration_open = action === 'open_registration';
          adminLog.logAdminAction(
            state,
            'activity_registration',
            { registration_open: activity.registration_open },
            ctx.now
          );
          return { ok: true, message: activity.registration_open ? '已开放注册。' : '已关闭注册。' };
        }
        if (action === 'advance_stage') {
          // 强制进入下一阶段：按推进顺序找到第一个未解决的区域，强制 CLEAR。
          const ordered = [...seeds.regions].sort((a, b) => a.order - b.order);
          const current = ordered.find((region) => state.regions[region.id] && !state.regions[region.id].cleared);
          if (!current) {
            return { error: ERROR_CODES.NO_CHANGE, message: '全部区域都已经解决，没有可推进的阶段。' };
          }
          const result = regions.forceClear(state, current, ctx.now);
          if (result.error) {
            return result;
          }
          const next = ordered.find((region) => {
            const runtime = state.regions[region.id];
            return runtime && !runtime.cleared;
          });
          const message = next
            ? `已强制解决「${current.name}」，下一阶段「${next.name}」开启。`
            : `已强制解决「${current.name}」，全部区域解决完毕！`;
          regions.pushSystemEvent(state, { kind: 'stage_advanced', region_id: current.id, message }, ctx.now);
          adminLog.logAdminAction(
            state,
            'advance_stage',
            { cleared_region: current.id, next_region: next ? next.id : null },
            ctx.now
          );
          return { ok: true, message };
        }
        const transition = transitions[action];
        if (!transition) {
          return { error: ERROR_CODES.BAD_REQUEST, message: '未知的活动操作。' };
        }
        if (!transition.from.includes(activity.status)) {
          return { error: ERROR_CODES.NO_CHANGE, message: `当前状态（${activity.status}）不能执行该操作。` };
        }
        activity.status = transition.to;
        activity[transition.stamp] = ctx.now;
        activity.updated_at = ctx.now;
        adminLog.logAdminAction(state, 'activity_status', { action, status: activity.status }, ctx.now);
        return { ok: true, message: `活动状态已更新为 ${activity.status}。` };
      });
      if (result.error) {
        sendJson(res, 400, result);
        return;
      }
      sendJson(res, 200, { ...result, admin: views.buildAdminState(store.getLatest(), seeds) });
    } catch (error) {
      console.error('[admin] 活动操作失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '操作失败。' });
    }
  });

  router.post('/api/admin/region', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const configRegion = regions.getConfigRegion(seeds, String(body.region_id || ''));
        if (!configRegion) {
          return { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' };
        }
        const op = String(body.op || '');
        let opResult;
        switch (op) {
          case 'set_anomaly':
            opResult = regions.setAnomaly(state, configRegion, body.value, ctx.now);
            break;
          case 'force_clear':
            opResult = regions.forceClear(state, configRegion, ctx.now);
            break;
          case 'force_unlock':
            opResult = regions.setForcedUnlock(state, configRegion, true, ctx.now);
            break;
          case 'close':
            opResult = regions.setClosed(state, configRegion, true, ctx.now);
            break;
          case 'reopen':
            opResult = regions.setClosed(state, configRegion, false, ctx.now);
            break;
          default:
            return { error: ERROR_CODES.BAD_REQUEST, message: '未知区域操作。' };
        }
        if (opResult.error) {
          return opResult;
        }
        adminLog.logAdminAction(
          state,
          'region_admin',
          {
            region_id: configRegion.id,
            op,
            value: body.value === undefined ? null : body.value,
            runtime: { ...state.regions[configRegion.id] }
          },
          ctx.now
        );
        return { ok: true, message: `「${configRegion.name}」操作完成。` };
      });
      if (result.error) {
        sendJson(res, result.error === ERROR_CODES.REGION_NOT_FOUND ? 404 : 400, result);
        return;
      }
      sendJson(res, 200, { ...result, admin: views.buildAdminState(store.getLatest(), seeds) });
    } catch (error) {
      console.error('[admin] 区域操作失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '操作失败。' });
    }
  });

  router.post('/api/admin/player', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const user = state.users[String(body.user_id || '')];
        if (!user) {
          return { error: ERROR_CODES.USER_NOT_FOUND, message: '玩家不存在。' };
        }
        const op = String(body.op || '');
        let ledgerEntries = [];

        if (op === 'adjust_contribution') {
          const amount = Math.floor(Number(body.amount));
          if (!Number.isFinite(amount) || amount === 0) {
            return { error: ERROR_CODES.VALIDATION_FAILED, message: '请输入非零的贡献调整量。' };
          }
          const reason = String(body.reason || '').trim() || '管理员调整';
          let regionId = String(body.region_id || '');
          if (regionId && !regions.getConfigRegion(seeds, regionId)) {
            return { error: ERROR_CODES.VALIDATION_FAILED, message: '区域不存在。' };
          }
          const entry = contributions.applyContribution(
            state,
            contributions.buildLedgerEntry({
              kind: 'admin',
              user_id: user.id,
              team: user.team,
              region_id: regionId,
              reason,
              user_delta: amount,
              team_delta: amount,
              request_id: 'admin'
            }, ctx.now)
          );
          ledgerEntries = [entry];
          contributions.trimLedger(state, seeds.activity.ledger_recent_limit);
          if (regionId) {
            regions.addParticipant(state, regionId, user.id);
          }
          adminLog.logAdminAction(
            state,
            'player_adjust_contribution',
            {
              user_id: user.id,
              display_name: user.display_name,
              amount,
              region_id: regionId,
              reason,
              ledger_id: entry.id
            },
            ctx.now
          );
        } else if (op === 'ban' || op === 'unban') {
          user.banned = op === 'ban';
          user.updated_at = ctx.now;
          adminLog.logAdminAction(
            state,
            'player_ban_toggle',
            { user_id: user.id, display_name: user.display_name, banned: user.banned },
            ctx.now
          );
        } else if (op === 'reset_password') {
          const password = String(body.password || '');
          if (password.length < Math.max(1, Number(seeds.activity.password_min_length) || 4)) {
            return { error: ERROR_CODES.VALIDATION_FAILED, message: '新密码太短。' };
          }
          const { hashPassword } = require('../auth');
          const record = hashPassword(password);
          user.password_salt = record.salt;
          user.password_hash = record.hash;
          user.updated_at = ctx.now;
          adminLog.logAdminAction(
            state,
            'player_reset_password',
            { user_id: user.id, display_name: user.display_name },
            ctx.now
          );
        } else if (op === 'restore_energy') {
          const cap = Math.max(1, Math.floor(Number(seeds.activity.energy_cap) || 5));
          user.energy = cap;
          user.last_energy_at = ctx.now;
          user.updated_at = ctx.now;
          adminLog.logAdminAction(
            state,
            'player_restore_energy',
            { user_id: user.id, display_name: user.display_name },
            ctx.now
          );
        } else if (op === 'rename') {
          const result = players.renamePlayer(state, user, String(body.display_name || ''), seeds);
          if (result.error) {
            return result;
          }
          adminLog.logAdminAction(
            state,
            'player_rename',
            {
              user_id: user.id,
              previous_display_name: result.previous_display_name,
              display_name: user.display_name
            },
            ctx.now
          );
        } else if (op === 'switch_team') {
          const teamId = String(body.team || '');
          const result = players.switchTeam(state, user, teamId);
          if (result.error) {
            return result;
          }
          contributions.applyContribution(
            state,
            contributions.buildLedgerEntry({
              kind: 'admin',
              user_id: user.id,
              team: user.team,
              reason: `管理员调整阵营（${result.previous_team} → ${user.team}）`,
              user_delta: 0,
              team_delta: 0,
              meta: {
                previous_team: result.previous_team,
                moved_contribution: result.moved_contribution
              }
            }, ctx.now)
          );
          adminLog.logAdminAction(
            state,
            'player_switch_team',
            {
              user_id: user.id,
              display_name: user.display_name,
              previous_team: result.previous_team,
              team: user.team,
              moved_contribution: result.moved_contribution
            },
            ctx.now
          );
        } else if (op === 'force_logout') {
          const removed = players.forceLogout(state, user.id);
          adminLog.logAdminAction(
            state,
            'player_force_logout',
            { user_id: user.id, display_name: user.display_name, sessions_removed: removed },
            ctx.now
          );
        } else if (op === 'rebind_code') {
          const result = codesModule.rebindPlayerCode(state, user, body.code, seeds, ctx.now);
          if (result.error) {
            return result;
          }
          adminLog.logAdminAction(
            state,
            'player_rebind_code',
            {
              user_id: user.id,
              display_name: user.display_name,
              previous_code: result.previous_code,
              code: result.new_code,
              code_type: result.new_type
            },
            ctx.now
          );
        } else if (op === 'set_weight_override') {
          const value = Number(body.value);
          if (!Number.isFinite(value) || value < -100 || value > 100) {
            return { error: ERROR_CODES.VALIDATION_FAILED, message: '权重调整量需要在 -100 ~ 100 之间。' };
          }
          const before = weights.calculateUserWeight(state, user, seeds.lottery);
          user.weight_override = Number(value.toFixed(6));
          const after = weights.calculateUserWeight(state, user, seeds.lottery);
          adminLog.logAdminAction(
            state,
            'player_set_weight_override',
            {
              user_id: user.id,
              display_name: user.display_name,
              weight_override: user.weight_override,
              weight_before: before,
              weight_after: after
            },
            ctx.now
          );
        } else {
          return { error: ERROR_CODES.BAD_REQUEST, message: '未知玩家操作。' };
        }

        return {
          ok: true,
          message: '玩家操作完成。',
          __ledgerEntries: ledgerEntries,
          player_view: players.buildPlayerView(state, user, { seeds, now: ctx.now }, {
            weight: weights.calculateUserWeight(state, user, seeds.lottery)
          })
        };
      });
      if (result.error) {
        sendJson(res, result.error === ERROR_CODES.USER_NOT_FOUND ? 404 : 400, result);
        return;
      }
      sendJson(res, 200, { ...result, admin: views.buildAdminState(store.getLatest(), seeds) });
    } catch (error) {
      console.error('[admin] 玩家操作失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '操作失败。' });
    }
  });

  router.get('/api/admin/codes', async (req, res, context) => {
    const state = store.getLatest();
    if (!requireAdmin(state, req)) {
      sendJson(res, 401, { error: ERROR_CODES.FORBIDDEN, message: '请先登录。' });
      return;
    }
    const result = views.buildCodeAdminRows(state, seeds, {
      query: context.query.get('query') || '',
      status: context.query.get('status') || '',
      type: context.query.get('type') || '',
      batch_id: context.query.get('batch_id') || '',
      limit: Number(context.query.get('limit')) || 200
    });
    sendJson(res, 200, {
      ok: true,
      total: result.total,
      codes: result.rows.map((codeEntry) =>
        codesModule.codeSummary(codeEntry, (userId) => players.displayNameOf(state, userId))
      )
    });
  });

  router.post('/api/admin/codes/generate', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const generated = codesModule.generateCodes(
          state,
          { count: body.count, type: body.type, note: body.note },
          ctx.now
        );
        if (generated.error) {
          return generated;
        }
        adminLog.logAdminAction(
          state,
          'codes_generate',
          { count: generated.created.length, type: body.type, batch_id: generated.batch_id },
          ctx.now
        );
        return {
          ok: true,
          message: `已生成 ${generated.created.length} 个注册码。`,
          batch_id: generated.batch_id,
          codes: generated.created.map((codeEntry) => codeEntry.code)
        };
      });
      if (result.error) {
        sendJson(res, 400, result);
        return;
      }
      sendJson(res, 200, result);
    } catch (error) {
      console.error('[admin] 生成注册码失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '生成失败。' });
    }
  });

  router.post('/api/admin/codes/disable', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const disabled = body.disabled !== false;
        const opResult = codesModule.setCodeDisabled(state, body.code, disabled);
        if (opResult.error) {
          return opResult;
        }
        adminLog.logAdminAction(
          state,
          'codes_disable',
          { code: opResult.codeEntry.code, disabled },
          ctx.now
        );
        return { ok: true, message: disabled ? '已禁用。' : '已解禁。' };
      });
      if (result.error) {
        sendJson(res, result.error === ERROR_CODES.NOT_FOUND ? 404 : 400, result);
        return;
      }
      sendJson(res, 200, result);
    } catch (error) {
      console.error('[admin] 注册码操作失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '操作失败。' });
    }
  });

  router.get('/api/admin/codes/export', async (req, res) => {
    const state = store.getLatest();
    if (!requireAdmin(state, req)) {
      sendJson(res, 401, { error: ERROR_CODES.FORBIDDEN, message: '请先登录。' });
      return;
    }
    const rows = codesModule.exportRows(state, (userId) => players.displayNameOf(state, userId));
    const header = ['code', 'type', 'status', 'disabled', 'bound_display_name', 'bound_at', 'batch_id', 'created_at'];
    const escapeCell = (value) => {
      const text = String(value ?? '');
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csvLines = [header.join(',')];
    for (const row of rows) {
      csvLines.push(header.map((key) => escapeCell(row[key])).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    sendText(res, 200, `\uFEFF${csvLines.join('\r\n')}\r\n`, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="ntjv-codes-${stamp}.csv"`
    });
  });

  router.post('/api/admin/lottery/draw', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const drawn = lottery.drawPrize(state, String(body.prize_id || ''), seeds, ctx.now);
        if (drawn.error) {
          return drawn;
        }
        adminLog.logAdminAction(
          state,
          'lottery_draw',
          {
            draw_id: drawn.draw.id,
            prize_id: drawn.prize.id,
            user_id: drawn.winner.id,
            display_name: drawn.winner.display_name,
            weight_snapshot: drawn.draw.weight_snapshot,
            total_weight: drawn.draw.total_weight_snapshot,
            pool_size: drawn.draw.pool_size
          },
          ctx.now
        );
        return {
          ok: true,
          message: `已抽出：${drawn.winner.display_name}`,
          draw: lottery.buildDrawView(state, drawn.draw, seeds)
        };
      });
      if (result.error) {
        sendJson(res, 400, result);
        return;
      }
      sendJson(res, 200, { ...result, admin: views.buildAdminState(store.getLatest(), seeds) });
    } catch (error) {
      console.error('[admin] 抽奖失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '抽奖失败。' });
    }
  });

  router.post('/api/admin/lottery/record', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const op = String(body.op || '');
        let opResult;
        if (op === 'confirm') {
          opResult = lottery.markConfirmed(state, String(body.draw_id || ''), ctx.now);
        } else if (op === 'claim') {
          opResult = lottery.markClaimed(state, String(body.draw_id || ''), ctx.now);
        } else if (op === 'void') {
          opResult = lottery.voidDraw(state, String(body.draw_id || ''), body.reason, ctx.now);
        } else {
          return { error: ERROR_CODES.BAD_REQUEST, message: '未知操作。' };
        }
        if (opResult.error) {
          return opResult;
        }
        adminLog.logAdminAction(
          state,
          `lottery_${op}`,
          {
            draw_id: opResult.draw.id,
            prize_id: opResult.draw.prize_id,
            user_id: opResult.draw.user_id,
            reason: opResult.draw.void_reason || ''
          },
          ctx.now
        );
        const messages = {
          confirm: '已确认中奖有效。',
          claim: '已标记领取。',
          void: '已作废。'
        };
        return { ok: true, message: messages[op] };
      });
      if (result.error) {
        sendJson(res, 400, result);
        return;
      }
      sendJson(res, 200, { ...result, admin: views.buildAdminState(store.getLatest(), seeds) });
    } catch (error) {
      console.error('[admin] 抽奖记录操作失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '操作失败。' });
    }
  });

  router.post('/api/admin/lottery/prize', async (req, res) => {
    let body;
    try {
      body = await collectBody(req);
    } catch {
      sendJson(res, 400, { error: ERROR_CODES.BAD_REQUEST, message: '请求格式错误。' });
      return;
    }
    try {
      const result = await adminTransact(appCtx, req, (state, ctx) => {
        const op = String(body.op || '');
        let outcome;
        if (op === 'add') {
          outcome = lottery.addCustomPrize(state, seeds, body, ctx.now);
          if (outcome.error) {
            return outcome;
          }
          adminLog.logAdminAction(state, 'lottery_prize_add', {
            prize_id: outcome.prize.id,
            name: outcome.prize.name,
            source: outcome.prize.source,
            count: outcome.prize.count
          }, ctx.now);
          return { ok: true, message: `已添加奖品「${outcome.prize.name}」。`, prize: outcome.prize };
        }
        if (op === 'update') {
          outcome = lottery.updatePrize(state, seeds, String(body.prize_id || ''), body);
          if (outcome.error) {
            return outcome;
          }
          adminLog.logAdminAction(state, 'lottery_prize_update', {
            prize_id: body.prize_id,
            applied: outcome.applied,
            previous: outcome.previous
          }, ctx.now);
          return { ok: true, message: '奖品信息已更新。' };
        }
        return { error: ERROR_CODES.BAD_REQUEST, message: '未知操作。' };
      });
      if (result.error) {
        sendJson(res, result.error === 'PRIZE_NOT_FOUND' ? 404 : 400, result);
        return;
      }
      sendJson(res, 200, { ...result, admin: views.buildAdminState(store.getLatest(), seeds) });
    } catch (error) {
      console.error('[admin] 奖品操作失败:', error);
      sendJson(res, 500, { error: ERROR_CODES.INTERNAL_ERROR, message: '操作失败。' });
    }
  });

  router.get('/api/admin/ledger', async (req, res, context) => {
    const state = store.getLatest();
    if (!requireAdmin(state, req)) {
      sendJson(res, 401, { error: ERROR_CODES.FORBIDDEN, message: '请先登录。' });
      return;
    }
    const rows = contributions.queryLedger(state, {
      user_id: context.query.get('user_id') || '',
      region_id: context.query.get('region_id') || '',
      kind: context.query.get('kind') || '',
      limit: Math.min(500, Number(context.query.get('limit')) || 100)
    });
    sendJson(res, 200, {
      ok: true,
      rows: rows.map((entry) => views.sanitizeLedgerEntry(state, entry, seeds))
    });
  });
}

module.exports = {
  registerRoutes,
  requireAdmin
};
