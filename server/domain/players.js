'use strict';

/**
 * 玩家（Player）领域逻辑：注册 / 登录 / 会话 / 能量 / 视图。
 * 所有数值判定都在服务端完成；前端只提交意图。
 */

const { ACTIVITY_STATUS, ERROR_CODES, TEAM_IDS } = require('../../shared/constants');
const { findSensitiveWord } = require('../../shared/sensitive-words');
const { hashPassword, newId, newToken, normalizeDisplayName, verifyPassword } = require('../auth');
const codes = require('./codes');

/**
 * 计算玩家当前能量（考虑随时间恢复）。
 * 返回物化后的 { energy, lastEnergyAt }，调用方如需写回请直接赋值。
 */
function computeEnergy(user, activityConfig, nowSec) {
  const cap = Math.max(1, Math.floor(Number(activityConfig.energy_cap) || 5));
  const interval = Math.max(15, Math.floor(Number(activityConfig.energy_regen_interval_sec) || 90));
  const stored = Number.isFinite(user.energy) ? user.energy : cap;
  if (stored >= cap) {
    return { energy: cap, lastEnergyAt: nowSec };
  }
  const lastAt = Number.isFinite(user.last_energy_at) ? user.last_energy_at : nowSec;
  const recovered = Math.floor(Math.max(0, nowSec - lastAt) / interval);
  const energy = Math.min(cap, stored + recovered);
  const lastEnergyAt = recovered > 0 ? lastAt + recovered * interval : lastAt;
  return { energy, lastEnergyAt: energy >= cap ? nowSec : lastEnergyAt };
}

function materializeEnergy(user, activityConfig, nowSec) {
  const state = computeEnergy(user, activityConfig, nowSec);
  user.energy = state.energy;
  user.last_energy_at = state.lastEnergyAt;
  return state;
}

function findUserByDisplayName(state, displayName) {
  const normalized = normalizeDisplayName(displayName);
  if (!normalized) {
    return null;
  }
  for (const user of Object.values(state.users)) {
    if (user.display_name_lower === normalized) {
      return user;
    }
  }
  return null;
}

function getUser(state, userId) {
  return state.users[userId] || null;
}

function displayNameOf(state, userId) {
  const user = state.users[userId];
  return user ? user.display_name : '';
}

function canJoinTeam(state, teamId, maxDiff) {
  const counts = Object.fromEntries(
    Object.keys(state.teams).map((id) => [id, state.teams[id].member_count])
  );
  const nextCounts = { ...counts, [teamId]: (counts[teamId] || 0) + 1 };
  const diff = Math.max(...Object.values(nextCounts)) - Math.min(...Object.values(nextCounts));
  if (diff > maxDiff && nextCounts[teamId] === Math.max(...Object.values(nextCounts))) {
    return {
      allowed: false,
      message: '这边人数已经明显领先了。为了维持阵营平衡，请优先加入另一边。'
    };
  }
  return { allowed: true, message: '' };
}

function validateDisplayName(value, activityConfig, sensitiveWords) {
  const displayName = String(value || '').trim();
  const min = Math.max(1, Number(activityConfig.nickname_min_length) || 1);
  const max = Math.max(min, Number(activityConfig.nickname_max_length) || 16);
  if (displayName.length < min || displayName.length > max) {
    return { error: `昵称需要 ${min}-${max} 个字符。` };
  }
  const hit = findSensitiveWord(displayName, sensitiveWords);
  if (hit) {
    // 不回显命中词，避免展示不当内容或提示绕过方式
    return { error: '这个昵称包含不允许的内容，请换一个。' };
  }
  return { displayName };
}

/**
 * 玩家注册：验证注册码 → 建号 → 绑码 → 建会话。
 */
