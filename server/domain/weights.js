'use strict';

/**
 * LotteryWeightCalculator —— 抽奖权重计算（独立纯模块）。
 *
 * 权重 = 票种基础权重
 *      + 个人总贡献加成（贡献阶梯，配置化）
 *      + 区域排名加成（每个符合条件区域按名次加成，配置化）
 *      + 管理员手工调整量（可正可负）
 *
 * 所有规则来自 shared/seeds/lottery.json，不要在这里硬编码数值。
 */

const regions = require('./regions');

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function calcBaseWeight(user, lotteryConfig) {
  const fallback = Number(lotteryConfig.default_base_weight) || 1;
  const base = Number(user.weight_base);
  if (Number.isFinite(base) && base > 0) {
    return base;
  }
  const byType = Number(lotteryConfig.code_type_base_weights[user.code_type]);
  return Number.isFinite(byType) && byType > 0 ? byType : fallback;
}

function calcContributionBonus(totalContribution, tiers) {
  let bonus = 0;
  for (const tier of tiers || []) {
    if (totalContribution >= tier.min_total) {
      bonus = tier.bonus;
    }
  }
  return Number(bonus) || 0;
}

function matchRankBonus(rank, tiers) {
  for (const tier of tiers || []) {
    if (Number.isFinite(tier.rank)) {
      if (rank === tier.rank) {
        return Number(tier.bonus) || 0;
      }
      continue;
    }
    if (rank >= tier.min_rank && rank <= tier.max_rank) {
      return Number(tier.bonus) || 0;
    }
  }
  return 0;
}

/**
 * 计算玩家在所有「符合条件区域」上的排名加成总和。
 * scope = 'cleared'（默认）时只统计已解决异变的区域。
 */
function calcRegionRankBonus(state, user, lotteryConfig) {
  const scope = lotteryConfig.region_rank_bonus_scope || 'cleared';
  let total = 0;
  for (const regionRuntime of Object.entries(state.regions)) {
    const [regionId, runtime] = regionRuntime;
    if (scope === 'cleared' && !runtime.cleared) {
      continue;
    }
    const userContribution = Number(user.region_contributions[regionId]) || 0;
    if (userContribution <= 0) {
      continue;
    }
    const rank = regions.getUserRegionRank(state, regionId, user.id);
    if (rank !== null) {
      total += matchRankBonus(rank, lotteryConfig.region_rank_bonus);
    }
  }
  return total;
}

/**
 * 计算玩家当前抽奖权重。
 * state 只读；不产生副作用。
 */
function calculateUserWeight(state, user, lotteryConfig) {
  const base = calcBaseWeight(user, lotteryConfig);
  const contributionBonus = calcContributionBonus(
    user.total_contribution || 0,
    lotteryConfig.contribution_bonus_tiers
  );
  const rankBonus = calcRegionRankBonus(state, user, lotteryConfig);
  const override = Number.isFinite(Number(user.weight_override)) ? Number(user.weight_override) : 0;
  const minWeight = Number(lotteryConfig.min_weight) || 0.01;
  return round6(Math.max(minWeight, base + contributionBonus + rankBonus + override));
}

/**
 * 全体玩家权重表（管理端预览 / 抽奖用）。
 */
function buildWeightsTable(state, lotteryConfig) {
  return Object.values(state.users)
    .map((user) => ({
      user_id: user.id,
      display_name: user.display_name,
      team: user.team,
      total_contribution: user.total_contribution,
      banned: Boolean(user.banned),
      weight: calculateUserWeight(state, user, lotteryConfig)
    }))
    .sort((a, b) => b.weight - a.weight || b.total_contribution - a.total_contribution);
}

module.exports = {
  calculateUserWeight,
  calcBaseWeight,
  calcContributionBonus,
  calcRegionRankBonus,
  matchRankBonus,
  buildWeightsTable,
  round6
};
