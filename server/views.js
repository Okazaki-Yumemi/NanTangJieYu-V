'use strict';

/**
 * 只读视图构建：玩家端 / 管理端 / 公开大屏。
 * 视图是纯函数输出，绝不含密码等敏感字段。
 */

const { ACTIVITY_STATUS } = require('../shared/constants');
const players = require('./domain/players');
const regions = require('./domain/regions');
const weights = require('./domain/weights');
const lottery = require('./domain/lottery');
const stage = require('./domain/stage');
const codesModule = require('./domain/codes');
const adminLog = require('./domain/admin-log');
const contributions = require('./domain/contributions');

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function buildActivityView(state, seeds) {
  const activity = seeds.activity;
  return {
    name: activity.name,
    subtitle: activity.subtitle,
    tagline: activity.tagline,
    story_intro: activity.story_intro,
    status: state.activity.status,
    registration_open: Boolean(state.activity.registration_open),
    interaction_open: Boolean(activity.interaction_open),
    energy_cap: Math.max(1, Math.floor(Number(activity.energy_cap) || 5)),
    energy_regen_interval_sec: Math.max(15, Math.floor(Number(activity.energy_regen_interval_sec) || 90)),
    started_at: state.activity.started_at,
    ended_at: state.activity.ended_at,
    cleared_region_count: Object.values(state.regions).filter((runtime) => runtime.cleared).length,
    total_region_count: seeds.regions.length,
    player_count: Object.keys(state.users).length
  };
}

function buildTeamViews(state, seeds) {
  return seeds.teams.map((team) => ({
    id: team.id,
    name: team.name,
    short_name: team.short_name,
    captain: team.captain,
    slogan: team.slogan,
    color: team.color,
    color_soft: team.color_soft,
    portrait_url: team.portrait_url,
    member_count: state.teams[team.id] ? state.teams[team.id].member_count : 0,
    total_contribution: state.teams[team.id] ? state.teams[team.id].total_contribution : 0
  }));
}

function buildRegionViews(state, seeds, ctx) {
  return [...seeds.regions]
    .sort((a, b) => a.order - b.order)
    .map((configRegion) => regions.buildRegionView(state, configRegion, seeds, ctx));
}