function registerPlayer(state, payload, ctx, nowSec) {
  const { seeds } = ctx;
  const activityConfig = seeds.activity;
  const activity = state.activity;

  const registrationAllowed =
    (activity.status === ACTIVITY_STATUS.SCHEDULED || activity.status === ACTIVITY_STATUS.RUNNING) &&
    activity.registration_open;
  if (!registrationAllowed) {
    return { error: ERROR_CODES.REGISTRATION_CLOSED, message: '当前暂未开放注册。' };
  }

  const code = codes.normalizeCode(payload.code);
  const displayNameInput = String(payload.display_name || '').trim();
  const password = String(payload.password || '');
  const teamId = String(payload.team || '').trim();

  if (!code || !displayNameInput || !password || !teamId) {
    return { error: ERROR_CODES.BAD_REQUEST, message: '请填写注册码、昵称、密码并选择阵营。' };
  }
  if (!state.teams[teamId]) {
    return { error: ERROR_CODES.BAD_REQUEST, message: '阵营不存在。' };
  }

  const nameCheck = validateDisplayName(displayNameInput, activityConfig, seeds.sensitiveWords);
  if (nameCheck.error) {
    return { error: ERROR_CODES.VALIDATION_FAILED, message: nameCheck.error };
  }
  if (password.length < Math.max(1, Number(activityConfig.password_min_length) || 4)) {
    return {
      error: ERROR_CODES.VALIDATION_FAILED,
      message: `密码至少需要 ${Math.max(1, Number(activityConfig.password_min_length) || 4)} 位。`
    };
  }

  if (findUserByDisplayName(state, nameCheck.displayName)) {
    return { error: ERROR_CODES.DUPLICATE_DISPLAY_NAME, message: '这个昵称已经被使用，请换一个。' };
  }

  const codeEntry = codes.findCode(state, code);
  if (!codeEntry) {
    return { error: ERROR_CODES.INVALID_CODE, message: '注册码不存在，请检查是否输入正确。' };
  }
  if (codeEntry.disabled) {
    return { error: ERROR_CODES.CODE_DISABLED, message: '这个注册码已被禁用，请联系工作人员。' };
  }
  if (!codes.isUsable(codeEntry)) {
    return { error: ERROR_CODES.CODE_ALREADY_USED, message: '这个注册码已经被使用。' };
  }

  const joinCheck = canJoinTeam(state, teamId, activityConfig.team_join_max_diff);
  if (!joinCheck.allowed) {
    return { error: ERROR_CODES.TEAM_JOIN_RESTRICTED, message: joinCheck.message };
  }

  const now = nowSec;
  const userId = newId('user');
  const passwordRecord = hashPassword(password);
  const lotteryConfig = seeds.lottery;
  const baseWeight = Number(lotteryConfig.code_type_base_weights[codeEntry.type]) || lotteryConfig.default_base_weight || 1;

  const user = {
    id: userId,
    display_name: nameCheck.displayName,
    display_name_lower: normalizeDisplayName(nameCheck.displayName),
    team: teamId,
    code: codeEntry.code,
    code_type: codeEntry.type,
    weight_base: baseWeight,
    weight_override: 0,
    password_salt: passwordRecord.salt,
    password_hash: passwordRecord.hash,
    total_contribution: 0,
    region_contributions: {},
    energy: Math.max(1, Math.floor(Number(activityConfig.energy_cap) || 5)),
    last_energy_at: now,
    cooldowns: {},
    banned: false,
    created_at: now,
    updated_at: now
  };
  state.users[userId] = user;
  codes.bindCode(state, codeEntry, userId, now);
  state.teams[teamId].member_count += 1;
  state.teams[teamId].updated_at = now;

  const session = createSession(state, userId, now);
  return { user, session_id: session.session_id };
}

function createSession(state, userId, nowSec) {
  const sessionId = newToken(24);
  state.sessions[sessionId] = {
    user_id: userId,
    created_at: nowSec,
    last_seen_at: nowSec
  };
  return { session_id: sessionId };
}

function loginPlayer(state, payload, ctx, nowSec) {
  const displayName = String(payload.display_name || '').trim();
  const password = String(payload.password || '');
  if (!displayName || !password) {
    return { error: ERROR_CODES.BAD_REQUEST, message: '请填写昵称和密码。' };
  }
  const user = findUserByDisplayName(state, displayName);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return { error: ERROR_CODES.INVALID_CREDENTIALS, message: '昵称或密码错误。' };
  }
  if (user.banned) {
    return { error: ERROR_CODES.USER_BANNED, message: '该账号已被封禁，请联系工作人员。' };
  }
  const session = createSession(state, user.id, nowSec);
  return { user, session_id: session.session_id };
}

function getSessionUser(state, sessionId) {
  if (!sessionId) {
    return null;
  }
  const session = state.sessions[sessionId];
  if (!session) {
    return null;
  }
  return state.users[session.user_id] || null;
}

