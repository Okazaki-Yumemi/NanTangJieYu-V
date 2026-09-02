'use strict';

/**
 * 区域（Region）领域逻辑：解锁推导、异变值结算、CLEAR 状态机。
 *
 * 区域状态是「推导」出来的，不单独存储，避免状态不一致：
 * - locked        区域尚未解锁
 * - available     已解锁且异变值满、尚无贡献
 * - investigating 已解锁、异变值部分下降但未 CLEAR
 * - cleared       异变值归零（或管理员强制 CLEAR）
 * 另有管理端运行时开关 closed（临时关闭）叠加在推导结果之外。
 */

const { ERROR_CODES } = require('../../shared/constants');
const { newId } = require('../auth');

function getConfigRegion(seeds, regionId) {
  return seeds.regions.find((region) => region.id === regionId) || null;
}

function getRuntime(state, regionId) {
  return state.regions[regionId] || null;
}

function isRegionUnlocked(state, configRegion) {
  if (!configRegion) {
    return false;
  }
  const runtime = getRuntime(state, configRegion.id);
  if (runtime && runtime.forced_unlock) {
    return true;
  }
  const unlockAfter = Array.isArray(configRegion.unlock_after) ? configRegion.unlock_after : [];
  return unlockAfter.every((depId) => {
    const dep = getRuntime(state, depId);
    return dep ? dep.cleared : false;
  });
}

function deriveStatus(state, configRegion) {
  const runtime = getRuntime(state, configRegion.id);
  if (!runtime) {
    return 'locked';
  }
  if (runtime.cleared) {
    return 'cleared';
  }
  if (!isRegionUnlocked(state, configRegion)) {
    return 'locked';
  }
  if (runtime.anomaly_remaining >= configRegion.max_anomaly) {
    return 'available';
  }
  return 'investigating';
}

/**
 * 标记解锁时间（信息性字段，首次观测到解锁时写入）。
 */
function ensureUnlockedAt(state, configRegion, nowSec) {
  if (!isRegionUnlocked(state, configRegion)) {
    return;
  }
  const runtime = getRuntime(state, configRegion.id);
  if (runtime && !runtime.unlocked_at) {
    runtime.unlocked_at = nowSec;
  }
}

function pushSystemEvent(state, { kind, region_id = '', message }, nowSec) {
  state.system_events.push({
    id: newId('event'),
    kind,
    region_id,
    message,
    created_at: nowSec
  });
}

/**
 * 对区域施加异变值下降。
 * 返回 { actual_reduction, just_cleared }。
 */
function reduceAnomaly(state, configRegion, amount, nowSec) {
  const runtime = getRuntime(state, configRegion.id);
  if (!runtime || amount <= 0) {
    return { actual_reduction: 0, just_cleared: false };
  }
  const before = runtime.anomaly_remaining;
  const after = Math.max(0, Math.min(before, configRegion.max_anomaly) - Math.floor(amount));
  runtime.anomaly_remaining = after;
  runtime.updated_at = nowSec;

  let justCleared = false;
  if (after === 0 && !runtime.cleared) {
    runtime.cleared = true;
    runtime.cleared_at = nowSec;
    justCleared = true;
    pushSystemEvent(
      state,
      {
        kind: 'region_cleared',
        region_id: configRegion.id,
        message: `「${configRegion.name}」异变解决！新区域与奖品已解锁。`
      },
      nowSec
    );
  }
  return { actual_reduction: before - after, just_cleared: justCleared };
}

