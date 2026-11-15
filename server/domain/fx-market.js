'use strict';

const CANDLE_MS = 10000;
const CANDLE_LIMIT = 360;
const TICK_CANDLE_MS = 2000;
const TICK_CANDLE_LIMIT = 180;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function appendCandle(candles, at, price, previous, interval, limit) {
  const bucket = Math.floor(at / interval) * interval;
  const last = candles.at(-1);
  if (last?.at === bucket) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
  } else {
    // 开盘价取上一笔真实报价；停服期间不补造蜡烛。
    candles.push({ at: bucket, open: previous, high: Math.max(previous, price), low: Math.min(previous, price), close: price });
    if (candles.length > limit) candles.shift();
  }
}

function recordCandle(market, at, price, previous = price) {
  appendCandle(market.candles, at, price, previous, CANDLE_MS, CANDLE_LIMIT);
  market.tick_candles ??= [];
  appendCandle(market.tick_candles, at, price, previous, TICK_CANDLE_MS, TICK_CANDLE_LIMIT);
}

function restoreCandles(market, key, interval, limit) {
  if (!Array.isArray(market[key]) || !market[key].length) {
    market[key] = [];
    let previous;
    for (const point of market.history || []) {
      if (!Number.isFinite(point.at) || !Number.isFinite(point.price)) continue;
      appendCandle(market[key], point.at, point.price, previous ?? point.price, interval, limit);
      previous = point.price;
    }
    if (!market[key].length) appendCandle(market[key], market.updated_at, market.price, market.price, interval, limit);
  }
}

function normalizeMarket(market) {
  restoreCandles(market, 'candles', CANDLE_MS, CANDLE_LIMIT);
  // 升级时只从留存的逐拍报价恢复，不把旧 10 秒蜡烛拆成虚构报价。
  restoreCandles(market, 'tick_candles', TICK_CANDLE_MS, TICK_CANDLE_LIMIT);
  if (!Number.isFinite(market.momentum)) market.momentum = 0;
  if (!Number.isFinite(market.variance)) market.variance = 0.000025;
  if (!Number.isFinite(market.anchor) || market.anchor <= 0) market.anchor = market.price;
  if (!Number.isFinite(market.last_innovation)) market.last_innovation = 0;
  if (!market.regime || !['range', 'trend', 'active'].includes(market.regime.mode)) market.regime = { mode: 'range', ticks: 90, drift: 0 };
}

function nextMove(market, pick, context = {}) {
  if (!market.regime) market.regime = { mode: 'range', ticks: 90, drift: 0 };
  if (!Number.isFinite(market.last_innovation)) market.last_innovation = 0;
  // 共同风险因子 + 各货币自身扰动，盘整/趋势/活跃状态持续 2～6 个运行分钟。
  const u = (pick(0, 20001) + 1) / 20002;
  const noise = clamp(Math.log(u / (1 - u)) / 1.814, -3, 3);
  market.last_noise = noise;
  if (!context.regime && --market.regime.ticks <= 0) {
    const roll = pick(0, 100);
    const mode = roll < 45 ? 'range' : roll < 85 ? 'trend' : 'active';
    market.regime = { mode, ticks: pick(60, 181), drift: mode === 'trend' ? (pick(0, 2) ? 1 : -1) * .00055 : 0 };
  }
  const regime = context.regime || market.regime;
  const scale = regime.mode === 'active' ? 1.55 : regime.mode === 'range' ? .85 : 1.05;
  const beta = context.beta ?? 1;
  const combined = context.shared === undefined ? noise : beta * context.shared + Math.sqrt(1 - beta * beta) * noise;
  const sigma = Math.sqrt(clamp(market.variance, 0.000016, 0.000064));
  const innovation = combined * sigma;
  const reference = context.reference || 100;
  const relative = market.price / reference;
  const boundaryPull = relative < .3 ? (.3 - relative) * .02 : relative > 4 ? (4 - relative) * .002 : 0;
  const anchor = market.anchor || market.price;
  const reversion = Math.log(anchor / market.price) * (regime.mode === 'range' ? .0025 : .0005);
  const pullback = regime.mode === 'range' ? -.16 * market.last_innovation : 0;
  const move = (market.momentum + innovation * scale + regime.drift * beta + pullback) * (context.volatility || 1)
    + reversion + boundaryPull + combined * (context.aftershock ?? market.event_effect?.volatility ?? 0);
  market.momentum = clamp(market.momentum * (regime.mode === 'trend' ? .96 : .84) + innovation * .06, -.0025, .0025);
  market.variance = 0.000025 * 0.04 + market.variance * 0.90 + innovation * innovation * 0.06;
  market.last_innovation = innovation;
  // 参考重心缓慢跟随价格，避免长期被钉在固定初始价。
  market.anchor = Math.exp(Math.log(anchor) * .998 + Math.log(market.price) * .002);
  return move;
}

module.exports = { CANDLE_MS, CANDLE_LIMIT, TICK_CANDLE_MS, TICK_CANDLE_LIMIT, recordCandle, normalizeMarket, nextMove };
