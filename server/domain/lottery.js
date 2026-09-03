'use strict';

/**
 * 抽奖（Lottery）领域逻辑：奖池状态、按权重抽取、领奖 / 作废。
 *
 * 奖品来自 shared/seeds/prizes.json：
 * - source: 'base'    → 基础奖池，活动即可抽取
 * - source: <区域id>  → 该区域异变解决后解锁
 * 同一奖品内防重复中奖、权重快照、作废重抽均在此处理。
 */

const { ERROR_CODES, LEDGER_KINDS } = require('../../shared/constants');
const { newId, newToken } = require('../auth');
const { randomUnit, weightedPick } = require('../../shared/random');
const contributions = require('./contributions');
const regions = require('./regions');
const weights = require('./weights');

const MYSTERY_PLACEHOLDER = '/assets/regions/prize-placeholder.svg';

function normalizeOverrides(state) {
  if (!state.lottery.prize_overrides || typeof state.lottery.prize_overrides !== 'object') {
    state.lottery.prize_overrides = {};
  }
  if (!Array.isArray(state.lottery.custom_prizes)) {
    state.lottery.custom_prizes = [];
  }
  return { overrides: state.lottery.prize_overrides, custom: state.lottery.custom_prizes };
}

/**
 * 完整奖品目录 = 种子奖品 + 管理员自定义奖品，再套用管理员的修改覆盖。
 * 管理员可在现场直接填写 / 修正奖品信息，无需改配置重启。
 */
function getPrizeCatalog(state, seeds) {
  const { overrides, custom } = normalizeOverrides(state);
  return [...seeds.prizes, ...custom].map((prize) => {
    const override = overrides[prize.id] || {};
    const merged = { ...prize };
    for (const field of ['name', 'description', 'image', 'count', 'source']) {
      if (override[field] !== undefined && override[field] !== null && override[field] !== '') {
        merged[field] = override[field];
      }
    }
    if (!merged.image) {
      merged.image = MYSTERY_PLACEHOLDER;
    }
    return merged;
  });
}

function getPrize(state, seeds, prizeId) {
  return getPrizeCatalog(state, seeds).find((prize) => prize.id === prizeId) || null;
}

function validatePrizePatch(state, seeds, patch) {
  if (patch.name !== undefined && String(patch.name).trim() === '') {
    return { error: 'VALIDATION_FAILED', message: '奖品名称不能为空。' };
  }
  if (patch.count !== undefined) {
    const count = Math.floor(Number(patch.count));
    if (!Number.isFinite(count) || count < 1 || count > 999) {
      return { error: 'VALIDATION_FAILED', message: '数量需要是 1 ~ 999 的整数。' };
    }
  }
  if (patch.source !== undefined && patch.source !== 'base') {
    const region = seeds.regions.find((region) => region.id === patch.source);
    if (!region) {
      return { error: 'VALIDATION_FAILED', message: '绑定的区域不存在。' };
    }
  }
  return {};
}

/**
 * 新增自定义奖品（管理员现场填写）。
 */
function addCustomPrize(state, seeds, payload, nowSec) {
  const { custom } = normalizeOverrides(state);
  const patch = {
    name: payload.name,
    description: payload.description,
    image: payload.image,
    count: payload.count === undefined ? 1 : payload.count,
    source: payload.source === undefined ? 'base' : payload.source
  };
  const invalid = validatePrizePatch(state, seeds, patch);
  if (invalid.error) {
    return invalid;
  }
  const prize = {
    id: `prize_custom_${newToken(4)}`,
    name: String(patch.name).trim().slice(0, 60),
    description: String(patch.description || '').trim().slice(0, 200),
    image: String(patch.image || '').trim() || MYSTERY_PLACEHOLDER,
    source: patch.source,
    count: Math.floor(Number(patch.count)),
    custom: true,
    created_at: nowSec
  };
  custom.push(prize);
  return { prize };
}

/**
 * 修改奖品信息（种子奖品与自定义奖品都走覆盖表，原始定义保留可回溯）。
 */
