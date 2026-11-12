'use strict';

// 只有服务器成交、结算和计时结果能推进成就；称号不发钱、不加权。
const CATALOG = Object.freeze([
  { id: 'debut', title: '见习汇民', description: '完成第一笔开仓', stat: 'opened', target: 1 },
  { id: 'two-sides', title: '左右逢源', description: '分别做多、做空至少一次', stat: 'directions', target: 2 },
  { id: 'first-win', title: '开门红', description: '一笔平仓扣除开仓费后盈利', stat: 'wins', target: 1 },
  { id: 'streak', title: '三连红', description: '连续三笔结算盈利', stat: 'best_streak', target: 3 },
  { id: 'regular', title: '交易所钉子户', description: '累计开仓 25 笔', stat: 'opened', target: 25 },
  { id: 'margin-call', title: '天台有风', description: '经历一次强平', stat: 'liquidations', target: 1 },
  { id: 'quake-survivor', title: '地震幸存者', description: '经历金融地震后仍有持仓', stat: 'quakes_survived', target: 1 },
  { id: 'news-reader', title: '文文特派员', description: '持仓经历 6 条不同的新闻', stat: 'news_count', target: 6 },
  { id: 'worker', title: '河童厂友', description: '完成并领取一次工钱', stat: 'jobs', target: 1 },
  { id: 'foreman', title: '螺丝仙人', description: '累计完成 10 次工作', stat: 'jobs', target: 10 },
  { id: 'debt-free', title: '欠条毕业生', description: '清偿全部贷款一次', stat: 'loans_cleared', target: 1 },
  { id: 'nest-egg', title: '第一桶金', description: '扣除负债后净资产达到 ¥20,000', stat: 'peak_equity', target: 2000000 },
  { id: 'tycoon', title: '人里大户', description: '扣除负债后净资产达到 ¥100,000', stat: 'peak_equity', target: 10000000 },
  { id: 'partner', title: '天弓合伙人', description: '扣除负债后净资产达到 ¥1,000,000', stat: 'peak_equity', target: 100000000 },
]);
function normalize(account) {
  if (!account.profile) {
    const history = account.history || [], positions = account.positions || [];
    account.profile = { stats: {
      opened: history.length + positions.length,
      wins: history.filter(item => item.net_pnl > 0).length,
      losses: history.filter(item => item.net_pnl < 0).length,
      liquidations: history.filter(item => item.reason === 'liquidation').length,
      realized_pnl: history.reduce((sum, item) => sum + (item.net_pnl || 0), 0),
      long: [...history, ...positions].some(item => item.side === 'long') ? 1 : 0,
      short: [...history, ...positions].some(item => item.side === 'short') ? 1 : 0,
      streak: 0, best_streak: 0, jobs: 0, work_earned: 0, loans_cleared: 0, quakes_survived: 0, peak_equity: 0,
    }, unlocked: {}, news_seen: [], title: null };
  }
  return account.profile;
}
function opened(account, side) {
  const { stats } = normalize(account);
  stats.opened++; stats[side]++;
}
function closed(account, pnl, reason) {
  const { stats } = normalize(account);
  stats.realized_pnl += pnl;
  if (pnl > 0) { stats.wins++; stats.streak++; } else { if (pnl < 0) stats.losses++; stats.streak = 0; }
  stats.best_streak = Math.max(stats.best_streak, stats.streak);
  if (reason === 'liquidation') stats.liquidations++;
}
function witnessed(account, event, survived) {
  const profile = normalize(account);
  if (!profile.news_seen.includes(event.id)) profile.news_seen.push(event.id);
  if (event.tier === 'quake' && survived) profile.stats.quakes_survived++;
}
function check(account, equity, now) {
  const profile = normalize(account), stats = profile.stats;
  stats.peak_equity = Math.max(stats.peak_equity, equity);
  stats.directions = Number(stats.long > 0) + Number(stats.short > 0);
  stats.news_count = profile.news_seen.length;
  for (const achievement of CATALOG) {
    if (stats[achievement.stat] >= achievement.target && !Object.hasOwn(profile.unlocked, achievement.id)) profile.unlocked[achievement.id] = now;
  }
}
function title(account) {
  return CATALOG.find(item => item.id === account.profile?.title && Object.hasOwn(account.profile.unlocked, item.id))?.title || '未挂名交易员';
}
function view(account) {
  const profile = account.profile;
  if (!profile) return null;
  return { stats: profile.stats, unlocked: profile.unlocked, title_id: profile.title, title: title(account) };
}
module.exports = { CATALOG, normalize, opened, closed, witnessed, check, title, view };
