'use strict';

/**
 * 运行时状态的构建与迁移。
 *
 * 设计原则：shared/seeds/*.json 是「规则与内容」的单一来源（改配置 + 重启生效），
 * state.json 只保存「运行时数据」。normalizeState 在每次加载时把运行时数据
 * 与当前配置对齐（新增区域初始化、约束异常值范围、修剪有界集合）。
 */

const { newId } = require('../auth');

function buildInitialState(seeds, nowSec) {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  return {
    version: 1,
    created_at: now,
    updated_at: now,
    activity: {
      status: 'scheduled',
      registration_open: seeds.activity.registration_open !== false,
      started_at: 0,
      paused_at: 0,
      resumed_at: 0,
      ended_at: 0,
      updated_at: now
    },
    teams: Object.fromEntries(
      seeds.teams.map((team) => [
        team.id,
        { member_count: 0, total_contribution: 0, updated_at: 0 }
      ])
    ),
    regions: Object.fromEntries(
      seeds.regions.map((region) => [
        region.id,
        {
          anomaly_remaining: region.max_anomaly,
          cleared: false,
          cleared_at: 0,
          forced_unlock: false,
          closed: false,
          participant_ids: [],
          unlocked_at: Array.isArray(region.unlock_after) && region.unlock_after.length === 0 ? now : 0,
          updated_at: 0
        }
      ])
    ),
    codes: {},
    users: {},
    sessions: {},
    admin_sessions: {},
    contribution_log: [],
    request_locks: {},
    lottery: { draws: [] },
    admin_logs: [],
    system_events: []
  };
}

/**
 * 状态迁移与修剪。无副作用假设之外的输入都要能被修复。
 */
function normalizeState(state, seeds) {
  const initial = buildInitialState(seeds);
  state.version = 1;

  // --- 顶层集合兜底 ---
  for (const key of [
    'teams',
    'regions',
    'codes',
    'users',
    'sessions',
    'admin_sessions',
    'request_locks'
  ]) {
    if (!state[key] || typeof state[key] !== 'object') {
      state[key] = {};
    }
  }
  for (const key of ['contribution_log', 'admin_logs', 'system_events']) {
    if (!Array.isArray(state[key])) {
      state[key] = [];
    }
  }
  if (!state.lottery || typeof state.lottery !== 'object') {
    state.lottery = { draws: [] };
  }
  if (!Array.isArray(state.lottery.draws)) {
    state.lottery.draws = [];
  }

  // --- 活动 ---
  state.activity = { ...initial.activity, ...state.activity };
  state.activity.registration_open = Boolean(state.activity.registration_open);

  // --- 队伍运行时 ---
  for (const team of seeds.teams) {
    const runtime = state.teams[team.id] || {};
    state.teams[team.id] = {
      member_count: Number.isFinite(runtime.member_count) ? runtime.member_count : 0,
      total_contribution: Number.isFinite(runtime.total_contribution) ? runtime.total_contribution : 0,
      updated_at: Number.isFinite(runtime.updated_at) ? runtime.updated_at : 0
    };
  }

  // --- 区域运行时：补齐缺失、对齐配置 ---
  for (const region of seeds.regions) {
    const runtime = state.regions[region.id] || {};
    const maxAnomaly = Math.floor(region.max_anomaly);
    let remaining = Number.isFinite(runtime.anomaly_remaining) ? Math.floor(runtime.anomaly_remaining) : maxAnomaly;
    remaining = Math.min(maxAnomaly, Math.max(0, remaining));
    if (runtime.cleared) {
      remaining = 0;
    }
    const initiallyUnlocked = Array.isArray(region.unlock_after) && region.unlock_after.length === 0;
    state.regions[region.id] = {
      anomaly_remaining: remaining,
      cleared: Boolean(runtime.cleared),
      cleared_at: Number.isFinite(runtime.cleared_at) ? runtime.cleared_at : 0,
      forced_unlock: Boolean(runtime.forced_unlock),
      closed: Boolean(runtime.closed),
      participant_ids: Array.isArray(runtime.participant_ids) ? runtime.participant_ids : [],
      unlocked_at: Number.isFinite(runtime.unlocked_at) && runtime.unlocked_at > 0
        ? runtime.unlocked_at
        : (initiallyUnlocked ? (state.created_at || 0) : 0),
      updated_at: Number.isFinite(runtime.updated_at) ? runtime.updated_at : 0
    };
  }

  // --- 有界集合修剪 ---
  const ledgerLimit = Math.max(50, Number(seeds.activity.ledger_recent_limit) || 500);
  if (state.contribution_log.length > ledgerLimit) {
    state.contribution_log = state.contribution_log.slice(-ledgerLimit);
  }
  const lockLimit = Math.max(50, Number(seeds.activity.request_lock_limit) || 1000);
  const lockTtl = Math.max(60, Number(seeds.activity.request_lock_ttl_sec) || 1800);
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [requestId, lock] of Object.entries(state.request_locks)) {
    if (!lock || !Number.isFinite(lock.created_at) || nowSec - lock.created_at > lockTtl) {
      delete state.request_locks[requestId];
    }
  }
  const lockIds = Object.keys(state.request_locks);
  if (lockIds.length > lockLimit) {
    const sorted = lockIds.sort(
      (a, b) => (state.request_locks[a].created_at || 0) - (state.request_locks[b].created_at || 0)
    );
    for (const requestId of sorted.slice(0, lockIds.length - lockLimit)) {
      delete state.request_locks[requestId];
    }
  }
  const adminLogLimit = 5000;
  if (state.admin_logs.length > adminLogLimit) {
    state.admin_logs = state.admin_logs.slice(-adminLogLimit);
  }
  const systemEventLimit = 300;
  if (state.system_events.length > systemEventLimit) {
    state.system_events = state.system_events.slice(-systemEventLimit);
  }

  // --- 会话修剪 ---
  const sessionTtl = Math.max(3600, Number(seeds.activity.session_ttl_sec) || 43200);
  for (const [sessionId, session] of Object.entries(state.sessions)) {
    const lastSeen = Number.isFinite(session.last_seen_at) ? session.last_seen_at : session.created_at || 0;
    if (nowSec - lastSeen > sessionTtl) {
      delete state.sessions[sessionId];
    }
  }
  const adminSessionTtl = Math.max(1800, Number(seeds.activity.admin_session_ttl_sec) || 28800);
  for (const [sessionId, session] of Object.entries(state.admin_sessions)) {
    const lastSeen = Number.isFinite(session.last_seen_at) ? session.last_seen_at : session.created_at || 0;
    if (nowSec - lastSeen > adminSessionTtl) {
      delete state.admin_sessions[sessionId];
    }
  }

  return state;
}

function nextEntryId(state, prefix) {
  return newId(prefix);
}

module.exports = {
  buildInitialState,
  normalizeState
};
