'use strict';

/**
 * 种子配置加载与校验。
 * 所有活动规则（区域 / 互动 / 奖品 / 抽奖权重 / 节目事件）都从这里读取，
 * 启动时做交叉引用校验，配置有问题直接拒绝启动——现场排错优于静默降级。
 */

const fs = require('node:fs');
const path = require('node:path');

const { compileWordList } = require('../shared/sensitive-words');
const { TEAM_IDS, CODE_TYPES } = require('../shared/constants');

const REQUIRED_SEED_FILES = [
  'activity.json',
  'teams.json',
  'regions.json',
  'interactions.json',
  'prizes.json',
  'lottery.json',
  'stage-events.json',
  'titles.json',
  'sensitive-words.json'
];

function readSeedFile(seedsDir, fileName) {
  const filePath = path.join(seedsDir, fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`读取种子配置失败 ${fileName}: ${error.message}`);
  }
}

function toCamelCase(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function loadSeeds(seedsDir) {
  const seeds = {};
  for (const fileName of REQUIRED_SEED_FILES) {
    seeds[toCamelCase(path.basename(fileName, '.json'))] = readSeedFile(seedsDir, fileName);
  }
  const problems = validateSeeds(seeds);
  if (problems.length > 0) {
    throw new Error(
      `种子配置校验失败：\n- ${problems.join('\n- ')}`
    );
  }
  seeds.sensitiveWords = compileWordList(seeds.sensitiveWords);
  return seeds;
}

function validateSeeds(seeds) {
  const problems = [];
  const { activity, teams, regions, interactions, prizes, lottery, stageEvents, titles, sensitiveWords } = seeds;

  if (!activity || typeof activity !== 'object') {
    problems.push('activity.json 必须是对象');
  }
  for (const field of ['name', 'energy_cap', 'energy_regen_interval_sec', 'team_join_max_diff']) {
    if (activity && activity[field] === undefined) {
      problems.push(`activity.json 缺少字段 ${field}`);
    }
  }

  if (!Array.isArray(teams) || teams.length === 0) {
    problems.push('teams.json 必须是非空数组');
  } else {
    const teamIds = new Set();
    for (const team of teams) {
      if (!team.id || !team.name) {
        problems.push(`teams.json 存在缺少 id/name 的队伍: ${JSON.stringify(team)}`);
        continue;
      }
      if (teamIds.has(team.id)) {
        problems.push(`teams.json 队伍 id 重复: ${team.id}`);
      }
      teamIds.add(team.id);
    }
    if (teams.length && !teamIds.has(TEAM_IDS.REIMU)) {
      problems.push(`teams.json 缺少队伍 ${TEAM_IDS.REIMU}`);
    }
    if (teams.length && !teamIds.has(TEAM_IDS.MARISA)) {
      problems.push(`teams.json 缺少队伍 ${TEAM_IDS.MARISA}`);
    }
  }

  const regionIds = new Set();
  if (!Array.isArray(regions) || regions.length === 0) {
    problems.push('regions.json 必须是非空数组');
  } else {
    const orders = new Set();
    for (const region of regions) {
      if (!region.id || !region.name) {
        problems.push(`regions.json 存在缺少 id/name 的区域: ${JSON.stringify(region && region.id)}`);
        continue;
      }
      if (regionIds.has(region.id)) {
        problems.push(`regions.json 区域 id 重复: ${region.id}`);
      }
      regionIds.add(region.id);
      if (!Number.isFinite(region.max_anomaly) || region.max_anomaly <= 0) {
        problems.push(`区域 ${region.id} 的 max_anomaly 必须是正数`);
      }
      if (!Number.isFinite(region.order) || orders.has(region.order)) {
        problems.push(`区域 ${region.id} 的 order 缺失或重复: ${region.order}`);
      }
      orders.add(region.order);
      if (!region.map || !Number.isFinite(region.map.x) || !Number.isFinite(region.map.y)) {
        problems.push(`区域 ${region.id} 缺少 map 坐标`);
      }
      const unlockAfter = Array.isArray(region.unlock_after) ? region.unlock_after : [];
      for (const dep of unlockAfter) {
        if (dep === region.id) {
          problems.push(`区域 ${region.id} 不能以自己作为解锁条件`);
        }
      }
      if (!Array.isArray(region.prize_ids)) {
        problems.push(`区域 ${region.id} 缺少 prize_ids 数组`);
      }
    }
    for (const region of regions) {
      const unlockAfter = Array.isArray(region.unlock_after) ? region.unlock_after : [];
      for (const dep of unlockAfter) {
        if (!regionIds.has(dep)) {
          problems.push(`区域 ${region.id} 的解锁条件引用了不存在的区域: ${dep}`);
        }
      }
    }
  }

  if (!Array.isArray(interactions) || interactions.length === 0) {
    problems.push('interactions.json 必须是非空数组');
  } else {
    const interactionIds = new Set();
    for (const interaction of interactions) {
      if (!interaction.id) {
        problems.push('interactions.json 存在缺少 id 的互动');
        continue;
      }
      if (interactionIds.has(interaction.id)) {
        problems.push(`interactions.json 互动 id 重复: ${interaction.id}`);
      }
      interactionIds.add(interaction.id);
      if (!Array.isArray(interaction.outcomes) || interaction.outcomes.length === 0) {
        problems.push(`互动 ${interaction.id} 缺少 outcomes 数组`);
        continue;
      }
      for (const [index, outcome] of interaction.outcomes.entries()) {
        if (!Number.isFinite(outcome.weight) || outcome.weight < 0) {
          problems.push(`互动 ${interaction.id} 第 ${index} 个 outcome 权重非法`);
        }
        if (outcome.contribution && !isValidRange(outcome.contribution)) {
          problems.push(`互动 ${interaction.id} 第 ${index} 个 outcome contribution 区间非法`);
        }
        if (outcome.anomaly && !isValidRange(outcome.anomaly)) {
          problems.push(`互动 ${interaction.id} 第 ${index} 个 outcome anomaly 区间非法`);
        }
      }
      if (interaction.team_restriction && TEAM_IDS && !Object.values(TEAM_IDS).includes(interaction.team_restriction)) {
        problems.push(`互动 ${interaction.id} 的 team_restriction 非法: ${interaction.team_restriction}`);
      }
      if (Array.isArray(interaction.regions)) {
        for (const regionId of interaction.regions) {
          if (!regionIds.has(regionId)) {
            problems.push(`互动 ${interaction.id} 引用了不存在的区域: ${regionId}`);
          }
        }
      }
      if (interaction.time_window) {
        if (!Number.isFinite(interaction.time_window.start) || !Number.isFinite(interaction.time_window.end)) {
          problems.push(`互动 ${interaction.id} 的 time_window 需要 start/end 数值时间戳（秒）`);
        }
      }
    }
  }

  const prizeIds = new Set();
  if (!Array.isArray(prizes) || prizes.length === 0) {
    problems.push('prizes.json 必须是非空数组');
  } else {
    for (const prize of prizes) {
      if (!prize.id || !prize.name) {
        problems.push(`prizes.json 存在缺少 id/name 的奖品: ${JSON.stringify(prize && prize.id)}`);
        continue;
      }
      if (prizeIds.has(prize.id)) {
        problems.push(`prizes.json 奖品 id 重复: ${prize.id}`);
      }
      prizeIds.add(prize.id);
      if (!Number.isFinite(prize.count) || prize.count < 1) {
        problems.push(`奖品 ${prize.id} 的 count 必须不小于 1`);
      }
      if (prize.source !== 'base' && !regionIds.has(prize.source)) {
        problems.push(`奖品 ${prize.id} 的 source 既不是 base 也不是有效区域: ${prize.source}`);
      }
    }
    for (const region of regions || []) {
      for (const prizeId of region.prize_ids || []) {
        if (!prizeIds.has(prizeId)) {
          problems.push(`区域 ${region.id} 引用了不存在的奖品: ${prizeId}`);
        }
      }
    }
  }

  if (!lottery || typeof lottery !== 'object') {
    problems.push('lottery.json 必须是对象');
  } else {
    for (const tier of lottery.contribution_bonus_tiers || []) {
      if (!Number.isFinite(tier.min_total) || !Number.isFinite(tier.bonus)) {
        problems.push('lottery.json contribution_bonus_tiers 存在非法条目');
      }
    }
    for (const tier of lottery.region_rank_bonus || []) {
      const hasExact = Number.isFinite(tier.rank);
      const hasRange = Number.isFinite(tier.min_rank) && Number.isFinite(tier.max_rank);
      if (!hasExact && !hasRange) {
        problems.push('lottery.json region_rank_bonus 条目需要 rank 或 min_rank/max_rank');
      }
      if (!Number.isFinite(tier.bonus)) {
        problems.push('lottery.json region_rank_bonus 缺少 bonus');
      }
    }
    if (
      lottery.region_rank_bonus_scope &&
      !['cleared', 'all'].includes(lottery.region_rank_bonus_scope)
    ) {
      problems.push('lottery.json region_rank_bonus_scope 只能是 cleared 或 all');
    }
    for (const [type, weight] of Object.entries(lottery.code_type_base_weights || {})) {
      if (!Object.values(CODE_TYPES).includes(type)) {
        problems.push(`lottery.json code_type_base_weights 存在未知票种: ${type}`);
      }
      if (!Number.isFinite(weight) || weight <= 0) {
        problems.push(`lottery.json 票种 ${type} 的基础权重必须为正数`);
      }
    }
  }

  if (!Array.isArray(stageEvents)) {
    problems.push('stage-events.json 必须是数组');
  } else {
    const stageIds = new Set();
    const teamIds = new Set((teams || []).map((team) => team.id));
    for (const event of stageEvents) {
      if (!event.id || !event.name || !event.effect) {
        problems.push(`stage-events.json 存在不完整的事件: ${JSON.stringify(event && event.id)}`);
        continue;
      }
      if (stageIds.has(event.id)) {
        problems.push(`stage-events.json 事件 id 重复: ${event.id}`);
      }
      stageIds.add(event.id);
      const effect = event.effect;
      if (effect.type === 'team_contribution' || effect.type === 'team_pool_contribution') {
        if (!teamIds.has(effect.team)) {
          problems.push(`节目事件 ${event.id} 引用了不存在的队伍: ${effect.team}`);
        }
        if (!Number.isFinite(effect.amount) || effect.amount <= 0) {
          problems.push(`节目事件 ${event.id} 的 amount 必须为正数`);
        }
      } else if (effect.type === 'reduce_anomaly') {
        if (!regionIds.has(effect.region)) {
          problems.push(`节目事件 ${event.id} 引用了不存在的区域: ${effect.region}`);
        }
        if (!Number.isFinite(effect.amount) || effect.amount <= 0) {
          problems.push(`节目事件 ${event.id} 的 amount 必须为正数`);
        }
      } else if (effect.type === 'unlock_region') {
        if (!regionIds.has(effect.region)) {
          problems.push(`节目事件 ${event.id} 引用了不存在的区域: ${effect.region}`);
        }
      } else {
        problems.push(`节目事件 ${event.id} 的效果类型未知: ${effect.type}`);
      }
    }
  }

  if (!Array.isArray(titles) || titles.length === 0) {
    problems.push('titles.json 必须是非空数组');
  } else {
    for (const title of titles) {
      if (!Number.isFinite(title.min_contribution) || !title.title) {
        problems.push('titles.json 存在缺少 min_contribution/title 的条目');
      }
    }
  }

  if (!sensitiveWords || typeof sensitiveWords !== 'object' || !sensitiveWords.categories) {
    problems.push('sensitive-words.json 必须包含 categories 对象');
  } else {
    for (const [category, words] of Object.entries(sensitiveWords.categories)) {
      if (!Array.isArray(words) || words.some((word) => typeof word !== 'string')) {
        problems.push(`sensitive-words.json 的分类 ${category} 必须是字符串数组`);
      }
    }
  }

  return problems;
}

function isValidRange(range) {
  return (
    Array.isArray(range) &&
    range.length === 2 &&
    Number.isFinite(range[0]) &&
    Number.isFinite(range[1])
  );
}

module.exports = {
  loadSeeds,
  validateSeeds,
  REQUIRED_SEED_FILES
};
