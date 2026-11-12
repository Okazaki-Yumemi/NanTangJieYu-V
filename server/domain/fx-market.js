'use strict';

const CANDLE_MS = 10000;
const CANDLE_LIMIT = 360;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function recordCandle(market, at, price, previous = price) {
  const bucket = Math.floor(at / CANDLE_MS) * CANDLE_MS;
  const last = market.candles.at(-1);
  if (last?.at === bucket) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
  } else {
    // 开盘价取上一笔真实报价；停服期间不补造蜡烛。
    market.candles.push({ at: bucket, open: previous, high: Math.max(previous, price), low: Math.min(previous, price), close: price });
    if (market.candles.length > CANDLE_LIMIT) market.candles.shift();
  }
}

function normalizeMarket(market) {
  if (!Array.isArray(market.candles)) {
    market.candles = [];
    let previous;
    for (const point of market.history || []) {
      if (!Number.isFinite(point.at) || !Number.isFinite(point.price)) continue;
      recordCandle(market, point.at, point.price, previous ?? point.price);
      previous = point.price;
    }
    if (!market.candles.length) recordCandle(market, market.updated_at, market.price);
  }
  if (!Number.isFinite(market.momentum)) market.momentum = 0;
  if (!Number.isFinite(market.variance)) market.variance = 0.000025;
}

function nextMove(market, pick) {
  // 有厚尾的随机扰动 + 缓慢衰减的趋势 + 波动聚集。新闻冲击不写入趋势。
  const u = (pick(0, 20001) + 1) / 20002;
  const noise = clamp(Math.log(u / (1 - u)) / 1.814, -3, 3);
  const sigma = Math.sqrt(clamp(market.variance, 0.000016, 0.0001));
  const innovation = noise * sigma;
  const boundaryPull = market.price < 30 ? (30 - market.price) * 0.0002 : market.price > 400 ? (400 - market.price) * 0.00002 : 0;
  const move = market.momentum + innovation + boundaryPull + noise * (market.event_effect?.volatility || 0);
  market.momentum = clamp(market.momentum * 0.92 + innovation * 0.08, -0.0025, 0.0025);
  market.variance = 0.000025 * 0.04 + market.variance * 0.90 + innovation * innovation * 0.06;
  return move;
}

module.exports = { CANDLE_MS, CANDLE_LIMIT, recordCandle, normalizeMarket, nextMove };
