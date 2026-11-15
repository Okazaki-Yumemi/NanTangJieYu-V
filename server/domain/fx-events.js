'use strict';
const { currency, marketFor } = require('./fx-pairs');

// 事件权重与冲击都留在服务端。余震只增加随机振幅，不预告下一拍方向。
const TIERS = Object.freeze({
  rumor: { label: '小道消息', min_bps: 60, max_bps: 180, aftershock_ticks: 0, volatility: 0 },
  surge: { label: '市场异动', min_bps: 300, max_bps: 700, aftershock_ticks: 5, volatility: 0.0045 },
  quake: { label: '金融地震', min_bps: 800, max_bps: 1800, aftershock_ticks: 10, volatility: 0.012 },
});
const EVENT_CHANCE = 8; // 小新闻继续活跃；大事件另按运行中的行情拍数计时。
const COOLDOWN_TICKS = 10;
const MAJOR_EVENT_MIN_TICKS = 450; // 每拍 2 秒，15～30 分钟之间随机一次。
const MAJOR_EVENT_MAX_TICKS = 900;
const HISTORY_LIMIT = 12;
const CATALOG = [
  { id: 'cucumber-pay', tier: 'rumor', direction: 1, headline: '黄瓜摊拒收黄瓜', text: '荷取宣布黄瓜摊只收河童货币。河童们一边抗议，一边排队换钱。' },
  { id: 'reimu-box', tier: 'rumor', direction: -1, headline: '赛钱箱终于响了', text: '灵梦称箱中全是人里元。交易员认为这比任何经济报告都可靠。' },
  { id: 'cirno-math', tier: 'rumor', direction: 1, headline: '琪露诺算出九大于十', text: '河童会计集体放假，买盘却把错误答案理解成了利好。' },
  { id: 'aya-correction', tier: 'rumor', direction: -1, headline: '文文日报紧急勘误', text: '昨日“河童利润翻倍”实为“河童午饭翻倍”。市场要求退订。' },
  { id: 'marisa-broom', tier: 'rumor', direction: 1, headline: '魔理沙扫帚改用河童电池', text: '试飞只炸了三次。分析师称这是重大技术进步。' },
  { id: 'kappa-nap', tier: 'rumor', direction: -1, headline: '河童工厂午睡延长', text: '工会宣布午睡从两小时增加到三小时，订单交付日期开始自由漂移。' },
  { id: 'tewi-lucky', tier: 'rumor', direction: 1, headline: '帝出售必赚幸运贴纸', text: '贴纸背面写着“必赚的是卖贴纸的人”。购买者尚未翻面。' },
  { id: 'patchouli-sneeze', tier: 'rumor', direction: -1, headline: '帕秋莉打喷嚏引发误读', text: '交易员把“啊嚏”听成“抛弃”，河童货币卖单突然变多。' },
  { id: 'suwako-coins', tier: 'rumor', direction: 1, headline: '诹访子只接受硬币许愿', text: '指定河童货币，不找零。神社门口出现了临时换汇摊。' },
  { id: 'youmu-cut', tier: 'rumor', direction: -1, headline: '妖梦一刀砍掉预算', text: '她解释只是切菜时碰到了账本，市场已经先跌为敬。' },
  { id: 'nitori-buyback', tier: 'surge', direction: 1, headline: '十吨黄瓜变成十亿回购', text: '荷取输错采购单位，系统把黄瓜订单当成了货币回购。撤单按钮正在维修。' },
  { id: 'yuyuko-reserve', tier: 'surge', direction: -1, headline: '幽幽子吃光战略黄瓜储备', text: '河童央行赶到现场时，只剩一张写着“再来一盘”的纸条。' },
  { id: 'kanako-reactor', tier: 'surge', direction: 1, headline: '八坂神奈子宣布核聚变烧开水', text: '第一台设备成功煮熟一颗鸡蛋。河童技术股与河童货币一起起飞。' },
  { id: 'sakuya-overtime', tier: 'surge', direction: -1, headline: '咲夜暂停时间后申请加班费', text: '河童工厂收到八百年的工资单，财务部门当场停止呼吸。' },
  { id: 'remilia-prophecy', tier: 'surge', direction: 1, headline: '蕾米莉亚预言今晚全线涨停', text: '当记者追问依据时，大小姐指了指自己刚买的仓位。市场仍然跟了。' },
  { id: 'mystia-fund', tier: 'surge', direction: -1, headline: '夜雀理财产品兑付烤鳗鱼', text: '客户打开账户发现余额变成了宵夜券，交易所暂不接受葱花抵押。' },
  { id: 'eirin-pill', tier: 'surge', direction: 1, headline: '永琳研制后悔药，首批售罄', text: '药瓶注明“不撤销亏损，只让你忘记”。交易员服药后恢复了信心。' },
  { id: 'sanae-umbrella', tier: 'surge', direction: -1, headline: '早苗宣布降雨，河童却没带伞', text: '防水交易机集体进水。厂商称“防水”指防止水被浪费。' },
  { id: 'tenshi-quake', tier: 'quake', direction: -1, headline: '天子踩塌交易所地脉', text: '金融地震这次是真的地震。报价屏掉进地下三层，多头正在寻找安全出口。' },
  { id: 'yukari-debt', tier: 'quake', direction: 1, headline: '紫把全行业坏账扔进隙间', text: '河童央行宣布负债神秘消失。隙间另一端传来一声非常响亮的“谁干的”。' },
  { id: 'suika-printer', tier: 'quake', direction: -1, headline: '萃香把印钞机变成无限酒壶', text: '印出来的河童货币全是欠酒条。市场终于意识到酒精不能充当准备金。' },
  { id: 'chimata-buyout', tier: 'quake', direction: 1, headline: '千亦买下整座市场，忘了砍价', text: '收购款全部以河童货币支付。卖家还没反应过来，空头已经开始找临时工。' },
  { id: 'flandre-vault', tier: 'quake', direction: -1, headline: '芙兰问金库上的红点能不能捏', text: '采访提前结束。河童央行正在核对消失的金库、金库钥匙和金库本身的保险单。' },
  { id: 'koishi-shorts', tier: 'quake', direction: 1, headline: '恋恋无意识买光所有卖单', text: '她只是想点一份黄瓜沙拉。交易所宣布这是有记录以来最贵的一顿午饭。' },
  { id: 'kosuzu-manual', tier: 'rumor', direction: 1, source: '铃奈庵小报', headline: '小铃翻出失传交易秘籍，第一页写着别买', text: '第二页被虫吃了。读者坚信后面一定还有反转，纷纷买入等待续篇。' },
  { id: 'hatate-photo', tier: 'rumor', direction: -1, source: '花果子念报', headline: '姬海棠果拍到央行行长偷偷种土豆', text: '市场担忧黄瓜本位制动摇。行长解释只是想换个口味，解释被排在收费版。' },
  { id: 'kogasa-scare', tier: 'rumor', direction: -1, source: '人里茶馆传闻', headline: '小伞终于吓到人了，对方正在看账户', text: '交易员表示主要是数字吓人。小伞坚持把这次计入年度业绩。' },
  { id: 'nazrin-found', tier: 'rumor', direction: 1, source: '河童通讯社', headline: '娜兹玲在沙发缝里找到外汇储备', text: '数量足够买下三条商业街，以及那张终于可以扔掉的旧沙发。' },
  { id: 'seija-chart', tier: 'surge', direction: 1, source: '花果子念报', headline: '正邪倒挂报价屏，散户抄底抄到了天花板', text: '维修员把屏幕翻正后发现买单已经成交。交易所宣布尊重大家的倒立自由。' },
  { id: 'miko-guidance', tier: 'surge', direction: -1, source: '文文日报', headline: '神子同时听取一万条投资建议，选择全部拉黑', text: '顾问团失去唯一客户，紧急抛售河童货币支付场地租金。' },
  { id: 'byakuren-savings', tier: 'surge', direction: 1, source: '命莲寺晨钟', headline: '白莲发现复印机可以复印存单', text: '银行澄清复印件不能取款，但寺院意外接下了全城的打印业务。' },
  { id: 'reisen-receipt', tier: 'surge', direction: -1, source: '永远亭值班记录', headline: '铃仙把交易回执发到了月球，月面要求运费到付', text: '账单末尾有四十七个零。荷取询问能否走普通快递，暂未得到回复。' },
  { id: 'okina-backdoor', tier: 'quake', direction: 1, source: '河童通讯社', headline: '隐岐奈打开金库后门，里面是一整座金库', text: '新金库的后门后面还有金库。审计员已经走了六小时，报告仍只有“很多”两个字。' },
  { id: 'yuuma-audit', tier: 'quake', direction: -1, source: '花果子念报', headline: '尤魔把资产负债表吃了，只说负债有点塞牙', text: '河童央行宣布报表进入消化期。评级机构第一次给出“建议饭后再看”的评级。' },
  { id: 'hecatia-sale', tier: 'quake', direction: 1, source: '地狱购物频道', headline: '赫卡提亚三界联名T恤仅收河童货币', text: '三界同时开抢，库存只有两件。第三件穿在女神身上，正在考虑是否也挂链接。' },
  { id: 'doremy-dream', tier: 'quake', direction: -1, source: '梦境财经', headline: '哆来咪宣布昨夜的牛市只是集体午睡', text: '交易员醒来发现盈利没有了，加班记录却还在。梦境客服表示不支持七天无理由退款。' },
  { id: 'moon-delivery', currency: 'moon', tier: 'rumor', direction: 1, source: '月面经济公报', headline: '月兔快递宣布隔夜达，隔的是月球的夜', text: '客户要等两周，快递公司却提前收齐了月都圆。财务称这是天然的现金流优势。' },
  { id: 'kaguya-membership', currency: 'moon', tier: 'rumor', direction: -1, source: '永远亭值班记录', headline: '辉夜给全月球开通游戏会员，忘关自动续费', text: '永琳正在查找取消按钮。平台表示会员可享受九点八折的下一次续费。' },
  { id: 'moon-rate', currency: 'moon', tier: 'surge', direction: 1, source: '月面经济公报', headline: '月都央行提高存款奖励：利息可以兑年糕', text: '月兔储户挤满银行，经理表示年糕虽硬，信用更硬。月都圆需求突然增加。' },
  { id: 'moon-holiday', currency: 'moon', tier: 'surge', direction: -1, source: '月面经济公报', headline: '月兔宣布集体赏月，印钞厂找不到月亮', text: '罢工谈判卡在“月球上应该赏什么”的议题上。出口结算暂缓，客户开始退单。' },
  { id: 'moon-vault', currency: 'moon', tier: 'quake', direction: 1, source: '月面经济公报', headline: '探测器撞开月背仓库，里面全是遗忘的黄金', text: '管理员承认钥匙丢了两千年。月都宣布储备充足，并要求探测器赔偿大门。' },
  { id: 'junko-invoice', currency: 'moon', tier: 'quake', direction: -1, source: '文文日报', headline: '纯狐把月都财政预算净化成了一张白纸', text: '支出没了，收入也没了。月都财务部开始对着空白报表举行紧急会议。' },
  { id: 'aya-subscribe', currency: 'tengu', tier: 'rumor', direction: 1, source: '文文日报', headline: '文文日报销量翻倍：每份报纸被风吹回来卖两遍', text: '射命丸文称这是循环经济。广告商只看到漂亮的发行数字，继续用天狗券充值。' },
  { id: 'hatate-paywall', currency: 'tengu', tier: 'rumor', direction: -1, source: '花果子念报', headline: '姬海棠果把头条设为付费，忘了留下标题', text: '首页只剩“请先订阅”四个字。读者表示已经免费读完了全部内容。' },
  { id: 'tengu-exclusive', currency: 'tengu', tier: 'surge', direction: 1, source: '妖怪山通讯', headline: '天狗独家拍到明天的新闻，广告费提前结算', text: '编辑部称预知能力不稳定，但收款二维码非常稳定。客户争抢明日头版。' },
  { id: 'tengu-retraction', currency: 'tengu', tier: 'surge', direction: -1, source: '妖怪山通讯', headline: '全山报社同日刊登道歉，发现互相抄的是假新闻', text: '道歉稿又被互相转载，版税纠纷已经超过广告收入。天狗券遭到抛售。' },
  { id: 'tengu-network', currency: 'tengu', tier: 'quake', direction: 1, source: '妖怪山通讯', headline: '妖怪山完成全境通信，第一条消息是广告招租', text: '河童基站与天狗送报网连成一片。广告主连夜换汇，试图买下每一阵风。' },
  { id: 'tengu-blackout', currency: 'tengu', tier: 'quake', direction: -1, source: '人里茶馆传闻', headline: '大天狗宣布今天绝对没有新闻，报社全部停刊', text: '记者想报道这件事，被告知这也不算新闻。广告款集中退款，天狗券跌进瀑布。' },
  { id: 'nether-tour', currency: 'nether', tier: 'rumor', direction: 1, source: '白玉楼庭报', headline: '白玉楼赏樱开放夜场，游客排队兑换冥钞', text: '妖梦提醒门票不含往生服务。旅行社立即把这句话印成了宣传口号。' },
  { id: 'nether-buffet', currency: 'nether', tier: 'rumor', direction: -1, source: '白玉楼庭报', headline: '幽幽子报名自助餐，主办方紧急退回报名费', text: '冥界餐饮协会连夜下调盈利预期，保险公司表示这属于已知食欲。' },
  { id: 'nether-toll', currency: 'nether', tier: 'surge', direction: 1, source: '三途川船讯', headline: '小町终于准点开船，渡口收入创纪录', text: '乘客怀疑自己上错了船。财务证实收款正常，只是船夫今天忘记午睡。' },
  { id: 'nether-tax', currency: 'nether', tier: 'surge', direction: -1, source: '阎魔财税通告', headline: '映姬追缴三百年欠税，亡灵开始整理零钱', text: '账单比生前履历还长。冥界市场出现集中换汇支付税款的队伍。' },
  { id: 'nether-sakura', currency: 'nether', tier: 'quake', direction: 1, source: '白玉楼庭报', headline: '西行妖只开了一朵，门票预售卖到下个世纪', text: '妖梦强调这不代表全面开放。黄牛已经开始出售下个世纪的排队号码。' },
  { id: 'nether-budget', currency: 'nether', tier: 'quake', direction: -1, source: '三途川船讯', headline: '冥界国库批准无限饭票，幽幽子当场兑换', text: '财政官原以为无限只是宣传用语。厨师、会计和国库一起申请休假。' },
].map(event => ({ currency: 'kappa', ...event }));