function setAnomaly(state, configRegion, value, nowSec) {
  const runtime = getRuntime(state, configRegion.id);
  if (!runtime) {
    return { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' };
  }
  const target = Math.floor(Number(value));
  if (!Number.isFinite(target) || target < 0 || target > configRegion.max_anomaly) {
    return {
      error: ERROR_CODES.VALIDATION_FAILED,
      message: `异变值需要是 0 ~ ${configRegion.max_anomaly} 之间的整数。`
    };
  }
  runtime.anomaly_remaining = target;
  if (target > 0 && runtime.cleared) {
    runtime.cleared = false;
    runtime.cleared_at = 0;
  }
  runtime.updated_at = nowSec;
  return { runtime };
}

function forceClear(state, configRegion, nowSec) {
  const runtime = getRuntime(state, configRegion.id);
  if (!runtime) {
    return { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' };
  }
  runtime.anomaly_remaining = 0;
  if (!runtime.cleared) {
    runtime.cleared = true;
    runtime.cleared_at = nowSec;
    pushSystemEvent(
      state,
      {
        kind: 'region_cleared',
        region_id: configRegion.id,
        message: `管理员强制解决「${configRegion.name}」异变。`
      },
      nowSec
    );
  }
  runtime.updated_at = nowSec;
  return { runtime };
}

function setForcedUnlock(state, configRegion, unlocked, nowSec) {
  const runtime = getRuntime(state, configRegion.id);
  if (!runtime) {
    return { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' };
  }
  runtime.forced_unlock = Boolean(unlocked);
  if (runtime.forced_unlock && !runtime.unlocked_at) {
    runtime.unlocked_at = nowSec;
  }
  runtime.updated_at = nowSec;
  return { runtime };
}

function setClosed(state, configRegion, closed, nowSec) {
  const runtime = getRuntime(state, configRegion.id);
  if (!runtime) {
    return { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' };
  }
  runtime.closed = Boolean(closed);
  runtime.updated_at = nowSec;
  return { runtime };
}

function addParticipant(state, regionId, userId) {
  const runtime = getRuntime(state, regionId);
  if (!runtime) {
    return;
  }
  if (!runtime.participant_ids.includes(userId)) {
    runtime.participant_ids.push(userId);
  }
}

/**
 * 区域公开视图（玩家端 / 大屏）。
 */
function buildRegionView(state, configRegion, seeds, ctx) {
  const runtime = getRuntime(state, configRegion.id);
  const status = deriveStatus(state, configRegion);
  const prizeIds = Array.isArray(configRegion.prize_ids) ? configRegion.prize_ids : [];
  return {
    id: configRegion.id,
    order: configRegion.order,
    name: configRegion.name,
    season: configRegion.season,
    season_label: configRegion.season_label,
    title: configRegion.title,
    description: configRegion.description,
    cleared_story: configRegion.cleared_story,
    image: configRegion.image,
    map: { ...configRegion.map },
    max_anomaly: configRegion.max_anomaly,
    anomaly_remaining: runtime ? runtime.anomaly_remaining : configRegion.max_anomaly,
    anomaly_progress: runtime
      ? 1 - runtime.anomaly_remaining / Math.max(1, configRegion.max_anomaly)
      : 0,
    status,
    closed: runtime ? Boolean(runtime.closed) : false,
    unlocked_at: runtime ? runtime.unlocked_at : 0,
    cleared_at: runtime ? runtime.cleared_at : 0,
    unlock_after: Array.isArray(configRegion.unlock_after) ? [...configRegion.unlock_after] : [],
    participant_count: runtime ? runtime.participant_ids.length : 0,
    prize_ids: prizeIds,
    prizes_available: prizeIds.length > 0 && prizeIds.every((prizeId) => {
      const prize = seeds.prizes.find((item) => item.id === prizeId);
      return prize ? prizeAvailability(state, prize) : false;
    }),
    generated_at: ctx.now
  };
}

function prizeAvailability(state, prize) {
  if (!prize) {
    return false;
  }
  if (prize.source === 'base') {
    return true;
  }
  const runtime = getRuntime(state, prize.source);
  return Boolean(runtime && runtime.cleared);
}

/**
 * 区域贡献排行榜（按个人对该区域的贡献降序）。
 */
function buildRegionLeaderboard(state, regionId, limit = 10) {
  const rows = [];
  for (const user of Object.values(state.users)) {
    const contribution = Number(user.region_contributions[regionId]) || 0;
    if (contribution > 0) {
      rows.push({
        user_id: user.id,
        display_name: user.display_name,
        team: user.team,
        contribution
      });
    }
  }
  rows.sort((a, b) => b.contribution - a.contribution || a.display_name.localeCompare(b.display_name, 'zh-CN'));
  return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * 玩家在某区域的排名（1 起，无贡献返回 null）。
 */
function getUserRegionRank(state, regionId, userId) {
  const user = state.users[userId];
  if (!user) {
    return null;
  }
  const contribution = Number(user.region_contributions[regionId]) || 0;
  if (contribution <= 0) {
    return null;
  }
  let rank = 1;
  for (const other of Object.values(state.users)) {
    if (other.id === userId) {
      continue;
    }
    if ((Number(other.region_contributions[regionId]) || 0) > contribution) {
      rank += 1;
    }
  }
  return rank;
}

module.exports = {
  getConfigRegion,
  getRuntime,
  isRegionUnlocked,
  deriveStatus,
  ensureUnlockedAt,
  reduceAnomaly,
  setAnomaly,
  forceClear,
  setForcedUnlock,
  setClosed,
  addParticipant,
  buildRegionView,
  prizeAvailability,
  buildRegionLeaderboard,
  getUserRegionRank,
  pushSystemEvent
};