function updatePrize(state, seeds, prizeId, payload) {
  const { overrides } = normalizeOverrides(state);
  const prize = getPrize(state, seeds, prizeId);
  if (!prize) {
    return { error: 'PRIZE_NOT_FOUND', message: '奖品不存在。' };
  }
  const patch = {};
  for (const field of ['name', 'description', 'image', 'count', 'source']) {
    if (payload[field] !== undefined) {
      patch[field] = payload[field];
    }
  }
  const invalid = validatePrizePatch(state, seeds, patch);
  if (invalid.error) {
    return invalid;
  }
  const previous = {
    name: prize.name,
    description: prize.description,
    image: prize.image,
    count: prize.count,
    source: prize.source
  };
  const applied = {};
  if (patch.name !== undefined) {
    overrides[prizeId] = overrides[prizeId] || {};
    overrides[prizeId].name = String(patch.name).trim().slice(0, 60);
    applied.name = overrides[prizeId].name;
  }
  if (patch.description !== undefined) {
    overrides[prizeId] = overrides[prizeId] || {};
    overrides[prizeId].description = String(patch.description).trim().slice(0, 200);
    applied.description = overrides[prizeId].description;
  }
  if (patch.image !== undefined) {
    overrides[prizeId] = overrides[prizeId] || {};
    overrides[prizeId].image = String(patch.image).trim().slice(0, 200) || MYSTERY_PLACEHOLDER;
    applied.image = overrides[prizeId].image;
  }
  if (patch.count !== undefined) {
    overrides[prizeId] = overrides[prizeId] || {};
    overrides[prizeId].count = Math.floor(Number(patch.count));
    applied.count = overrides[prizeId].count;
  }
  if (patch.source !== undefined) {
    overrides[prizeId] = overrides[prizeId] || {};
    overrides[prizeId].source = patch.source;
    applied.source = patch.source;
  }
  return { previous, applied };
}

function latestDraw(state, seeds) {
  for (const draw of [...state.lottery.draws].reverse()) {
    if (draw.status === 'void') {
      continue;
    }
    return buildDrawView(state, draw, seeds);
  }
  return null;
}

function drawnCount(state, prizeId) {
  return state.lottery.draws.filter(
    (draw) => draw.prize_id === prizeId && draw.status !== 'void'
  ).length;
}

function listPrizesWithStatus(state, seeds) {
  return getPrizeCatalog(state, seeds).map((prize) => {
    const drawn = drawnCount(state, prize.id);
    return {
      ...prize,
      available: regions.prizeAvailability(state, prize),
      drawn,
      remaining: Math.max(0, Math.floor(prize.count) - drawn),
      source_region_cleared: prize.source === 'base'
        ? null
        : Boolean(state.regions[prize.source] && state.regions[prize.source].cleared)
    };
  });
}

function hasActiveWin(state, userId) {
  return state.lottery.draws.some(
    (draw) => draw.user_id === userId && draw.status !== 'void'
  );
}

/**
 * 检查玩家是否已经赢得过指定奖品；作废记录不占用该奖品名额。
 */
function hasActiveWinForPrize(state, userId, prizeId) {
  return state.lottery.draws.some(
    (draw) =>
      draw.user_id === userId &&
      draw.prize_id === prizeId &&
      draw.status !== 'void'
  );
}

function buildEligiblePool(state, seeds, { preventRepeatWinners, prizeId = '' } = {}) {
  const pool = [];
  for (const user of Object.values(state.users)) {
    if (user.banned) {
      continue;
    }
    const hasWon = prizeId
      ? hasActiveWinForPrize(state, user.id, prizeId)
      : hasActiveWin(state, user.id);
    if (preventRepeatWinners && hasWon) {
      continue;
    }
    const weight = weights.calculateUserWeight(state, user, seeds.lottery);
    if (weight > 0) {
      pool.push({ user, weight });
    }
  }
  return pool;
}

/**
 * 执行一次抽奖。
 */
