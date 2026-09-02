'use strict';

/**
 * 节目 / 舞台事件（Stage Events）。
 *
 * 现场节目（QUIZ / STG / 舞台互动等）通过预设事件影响线上数据。
 * 事件定义在 shared/seeds/stage-events.json，管理员一键触发，全部留痕。
 */

const { LEDGER_KINDS } = require('../../shared/constants');
const contributions = require('./contributions');
const regions = require('./regions');

function listStageEvents(seeds) {
  return seeds.stageEvents.map((event) => ({ ...event }));
}

function getStageEvent(seeds, eventId) {
  return seeds.stageEvents.find((event) => event.id === eventId) || null;
}

/**
 * 触发节目事件。返回 { message, ledger_entries, system_event }。
 */
function triggerStageEvent(state, event, ctx) {
  const { now } = ctx;
  const effect = event.effect;
  const ledgerEntries = [];

  if (effect.type === 'team_contribution') {
    const members = Object.values(state.users).filter(
      (user) => user.team === effect.team && !user.banned
    );
    for (const member of members) {
      const entry = contributions.applyContribution(
        state,
        contributions.buildLedgerEntry({
          kind: LEDGER_KINDS.STAGE,
          user_id: member.id,
          team: member.team,
          reason: event.name,
          user_delta: effect.amount,
          team_delta: 0,
          meta: { stage_event_id: event.id }
        }, now)
      );
      ledgerEntries.push(entry);
    }
    const team = state.teams[effect.team];
    if (members.length > 0) {
      team.total_contribution += effect.amount * members.length;
    } else {
      team.total_contribution += effect.amount;
    }
    team.updated_at = now;
    const message = members.length > 0
      ? `节目「${event.name}」：${effect.team} 队每位成员贡献 +${effect.amount}（共 ${members.length} 人）。`
      : `节目「${event.name}」：${effect.team} 队暂无成员，队伍总贡献 +${effect.amount}。`;
    return { message, ledger_entries: ledgerEntries };
  }

  if (effect.type === 'team_pool_contribution') {
    const entry = contributions.applyContribution(
      state,
      contributions.buildLedgerEntry({
        kind: LEDGER_KINDS.STAGE,
        team: effect.team,
        reason: event.name,
        team_delta: effect.amount,
        meta: { stage_event_id: event.id }
      }, now)
    );
    ledgerEntries.push(entry);
    return {
      message: `节目「${event.name}」：${effect.team} 队伍总贡献 +${effect.amount}（不计个人）。`,
      ledger_entries: ledgerEntries
    };
  }

  if (effect.type === 'reduce_anomaly') {
    const configRegion = regions.getConfigRegion(ctx.seeds, effect.region);
    if (!configRegion) {
      return { error: 'REGION_NOT_FOUND', message: '事件引用的区域不存在。' };
    }
    const result = regions.reduceAnomaly(state, configRegion, effect.amount, now);
    const entry = contributions.applyContribution(
      state,
      contributions.buildLedgerEntry({
        kind: LEDGER_KINDS.STAGE,
        region_id: configRegion.id,
        reason: event.name,
        anomaly_delta: result.actual_reduction,
        meta: { stage_event_id: event.id }
      }, now)
    );
    ledgerEntries.push(entry);
    return {
      message: `节目「${event.name}」：${configRegion.name} 异变值 -${result.actual_reduction}${result.just_cleared ? '，区域已解决！' : ''}。`,
      ledger_entries: ledgerEntries
    };
  }

  if (effect.type === 'unlock_region') {
    const configRegion = regions.getConfigRegion(ctx.seeds, effect.region);
    if (!configRegion) {
      return { error: 'REGION_NOT_FOUND', message: '事件引用的区域不存在。' };
    }
    const runtime = regions.getRuntime(state, configRegion.id);
    runtime.forced_unlock = true;
    if (!runtime.unlocked_at) {
      runtime.unlocked_at = now;
    }
    runtime.updated_at = now;
    regions.pushSystemEvent(
      state,
      {
        kind: 'region_unlocked',
        region_id: configRegion.id,
        message: `节目「${event.name}」：${configRegion.name} 提前解锁。`
      },
      now
    );
    return {
      message: `节目「${event.name}」：${configRegion.name} 已解锁。`,
      ledger_entries: []
    };
  }

  return { error: 'BAD_REQUEST', message: `未知的事件效果类型: ${effect.type}` };
}

module.exports = {
  listStageEvents,
  getStageEvent,
  triggerStageEvent
};