function destroySession(state, sessionId) {
  if (sessionId && state.sessions[sessionId]) {
    delete state.sessions[sessionId];
  }
}

/**
 * 管理员修改玩家昵称（昵称唯一性与其他玩家一致）。
 */
function renamePlayer(state, user, displayName, seeds) {
  const check = validateDisplayName(displayName, seeds.activity, seeds.sensitiveWords);
  if (check.error) {
    return { error: 'VALIDATION_FAILED', message: check.error };
  }
  const existing = findUserByDisplayName(state, check.displayName);
  if (existing && existing.id !== user.id) {
    return { error: 'DUPLICATE_DISPLAY_NAME', message: '这个昵称已经被使用。' };
  }
  const previous = user.display_name;
  user.display_name = check.displayName;
  user.display_name_lower = normalizeDisplayName(check.displayName);
  return { user, previous_display_name: previous };
}

/**
 * 管理员更换玩家阵营：人数与个人贡献随人迁移。
 * 注意：队伍池贡献（如 QUIZ 应援）属于队伍本身，不随个人迁移。
 */
function switchTeam(state, user, teamId) {
  const team = state.teams[teamId];
  if (!team) {
    return { error: 'BAD_REQUEST', message: '目标阵营不存在。' };
  }
  if (user.team === teamId) {
    return { error: 'NO_CHANGE', message: '玩家已经在这个阵营。' };
  }
  const previousTeam = state.teams[user.team];
  const moved = user.total_contribution;
  previousTeam.member_count = Math.max(0, previousTeam.member_count - 1);
  previousTeam.total_contribution = Math.max(0, previousTeam.total_contribution - moved);
  team.member_count += 1;
  team.total_contribution += moved;
  const previous = user.team;
  user.team = teamId;
  return { user, previous_team: previous, moved_contribution: moved };
}

/**
 * 强制下线：清除该玩家的全部会话（换设备 / 账号异常时使用）。
 */
function forceLogout(state, userId) {
  let removed = 0;
  for (const [sessionId, session] of Object.entries(state.sessions)) {
    if (session.user_id === userId) {
      delete state.sessions[sessionId];
      removed += 1;
    }
  }
  return removed;
}

function getTitleForContribution(total, titles) {
  let current = titles[0] ? titles[0].title : '';
  for (const tier of titles) {
    if (total >= tier.min_contribution) {
      current = tier.title;
    }
  }
  return current;
}

/**
 * 玩家个人视图（绝不包含密码等敏感字段）。
 * weight 由 weights.calculateUserWeight 计算，由调用方传入。
 */
function buildPlayerView(state, user, ctx, extras = {}) {
  const { seeds, now } = ctx;
  const activityConfig = seeds.activity;
  const energy = computeEnergy(user, activityConfig, now);
  const cap = Math.max(1, Math.floor(Number(activityConfig.energy_cap) || 5));
  const regenInterval = Math.max(15, Math.floor(Number(activityConfig.energy_regen_interval_sec) || 90));
  const nextEnergyInSec = energy.energy >= cap
    ? 0
    : Math.max(0, regenInterval - (now - energy.lastEnergyAt));

  return {
    id: user.id,
    display_name: user.display_name,
    team: user.team,
    code: user.code,
    code_type: user.code_type,
    total_contribution: user.total_contribution,
    region_contributions: { ...user.region_contributions },
    energy: energy.energy,
    energy_cap: cap,
    next_energy_in_sec: nextEnergyInSec,
    weight: extras.weight !== undefined ? extras.weight : null,
    weight_base: user.weight_base,
    weight_override: user.weight_override,
    title: getTitleForContribution(user.total_contribution, seeds.titles),
    banned: Boolean(user.banned),
    created_at: user.created_at,
    ...extras
  };
}

module.exports = {
  computeEnergy,
  materializeEnergy,
  findUserByDisplayName,
  getUser,
  displayNameOf,
  canJoinTeam,
  validateDisplayName,
  registerPlayer,
  loginPlayer,
  createSession,
  getSessionUser,
  destroySession,
  renamePlayer,
  switchTeam,
  forceLogout,
  getTitleForContribution,
  buildPlayerView,
  TEAM_IDS
};