function relativePrice(market, event) {
  const target = currency(event.currency || 'kappa');
  return (marketFor(market, `${target.id}_human`)?.price ?? target.initial) / target.initial * 100;
}

function normalizeMarket(market) {
  if (!Array.isArray(market.news_history)) market.news_history = [];
  market.news_history = market.news_history.filter(item => item && typeof item.headline === 'string' && Number.isFinite(item.at)).slice(0, HISTORY_LIMIT);
  if (!Number.isInteger(market.event_cooldown) || market.event_cooldown < 0) market.event_cooldown = 0;
  market.event_cooldown = Math.min(COOLDOWN_TICKS, market.event_cooldown);
  if (!Number.isInteger(market.major_event_ticks) || market.major_event_ticks < 0) market.major_event_ticks = null;
  else market.major_event_ticks = Math.min(MAJOR_EVENT_MAX_TICKS, market.major_event_ticks);
  const effect = market.event_effect;
  const tier = effect && Object.hasOwn(TIERS, effect.tier) ? TIERS[effect.tier] : null;
  if (!tier || !Number.isInteger(effect.remaining_ticks) || effect.remaining_ticks <= 0 || !tier.aftershock_ticks) market.event_effect = null;
  else {
    effect.remaining_ticks = Math.min(tier.aftershock_ticks, effect.remaining_ticks);
    effect.volatility = tier.volatility;
    if (!currency(effect.currency)) effect.currency = 'kappa';
  }
}