function buildOverallLeaderboard(state, limit = 50) {
  const rows = Object.values(state.users).map((user) => ({
    user_id: user.id,
    display_name: user.display_name,
    team: user.team,
    total_contribution: user.total_contribution,
    banned: Boolean(user.banned)
  }));
  rows.sort(
    (a, b) =>
      b.total_contribution - a.total_contribution ||
      a.display_name.localeCompare(b.display_name, 'zh-CN')
  );
  return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

function getUserRank(state, userId) {
  let rank = 0;
  for (const row of buildOverallLeaderboard(state, Infinity)) {
    rank += 1;
    if (row.user_id === userId) {
      return rank;
    }
  }
  return null;
}

function sanitizeLedgerEntry(state, entry, seeds) {
  const user = entry.user_id ? state.users[entry.user_id] : null;
  const region = entry.region_id
    ? seeds.regions.find((item) => item.id === entry.region_id)
    : null;
  const interaction = entry.action_id
    ? seeds.interactions.find((item) => item.id === entry.action_id)
    : null;
  return {
    id: entry.id,
    kind: entry.kind,
    who: user ? user.display_name : '',
    team: user ? user.team : entry.team || '',
    region_name: region ? region.name : entry.region_id || '',
    action_name: interaction ? interaction.name : entry.reason || '',
    user_delta: entry.user_delta,
    team_delta: entry.team_delta,
    anomaly_delta: entry.anomaly_delta,
    created_at: entry.created_at
  };
}

/**
 * 互动的预期收益提示（展示用，不参与结算）。
 */
function interactionHint(interaction) {
  let minContribution = Infinity;
  let maxContribution = 0;
  let minAnomaly = Infinity;
  let maxAnomaly = 0;
  for (const outcome of interaction.outcomes || []) {
    const [cMin = 0, cMax = 0] = Array.isArray(outcome.contribution) ? outcome.contribution : [0, 0];
    const [aMin = 0, aMax = 0] = Array.isArray(outcome.anomaly) ? outcome.anomaly : [0, 0];
    minContribution = Math.min(minContribution, cMin);
    maxContribution = Math.max(maxContribution, cMax);
    minAnomaly = Math.min(minAnomaly, aMin);
    maxAnomaly = Math.max(maxAnomaly, aMax);
  }
  return {
    contribution: [Number.isFinite(minContribution) ? minContribution : 0, maxContribution],
    anomaly: [Number.isFinite(minAnomaly) ? minAnomaly : 0, maxAnomaly]
  };
}

const MYSTERY_PRIZE_PLACEHOLDER = '/assets/regions/prize-placeholder.svg';

/**
 * 玩家/大屏侧的奖品视图：
 * 终盘抽奖前奖品不现场抽取——区域击破后奖品仅「进入终盘奖池」；
 * 未击破区域的奖品对玩家隐藏，显示为「神秘奖品」。
 */
function presentPrizesForPlayer(state, seeds) {
  const withStatus = lottery.listPrizesWithStatus(state, seeds);
  const order = new Map(seeds.regions.map((region) => [region.id, region.order]));
  return withStatus
    .sort((a, b) => {
      const orderA = a.source === 'base' ? 0 : (order.get(a.source) || 99);
      const orderB = b.source === 'base' ? 0 : (order.get(b.source) || 99);
      return orderA - orderB;
    })
    .map((prize) => {
      if (!prize.available) {
        return {
          id: prize.id,
          source: prize.source,
          available: false,
          name: '神秘奖品',
          description: '解决对应区域的异变后揭晓',
          image: MYSTERY_PRIZE_PLACEHOLDER
        };
      }
      return {
        id: prize.id,
        source: prize.source,
        available: true,
        name: prize.name,
        description: prize.description,
        image: prize.image
      };
    });
}

function buildPublicState(state, seeds) {
  const ctx = { seeds, now: nowSec() };
  return {
    activity: buildActivityView(state, seeds),
    teams: buildTeamViews(state, seeds),
    regions: buildRegionViews(state, seeds, ctx),
    top_players: buildOverallLeaderboard(state, 20),
    prize_track: presentPrizesForPlayer(state, seeds),
    recent_contributions: contributions
      .recentGlobal(state, 15)
      .map((entry) => sanitizeLedgerEntry(state, entry, seeds)),
    system_events: state.system_events.slice(-8).reverse(),
    generated_at: Date.now()
  };
}

function buildPlayerHomeState(state, seeds, user) {
  const ctx = { seeds, now: nowSec() };
  const regionViews = buildRegionViews(state, seeds, ctx);
  const regionLeaderboards = {};
  for (const configRegion of seeds.regions) {
    regionLeaderboards[configRegion.id] = regions.buildRegionLeaderboard(state, configRegion.id, 10);
  }
  const availableInteractions = seeds.interactions
    .filter((interaction) => interaction.enabled !== false)
    .map((interaction) => ({
      id: interaction.id,
      name: interaction.name,
      description: interaction.description,
      energy_cost: interaction.energy_cost,
      cooldown_sec: interaction.cooldown_sec || 0,
      team_restriction: interaction.team_restriction || null,
      regions: interaction.regions || null,
      contribution_hint: interactionHint(interaction)
    }));

  const me = user
    ? players.buildPlayerView(state, user, ctx, {
      weight: weights.calculateUserWeight(state, user, seeds.lottery),
      rank: getUserRank(state, user.id),
      cooldowns: { ...user.cooldowns }
    })
    : null;

  return {
    activity: buildActivityView(state, seeds),
    teams: buildTeamViews(state, seeds),
    regions: regionViews,
    region_leaderboards: regionLeaderboards,
    interactions: availableInteractions,
    leaderboard: buildOverallLeaderboard(state, 50),
    recent_contributions: contributions
      .recentGlobal(state, 15)
      .map((entry) => sanitizeLedgerEntry(state, entry, seeds)),
    my_logs: user
      ? contributions.recentForUser(state, user.id, 12).map((entry) => sanitizeLedgerEntry(state, entry, seeds))
      : [],
    prizes: presentPrizesForPlayer(state, seeds),
    titles: seeds.titles,
    me,
    generated_at: Date.now()
  };
}

function buildAdminState(state, seeds) {
  const ctx = { seeds, now: nowSec() };
  const playersView = Object.values(state.users)
    .map((user) =>
      players.buildPlayerView(state, user, ctx, {
        weight: weights.calculateUserWeight(state, user, seeds.lottery)
      })
    )
    .sort((a, b) => b.total_contribution - a.total_contribution);

  const codesStats = {
    total: Object.keys(state.codes).length,
    unused: 0,
    bound: 0,
    disabled: 0
  };
  for (const codeEntry of Object.values(state.codes)) {
    if (codeEntry.disabled) {
      codesStats.disabled += 1;
    } else if (codeEntry.status === 'unused') {
      codesStats.unused += 1;
    } else if (codeEntry.status === 'bound') {
      codesStats.bound += 1;
    }
  }

  return {
    activity: buildActivityView(state, seeds),
    teams: buildTeamViews(state, seeds),
    regions: buildRegionViews(state, seeds, ctx).map((regionView) => ({
      ...regionView,
      participant_ids: state.regions[regionView.id]
        ? [...state.regions[regionView.id].participant_ids]
        : []
    })),
    players: playersView,
    codes_stats: codesStats,
    prizes: lottery.listPrizesWithStatus(state, seeds),
    draws: lottery.listDraws(state, seeds, { limit: 100 }),
    weights_preview: weights.buildWeightsTable(state, seeds.lottery).slice(0, 100),
    stage_events: stage.listStageEvents(seeds),
    recent_admin_logs: adminLog.recentAdminLogs(state, 40),
    recent_contributions: contributions
      .recentGlobal(state, 50)
      .map((entry) => sanitizeLedgerEntry(state, entry, seeds)),
    system_events: state.system_events.slice(-30).reverse(),
    generated_at: Date.now()
  };
}

function buildCodeAdminRows(state, seeds, query) {
  return codesModule.queryCodes(state, query || {}, (userId) =>
    players.displayNameOf(state, userId)
  );
}

module.exports = {
  buildActivityView,
  buildTeamViews,
  buildRegionViews,
  buildOverallLeaderboard,
  getUserRank,
  sanitizeLedgerEntry,
  buildPublicState,
  buildPlayerHomeState,
  buildAdminState,
  buildCodeAdminRows,
  ACTIVITY_STATUS
};
