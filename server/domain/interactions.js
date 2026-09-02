'use strict';

/**
 * 统一互动（Interaction）系统。
 *
 * 玩家对开放区域执行互动 → 服务端校验（活动状态 / 区域状态 / 队伍限制 /
 * 时间窗 / 冷却 / 能量）→ 随机结算 → 更新贡献与异变值 → 落流水。
 *
 * 幂等：客户端为每次交互生成 client_request_id；重复提交返回首次结果。
 */

const { ACTIVITY_STATUS, ERROR_CODES, LEDGER_KINDS } = require('../../shared/constants');
const { randomUnit, rollRange, weightedPick } = require('../../shared/random');
const contributions = require('./contributions');
const players = require('./players');
const regions = require('./regions');

/**
 * 进程内轻量限流（防双击/连点），重启即清零，不落盘。
 */
const lastInteractAtByUser = new Map();

function resetRateLimiter() {
  lastInteractAtByUser.clear();
}

function isInteractionOpenAt(interaction, nowSec) {
  const window = interaction.time_window;
  if (!window) {
    return true;
  }
  return nowSec >= Number(window.start) && nowSec <= Number(window.end);
}

function checkRegionUsable(state, configRegion, ctx) {
  const { now } = ctx;
  const runtime = regions.getRuntime(state, configRegion.id);
  if (!runtime) {
    return { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' };
  }
  if (!regions.isRegionUnlocked(state, configRegion)) {
    return { error: ERROR_CODES.REGION_LOCKED, message: `「${configRegion.name}」尚未解锁。` };
  }
  if (runtime.closed) {
    return { error: ERROR_CODES.REGION_CLOSED, message: `「${configRegion.name}」暂时关闭，请稍后再来。` };
  }
  if (runtime.cleared) {
    return { error: ERROR_CODES.REGION_CLEARED, message: `「${configRegion.name}」的异变已经解决！` };
  }
  regions.ensureUnlockedAt(state, configRegion, now);
  return {};
}

function findInteraction(seeds, interactionId) {
  return seeds.interactions.find((item) => item.id === interactionId) || null;
}

/**
 * 互动结算主流程。ctx = { seeds, now }（now 为秒级时间戳）。
 */
function performInteraction(state, user, payload, ctx) {
  const { seeds, now } = ctx;
  const activityConfig = seeds.activity;
  const activity = state.activity;

  if (activity.status !== ACTIVITY_STATUS.RUNNING) {
    return { error: ERROR_CODES.ACTIVITY_NOT_RUNNING, message: '当前活动未在进行中。' };
  }
  if (!activityConfig.interaction_open) {
    return { error: ERROR_CODES.ACTIVITY_NOT_RUNNING, message: '当前暂未开放互动。' };
  }
  if (user.banned) {
    return { error: ERROR_CODES.USER_BANNED, message: '该账号已被封禁，请联系工作人员。' };
  }

  const clientRequestId = String(payload.client_request_id || '').trim();
  if (!clientRequestId || clientRequestId.length > 64) {
    return { error: ERROR_CODES.BAD_REQUEST, message: '缺少有效的请求标识（client_request_id）。' };
  }
  const requestId = `${user.id}:${clientRequestId}`;
  const existing = state.request_locks[requestId];
  if (existing && existing.result) {
    return { duplicate: true, action_result: existing.result };
  }

  const rateLimitMs = Math.max(0, Number(activityConfig.interact_rate_limit_ms) || 0);
  if (rateLimitMs > 0) {
    const lastAt = lastInteractAtByUser.get(user.id) || 0;
    if (now * 1000 - lastAt < rateLimitMs) {
      return { error: ERROR_CODES.RATE_LIMITED, message: '操作太频繁了，请稍候再试。' };
    }
    lastInteractAtByUser.set(user.id, now * 1000);
  }

  const regionId = String(payload.region_id || '').trim();
  const actionId = String(payload.action_id || '').trim();
  const configRegion = regions.getConfigRegion(seeds, regionId);
  if (!configRegion) {
    return { error: ERROR_CODES.REGION_NOT_FOUND, message: '区域不存在。' };
  }

  const regionCheck = checkRegionUsable(state, configRegion, ctx);
  if (regionCheck.error) {
    return regionCheck;
  }

  const interaction = findInteraction(seeds, actionId);
  if (!interaction || interaction.enabled === false) {
    return { error: ERROR_CODES.INTERACTION_NOT_FOUND, message: '该互动不存在或已停用。' };
  }
  if (Array.isArray(interaction.regions) && !interaction.regions.includes(regionId)) {
    return { error: ERROR_CODES.INTERACTION_UNAVAILABLE, message: `「${interaction.name}」不适用于当前区域。` };
  }
  if (interaction.team_restriction && interaction.team_restriction !== user.team) {
    return { error: ERROR_CODES.INTERACTION_UNAVAILABLE, message: `「${interaction.name}」仅限指定阵营参与。` };
  }
  if (!isInteractionOpenAt(interaction, now)) {
    return { error: ERROR_CODES.INTERACTION_UNAVAILABLE, message: `「${interaction.name}」当前不在开放时间内。` };
  }

  const energyCost = Math.max(0, Math.floor(Number(interaction.energy_cost) || 0));
  const cooldownSec = Math.max(0, Math.floor(Number(interaction.cooldown_sec) || 0));
  if (cooldownSec > 0) {
    const lastPerformed = Number(user.cooldowns[interaction.id]) || 0;
    if (now - lastPerformed < cooldownSec) {
      return {
        error: ERROR_CODES.COOLDOWN_ACTIVE,
        message: `「${interaction.name}」冷却中，还需 ${cooldownSec - (now - lastPerformed)} 秒。`,
        retry_in_sec: cooldownSec - (now - lastPerformed)
      };
    }
  }

  const energyState = players.materializeEnergy(user, activityConfig, now);
  if (energyState.energy < energyCost) {
    return {
      error: ERROR_CODES.ENERGY_NOT_ENOUGH,
      message: '能量不足，请等待能量恢复或选择其他互动。',
      energy_after: energyState.energy
    };
  }

  const outcome = weightedPick(interaction.outcomes || [], randomUnit, (item) => Number(item.weight) || 0);
  if (!outcome) {
    return { error: ERROR_CODES.INTERNAL_ERROR, message: '互动结算失败，请重试。' };
  }

  const contributionGain = rollRange(outcome.contribution);
  const anomalyReduction = rollRange(outcome.anomaly);
  const energyDelta = Math.max(0, Math.floor(Number(outcome.energy_delta) || 0));

  const energyBefore = user.energy;
  const energyCap = Math.max(1, Math.floor(Number(activityConfig.energy_cap) || 5));
  user.energy = Math.max(0, Math.min(energyCap, user.energy - energyCost + energyDelta));
  if (user.energy >= energyCap) {
    user.last_energy_at = now;
  }

  const anomalyResult = regions.reduceAnomaly(state, configRegion, anomalyReduction, now);
  if (contributionGain > 0) {
    regions.addParticipant(state, regionId, user.id);
  }

  const ledgerEntry = contributions.applyContribution(
    state,
    contributions.buildLedgerEntry({
      kind: LEDGER_KINDS.INTERACTION,
      user_id: user.id,
      team: user.team,
      region_id: regionId,
      action_id: interaction.id,
      reason: interaction.name,
      user_delta: contributionGain,
      team_delta: contributionGain,
      anomaly_delta: anomalyResult.actual_reduction,
      request_id: clientRequestId,
      meta: { outcome_text: outcome.text || '' }
    }, now)
  );
  contributions.trimLedger(state, activityConfig.ledger_recent_limit);

  user.cooldowns[interaction.id] = now;
  user.updated_at = now;

  const actionResult = {
    interaction_id: interaction.id,
    interaction_name: interaction.name,
    region_id: regionId,
    region_name: configRegion.name,
    text: outcome.text || interaction.description || '',
    contribution_gain: contributionGain,
    anomaly_reduction: anomalyResult.actual_reduction,
    region_just_cleared: anomalyResult.just_cleared,
    energy_before: energyBefore,
    energy_after: user.energy,
    ledger_id: ledgerEntry.id
  };

  state.request_locks[requestId] = { result: actionResult, created_at: now };

  return { action_result: actionResult, ledger_entry: ledgerEntry };
}

module.exports = {
  performInteraction,
  checkRegionUsable,
  findInteraction,
  resetRateLimiter
};