function nextEvent(market, pick) {
  if (market.major_event_ticks === null) {
    market.major_event_ticks = pick(MAJOR_EVENT_MIN_TICKS, MAJOR_EVENT_MAX_TICKS + 1);
  } else market.major_event_ticks = Math.max(0, market.major_event_ticks - 1);
  const majorDue = market.major_event_ticks === 0;
  if (market.event_cooldown > 0) {
    market.event_cooldown -= 1;
    if (!majorDue) return null;
  }
  // 大事件前留出安静窗口，普通新闻不延迟或重置大事件计时。
  if (!majorDue && (market.major_event_ticks <= COOLDOWN_TICKS || pick(0, 100) >= EVENT_CHANCE)) return null;
  const tierName = majorDue ? (pick(0, 100) < 75 ? 'surge' : 'quake') : 'rumor';
  const tier = TIERS[tierName];
  const recentIds = new Set(market.news_history.slice(0, 3).map(item => item.event_id));
  // 靠近价格上下界时选向区间内冲击的新闻，避免播报暴涨但价格被上界卡住。
  const pool = CATALOG.filter(item => item.tier === tierName &&
    (relativePrice(market, item) > 25 || item.direction > 0) && (relativePrice(market, item) < 420 || item.direction < 0));
  const fresh = pool.filter(item => !recentIds.has(item.id));
  const choices = fresh.length ? fresh : pool;
  const event = choices[pick(0, choices.length)];
  const shock_bps = event.direction * pick(tier.min_bps, tier.max_bps + 1);
  if (majorDue) market.major_event_ticks = pick(MAJOR_EVENT_MIN_TICKS, MAJOR_EVENT_MAX_TICKS + 1);
  market.event_cooldown = COOLDOWN_TICKS;
  market.event_effect = tier.aftershock_ticks ? {
    tier: tierName, currency: event.currency, headline: event.headline, remaining_ticks: tier.aftershock_ticks, volatility: tier.volatility,
  } : null;
  return { ...event, shock_bps };
}

module.exports = { TIERS, CATALOG, COOLDOWN_TICKS, MAJOR_EVENT_MIN_TICKS, MAJOR_EVENT_MAX_TICKS, HISTORY_LIMIT, normalizeMarket, nextEvent, relativePrice };