function drawPrize(state, prizeId, seeds, nowSec) {
  const prize = getPrize(state, seeds, prizeId);
  if (!prize) {
    return { error: ERROR_CODES.PRIZE_NOT_FOUND, message: '奖品不存在。' };
  }
  if (!regions.prizeAvailability(state, prize)) {
    const sourceLabel = prize.source === 'base'
      ? '基础'
      : `需要先解决「${(seeds.regions.find((region) => region.id === prize.source) || {}).name || prize.source}」异变`;
    return { error: ERROR_CODES.PRIZE_LOCKED, message: `奖品尚未解锁（${sourceLabel}）。` };
  }
  if (drawnCount(state, prize.id) >= Math.floor(prize.count)) {
    return { error: ERROR_CODES.PRIZE_LOCKED, message: '该奖品已被抽完。' };
  }

  const preventRepeat = seeds.lottery.prevent_repeat_winners !== false;
  const pool = buildEligiblePool(state, seeds, {
    preventRepeatWinners: preventRepeat,
    prizeId: prize.id
  });
  if (pool.length === 0) {
    return { error: ERROR_CODES.NO_ELIGIBLE_PLAYERS, message: '当前没有可参与的玩家。' };
  }

  const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
  const picked = weightedPick(pool, randomUnit, (item) => item.weight);
  if (!picked) {
    return { error: ERROR_CODES.NO_ELIGIBLE_PLAYERS, message: '当前没有可参与的玩家。' };
  }

  const draw = {
    id: newId('draw'),
    prize_id: prize.id,
    user_id: picked.user.id,
    weight_snapshot: picked.weight,
    total_weight_snapshot: Number(totalWeight.toFixed(6)),
    pool_size: pool.length,
    status: 'pending',
    claimed_at: 0,
    void_reason: '',
    drawn_at: nowSec
  };
  state.lottery.draws.push(draw);

  return { draw, prize, winner: picked.user };
}

function getDraw(state, drawId) {
  return state.lottery.draws.find((draw) => draw.id === drawId) || null;
}

function markConfirmed(state, drawId, nowSec) {
  const draw = getDraw(state, drawId);
  if (!draw) {
    return { error: 'NOT_FOUND', message: '抽奖记录不存在。' };
  }
  if (draw.status === 'void') {
    return { error: 'NO_CHANGE', message: '该记录已作废，不能确认。' };
  }
  if (draw.status !== 'pending') {
    return { error: 'NO_CHANGE', message: '该记录已经确认过。' };
  }
  draw.status = 'confirmed';
  draw.confirmed_at = nowSec;
  return { draw };
}

function markClaimed(state, drawId, nowSec) {
  const draw = getDraw(state, drawId);
  if (!draw) {
    return { error: 'NOT_FOUND', message: '抽奖记录不存在。' };
  }
  if (draw.status === 'void') {
    return { error: 'NO_CHANGE', message: '该记录已作废，不能标记领取。' };
  }
  if (draw.status === 'pending') {
    return { error: 'NO_CHANGE', message: '请先「确认有效」再标记领取。' };
  }
  draw.status = 'claimed';
  draw.claimed_at = nowSec;
  return { draw };
}

function voidDraw(state, drawId, reason, nowSec) {
  const draw = getDraw(state, drawId);
  if (!draw) {
    return { error: ERROR_CODES.NOT_FOUND, message: '抽奖记录不存在。' };
  }
  if (draw.status === 'void') {
    return { error: ERROR_CODES.NO_CHANGE, message: '该记录已经作废。' };
  }
  draw.status = 'void';
  draw.void_reason = String(reason || '').slice(0, 200);
  draw.voided_at = nowSec;
  return { draw };
}

function buildDrawView(state, draw, seeds) {
  const prize = getPrize(state, seeds, draw.prize_id);
  const user = state.users[draw.user_id];
  return {
    ...draw,
    prize_name: prize ? prize.name : draw.prize_id,
    prize_source: prize ? prize.source : '',
    winner_display_name: user ? user.display_name : '(已删除)',
    winner_team: user ? user.team : ''
  };
}

function listDraws(state, seeds, { limit = 200 } = {}) {
  return state.lottery.draws
    .slice(-limit)
    .reverse()
    .map((draw) => buildDrawView(state, draw, seeds));
}

/**
 * 抽奖入账（供管理员把某次作废重发等记录成流水说明）。目前仅审计用。
 */
function buildDrawLedgerEntry({ draw, prize, winner }, nowSec) {
  return contributions.buildLedgerEntry({
    kind: LEDGER_KINDS.SYSTEM,
    user_id: winner ? winner.id : '',
    team: winner ? winner.team : '',
    reason: `抽奖：${prize ? prize.name : draw.prize_id}`,
    user_delta: 0,
    team_delta: 0,
    meta: {
      draw_id: draw.id,
      prize_id: draw.prize_id,
      weight_snapshot: draw.weight_snapshot
    }
  }, nowSec);
}

module.exports = {
  getPrize,
  getPrizeCatalog,
  addCustomPrize,
  updatePrize,
  latestDraw,
  drawnCount,
  listPrizesWithStatus,
  hasActiveWin,
  hasActiveWinForPrize,
  buildEligiblePool,
  drawPrize,
  getDraw,
  markConfirmed,
  markClaimed,
  voidDraw,
  buildDrawView,
  listDraws,
  buildDrawLedgerEntry
};
