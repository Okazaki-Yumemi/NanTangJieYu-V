'use strict';

const DEFAULT_PAIR = 'kappa_human';
const CURRENCIES = Object.freeze([
  { id: 'kappa', name: '河童货币', initial: 100, beta: 1, volatility: 1, description: '工业与黄瓜贸易，跟随市场情绪，波动较大。' },
  { id: 'moon', name: '月都圆', initial: 180, beta: -0.45, volatility: 0.65, description: '偏避险，常与河童货币反向，但并非固定对冲。' },
  { id: 'tengu', name: '天狗券', initial: 60, beta: 0.7, volatility: 1.3, description: '传媒与消息驱动，波动较大，对新闻敏感。' },
  { id: 'nether', name: '冥界冥钞', initial: 35, beta: 0.2, volatility: 0.5, description: '与其他市场联动较弱，日常波动相对温和。' },
]);
const PAIRS = Object.freeze([
  ...CURRENCIES.map(currency => ({ id: `${currency.id}_human`, base: currency.id, quote: 'human', base_name: currency.name, quote_name: '人里元', name: `${currency.name} / 人里元`, precision: 4, description: currency.description })),
  { id: 'kappa_moon', base: 'kappa', quote: 'moon', base_name: '河童货币', quote_name: '月都圆', name: '河童货币 / 月都圆', precision: 6, description: '交叉盘：由河童货币与月都圆兑人里元的汇率相除得到，两边变化共同影响盈亏。' },
]);
const pair = id => PAIRS.find(item => item.id === id);
const currency = id => CURRENCIES.find(item => item.id === id);
const marketFor = (market, id = DEFAULT_PAIR) => id === DEFAULT_PAIR ? market : market?.pairs?.[id];
const round = (price, digits = 4) => Math.round(price * 10 ** digits) / 10 ** digits;
// 其他货币受较弱的共同风险偏好传导；月都圆通常与风险货币反向。
const exposure = (currencyId, eventCurrency = 'kappa') => currencyId === eventCurrency ? 1 : currency(currencyId).beta * currency(eventCurrency).beta * 0.2;
module.exports = { DEFAULT_PAIR, CURRENCIES, PAIRS, pair, currency, marketFor, round, exposure };
