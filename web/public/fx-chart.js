/* 以服务器真实 OHLC 聚合；缺失时段留给时间标签，不补造行情。 */
(() => {
  'use strict';
  function aggregate(candles, seconds) {
    const result = [], interval = seconds * 1000;
    for (const candle of candles) {
      const at = Math.floor(candle.at / interval) * interval;
      const last = result.at(-1);
      if (last?.at === at) {
        last.high = Math.max(last.high, candle.high); last.low = Math.min(last.low, candle.low); last.close = candle.close;
      } else result.push({ ...candle, at });
    }
    return result;
  }
  function series(market, seconds) {
    return aggregate((seconds === 2 ? market.tick_candles : market.candles) || [], seconds);
  }
  function draw(canvas, market, seconds, pointerX) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(dpr, dpr);
    const bars = series(market, seconds).slice(-Math.max(20, Math.min(80, Math.floor(rect.width / 9))));
    if (!bars.length) return null;
    const min = Math.min(...bars.map(b => b.low)), max = Math.max(...bars.map(b => b.high));
    const pad = Math.max((max - min) * .14, market.price * .003);
    const low = min - pad, high = max + pad;
    const left = 4, right = rect.width - 60, top = 15, bottom = rect.height - 32;
    const step = (right - left) / Math.max(20, bars.length);
    const x = index => left + (index + .5) * step;
    const y = value => bottom - (value - low) / (high - low) * (bottom - top);
    const time = at => new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
    ctx.font = '10px Consolas, monospace'; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const value = low + (high - low) * i / 4, height = y(value);
      ctx.strokeStyle = '#d7dce0'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(left, height); ctx.lineTo(right, height); ctx.stroke();
      ctx.fillStyle = '#697580'; ctx.fillText(value.toFixed(2), right + 7, height + 3);
    }
    ctx.setLineDash([]);
    bars.forEach((bar, i) => {
      const color = bar.close >= bar.open ? '#23764f' : '#ae343b';
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x(i), y(bar.high)); ctx.lineTo(x(i), y(bar.low)); ctx.stroke();
      ctx.fillRect(x(i) - step * .3, Math.min(y(bar.open), y(bar.close)), Math.max(2, step * .6), Math.max(1, Math.abs(y(bar.open) - y(bar.close))));
    });
    for (const news of market.news_history || []) {
      const index = bars.findIndex(bar => news.at >= bar.at && news.at < bar.at + seconds * 1000);
      if (index < 0) continue;
      ctx.fillStyle = news.change_bps >= 0 ? '#23764f' : '#ae343b';
      ctx.beginPath(); ctx.arc(x(index), bottom + 7, news.tier === 'quake' ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#7d8792'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(left, y(market.price)); ctx.lineTo(right, y(market.price)); ctx.stroke();
    ctx.fillStyle = '#343b4b'; ctx.fillRect(right + 2, y(market.price) - 7, 58, 15);
    ctx.fillStyle = '#fff'; ctx.fillText(market.price.toFixed(2), right + 7, y(market.price) + 4);
    const index = pointerX === null ? bars.length - 1 : Math.max(0, Math.min(bars.length - 1, Math.floor((pointerX - left) / step)));
    const selected = bars[index];
    if (pointerX !== null) {
      ctx.strokeStyle = '#737b86'; ctx.beginPath(); ctx.moveTo(x(index), top); ctx.lineTo(x(index), bottom); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.fillStyle = '#697580'; ctx.fillText(time(bars[0].at), left, rect.height - 6);
    if (bars.length > 8) { ctx.textAlign = 'right'; ctx.fillText(time(bars.at(-1).at), x(bars.length - 1), rect.height - 6); }
    canvas.setAttribute('aria-label', `${seconds} 秒蜡烛图，${bars.length} 根，最低 ${min.toFixed(4)}，最高 ${max.toFixed(4)}，最新 ${market.price.toFixed(4)}`);
    return { ...selected, current: index === bars.length - 1 };
  }
  if (typeof module !== 'undefined') module.exports = { aggregate, series };
  else window.FXChart = { aggregate, series, draw };
})();
