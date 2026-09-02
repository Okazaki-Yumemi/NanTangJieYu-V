'use strict';

/**
 * 抽奖（Lottery）领域逻辑：奖池状态、按权重抽取、领奖 / 作废。
 *
 * 奖品来自 shared/seeds/prizes.json：
 * - source: 'base'    → 基础奖池，活动即可抽取
 * - source: <区域id>  → 该区域异变解决后解锁
 * 防重复中奖、权重快照、作废重抽均在此处理。
 */

const { ERROR_CODES, LEDGER_KINDS } = require('../../shared/constants');
const { newId } = require('../auth');
const { randomUnit, weightedPick } = require('../../shared/random');
const contributions = require('./contributions');
const regions = require('./regions');
const weights = require('./weights');

function getPrize(seeds, prizeId) {
  return seeds.prizes.find((prize) => prize.id === prizeId) || null;
}

function drawnCount(state, prizeId) {
  return state.lottery.draws.filter(
    (draw) => draw.prize_id === prizeId && draw.status !== 'void'
  ).length;
}

function listPrizesWithStatus(state, seeds) {
  return seeds.prizes.map((prize) => {
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

function buildEligiblePool(state, seeds, { preventRepeatWinners }) {
  const pool = [];
  for (const user of Object.values(state.users)) {
    if (user.banned) {
      continue;
    }
    if (preventRepeatWinners && hasActiveWin(state, user.id)) {
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
  const prize = getPrize(seeds, prizeId);
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
  const pool = buildEligiblePool(state, seeds, { preventRepeatWinners: preventRepeat });
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

function markClaimed(state, drawId, nowSec) {
  const draw = getDraw(state, drawId);
  if (!draw) {
    return { error: ERROR_CODES.NOT_FOUND, message: '抽奖记录不存在。' };
  }
  if (draw.status === 'void') {
    return { error: ERROR_CODES.NO_CHANGE, message: '该记录已作废，不能标记领取。' };
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
  const prize = getPrize(seeds, draw.prize_id);
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
  drawnCount,
  listPrizesWithStatus,
  hasActiveWin,
  buildEligiblePool,
  drawPrize,
  getDraw,
  markClaimed,
  voidDraw,
  buildDrawView,
  listDraws,
  buildDrawLedgerEntry
};
