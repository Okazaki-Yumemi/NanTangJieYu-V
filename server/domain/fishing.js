'use strict';

const { randomInt, randomBytes } = require('node:crypto');
const amounts=require('../../web/public/fishing-amounts');
const { newId } = require('../auth');
const { validateDisplayName } = require('./players');
const game = require('../../web/public/fishing-game');
// 现场试玩可临时取消冷却；不改动已保存的冷却记录。
const COOLDOWN_MS = process.env.FISHING_NO_COOLDOWN === '1' ? 0 : 30 * 1000;
const NAMING_MIN_CM = 100;
const JACKPOT_TEST_MODE = process.env.FISHING_JACKPOT_TEST === '1';
const GEAR_COSTS = [200,600,1500,3500,8000];
const GEAR = [
  {id:'rod',name:'鱼竿',effect:'绿条宽度',description:'每级扩大绿条 1.5 个百分点。'},
  {id:'reel',name:'卷线器',effect:'收杆速度',description:'每级额外增加每秒 0.6% 的收杆进度。'},
  {id:'line',name:'鱼线',effect:'脱钩保护',description:'每级减少 8% 的脱钩进度损失。'},
  {id:'bait',name:'鱼饵配方',effect:'大鱼鱼情',description:'永久改良配方，每竿更容易遇到大鱼。'}
];
const FISH = [
  { id: 'bitterling', name: '鳑鲏', rarity: '常见', weight: 180, min: 12, max: 35, difficulty: .2, color: '#c9be8e' },
  { id: 'crucian', name: '鲫鱼', rarity: '常见', weight: 220, min: 20, max: 75, difficulty: .3, color: '#a7bec0' },
  { id: 'carp', name: '鲤鱼', rarity: '少见', weight: 320, min: 45, max: 160, difficulty: .43, color: '#d7a16c' },
  { id: 'catfish', name: '夜行鲶鱼', rarity: '稀有', weight: 200, min: 90, max: 280, difficulty: .58, color: '#8c9baa' },
  { id: 'moon', name: '月下银鲤', rarity: '珍奇', weight: 74, min: 250, max: 1200, difficulty: .73, color: '#d9d6ae' },
  { id: 'tractor', name: '湖底拖拉机鱼', rarity: '离谱', weight: 5, min: 5000, max: 18000, difficulty: .86, color: '#a8b581' },
  { id: 'leviathan', name: '叠界巨鱼', rarity: '传说', weight: 1, min: 25000, max: 50000, difficulty: .96, color: '#bb9dcd' }
];
function data(state) {
  state.fishing ||= { players: {} };
  state.fishing.players ||= {};
  return state.fishing;
}
function record(state, userId) { return state.fishing?.players?.[userId] || null; }
function economy(item = {}) {
  // 旧版本未累计长度，只能从仍留存的鱼篓与纪录补发；同一钓获按 id 去重。
  const retained = new Map([...(item.history || []),item.best,item.last_catch].filter(Boolean).map(fish=>[fish.id,fish]));
  const legacyTotal=[...retained.values()].reduce((sum,fish)=>amounts.add(sum,fish.length_cm),0);
  const total=item.total_cm!==undefined?amounts.serialize(item.total_cm):legacyTotal;
  const wallet=item.wallet_cm!==undefined?amounts.serialize(item.wallet_cm):total;
  const gear=Object.fromEntries(GEAR.map(({id})=>[id,Math.max(0,Math.min(5,Math.floor(Number(item.gear?.[id]) || 0)))]));
  return {total_cm:total,wallet_cm:wallet,gear};
}
function account(state,userId) {
  const item=data(state).players[userId] ||= {catches:0};
  Object.assign(item,economy(item));
  return item;
}
function fishWeights(gear = {}, jackpot = false) {
  if (jackpot) {
    const weights={leviathan:500,tractor:300,moon:200};
    return FISH.map(fish=>({...fish,weight:weights[fish.id] || 0}));
  }
  const level=Math.max(0,Math.min(5,Math.floor(gear.bait || 0)));
  const boost={carp:12,catfish:22,moon:28,tractor:18,leviathan:8};
  return FISH.map(fish=>({...fish,weight:level?fish.weight*(boost[fish.id]?100+level*boost[fish.id]:100-level*9):fish.weight}));
}
function bigFishChance(gear, jackpot = false) {
  const pool=fishWeights(gear,jackpot);const total=pool.reduce((sum,fish)=>sum+fish.weight,0);
  return pool.reduce((sum,fish)=>sum+fish.weight/total*Math.max(0,fish.max-Math.max(fish.min,NAMING_MIN_CM)+1)/(fish.max-fish.min+1),0);
}
function shopView(gear) {
  return GEAR.map(item=>({...item,level:gear[item.id],max_level:5,next_cost_cm:GEAR_COSTS[gear[item.id]] || null,
    next_big_fish_chance:item.id==='bait' && gear.bait<5?bigFishChance({...gear,bait:gear.bait+1}):null}));
}
function leaderboard(state) {
  return Object.entries(state.fishing?.players || {})
    .filter(([id, value]) => value.best && state.users[id] && !state.users[id].banned)
    .map(([id, value]) => ({ ...value.best, user_id: id, display_name: state.users[id].display_name, catches: value.catches }))
    .sort((a,b) => amounts.compare(b.length_cm,a.length_cm) || a.caught_at - b.caught_at || a.user_id.localeCompare(b.user_id))
    .slice(0,30).map((row,index) => ({ ...row, rank:index+1 }));
}
function view(state, user, now = Date.now()) {
  const item = user ? record(state,user.id) : null;
  const funds=economy(item || {});
  const jackpot=JACKPOT_TEST_MODE && Boolean(user?.fishing_test_account);
  return {
    logged_in: Boolean(user), banned: Boolean(user?.banned),
    display_name: user?.display_name || '',
    cooldown_sec: COOLDOWN_MS ? Math.max(0,Math.ceil(((item?.next_cast_at || 0)-now)/1000)) : 0,
    next_cast_at: COOLDOWN_MS ? (item?.next_cast_at || 0) : 0,
    cooldown_enabled: COOLDOWN_MS > 0,
    cooldown_interval_sec: COOLDOWN_MS/1000,
    server_time: now, best: item?.best || null, last_catch: item?.last_catch || null,
    catches: item?.catches || 0, rows: leaderboard(state),
    naming_min_cm: NAMING_MIN_CM, history: item?.history || [],
    ...funds, shop:shopView(funds.gear),big_fish_chance:bigFishChance(funds.gear,jackpot),jackpot_test_mode:jackpot,
    extreme_limit_cm:extremeLimit(state)
  };
}
function cast(state, user, now = Date.now(), pick = randomInt, rhythm = false) {
  if (user.banned) return {error:'FORBIDDEN',message:'该账号已被封禁。'};
  const existing = record(state,user.id);
  if (COOLDOWN_MS && existing && existing.next_cast_at > now) return {error:'FISHING_COOLDOWN',message:'鱼还没回来，再等一会儿。',retry_in_sec:Math.ceil((existing.next_cast_at-now)/1000)};
  const item=account(state,user.id);
  const pool=fishWeights(item.gear,JACKPOT_TEST_MODE && Boolean(user.fishing_test_account));
  let roll = pick(pool.reduce((sum,fish)=>sum+fish.weight,0));
  const fish = pool.find(item => {roll-=item.weight;return roll<0;});
  const limit=fish.id==='leviathan'?extremeLimit(state):fish.max;
  const recordLength=leaderboard(state)[0]?.length_cm || 0;
  const minimum=fish.id==='leviathan'?(amounts.compare(recordLength,25000)>=0?amounts.add(recordLength,1):25000):fish.min;
  const length = randomLength(minimum,limit,pick);
  const difficulty = Math.min(.99,fish.difficulty + pick(0,61)/1000);
  const attempt = {id:newId('cast'),seed:pick(1,1000000),difficulty,rhythm,gear:{...item.gear},fish_id:fish.id,length_cm:length,created_at:now,expires_at:now+90000,result:null};
  item.next_cast_at=now+COOLDOWN_MS;item.attempt=attempt;
  return {ok:true,challenge:{id:attempt.id,seed:attempt.seed,difficulty,rhythm,gear:attempt.gear,expires_at:attempt.expires_at},next_cast_at:now+COOLDOWN_MS,server_time:now};
}
function finish(state, user, payload, now = Date.now()) {
  if (user.banned) return {error:'FORBIDDEN',message:'该账号已被封禁。'};
  const item = record(state,user.id);
  const attempt = item?.attempt;
  if (!attempt || attempt.id !== payload.id) return {error:'BAD_REQUEST',message:'这次抛竿不存在，请重新查看状态。'};
  if (attempt.result) return {ok:true,result:attempt.result,duplicate:true};
  if (now > attempt.expires_at) return {error:'BAD_REQUEST',message:'这次抛竿已结束。'};
  const replay = game.replay(attempt,payload.controls,payload.ticks);
  if (!replay || replay.status === 'playing' || payload.ticks*game.DT*1000 > now-attempt.created_at+1200) return {error:'BAD_REQUEST',message:'钓鱼记录未能通过校验，请重试提交。'};
  if (replay.status === 'caught') {
    account(state,user.id);
    const fish = FISH.find(value=>value.id===attempt.fish_id);
    const catchRecord={id:attempt.id,fish_id:fish.id,name:fish.name,rarity:fish.rarity,color:fish.color,length_cm:attempt.length_cm,difficulty:attempt.difficulty,caught_at:now};
    item.catches+=1;
    item.total_cm=amounts.add(item.total_cm,catchRecord.length_cm);
    item.wallet_cm=amounts.add(item.wallet_cm,catchRecord.length_cm);
    item.last_catch=catchRecord;
    item.history=[...(item.history || []),catchRecord].slice(-20);
    if (!item.best || amounts.compare(catchRecord.length_cm,item.best.length_cm)>0) item.best=catchRecord;
    attempt.result={caught:true,fish:catchRecord};
  } else attempt.result={caught:false};
  return {ok:true,result:attempt.result};
}
function upgrade(state,user,payload) {
  if(user.banned)return {error:'FORBIDDEN',message:'该账号已被封禁。'};
  const spec=GEAR.find(item=>item.id===payload.gear_id);
  if(!spec)return {error:'BAD_REQUEST',message:'没有这件装备。'};
  const item=account(state,user.id);
  const level=item.gear[spec.id];
  // 客户端提交当前等级，阻止双击、重试或另一页面把装备意外连升两级。
  if(payload.expected_level!==level)return {error:'BAD_REQUEST',message:'装备等级已经变化，请刷新商店。'};
  if(level>=GEAR_COSTS.length)return {error:'BAD_REQUEST',message:'这件装备已经满级。'};
  const price=GEAR_COSTS[level];
  if(amounts.compare(item.wallet_cm,price)<0)return {error:'BAD_REQUEST',message:'米数还不够，再钓几条。'};
  item.wallet_cm=amounts.subtract(item.wallet_cm,price);item.gear[spec.id]+=1;
  return {ok:true,gear_id:spec.id,level:item.gear[spec.id],spent_cm:price,wallet_cm:item.wallet_cm};
}
function nameFish(state,user,payload,seeds) {
  if(user.banned)return {error:'FORBIDDEN',message:'该账号已被封禁。'};
  const item=record(state,user.id);
  const copies=[...(item?.history || []),item?.best,item?.last_catch,item?.attempt?.result?.fish].filter(fish=>fish && fish.id===payload.id);
  if(!copies.length)return {error:'BAD_REQUEST',message:'没有找到你的这条鱼。'};
  if(amounts.compare(copies[0].length_cm,NAMING_MIN_CM)<0)return {error:'BAD_REQUEST',message:'满 1 米的鱼才能命名。'};
  if(typeof payload.name!=='string')return {error:'BAD_REQUEST',message:'请输入鱼名。'};
  const check=validateDisplayName(payload.name,seeds.activity,seeds.sensitiveWords);
  if(check.error)return {error:'BAD_REQUEST',message:check.error.replaceAll('昵称','鱼名')};
  copies.forEach(fish=>{fish.custom_name=check.displayName;});
  return {ok:true,fish:copies[0]};
}
function extremeLimit(state) {
  const best=amounts.integer(leaderboard(state)[0]?.length_cm || 0);
  return amounts.serialize(best*2n>50000n?best*2n:50000n);
}
function randomLength(min,max,pick=randomInt) {
  const low=amounts.integer(min),high=amounts.integer(max),span=high-low+1n;
  if(high<BigInt(Number.MAX_SAFE_INTEGER) && span<281474976710656n)return pick(Number(low),Number(high)+1);
  const bits=span.toString(2).length,bytes=Math.ceil(bits/8),mask=(1n<<BigInt(bits))-1n;
  let roll;
  do {roll=BigInt('0x'+randomBytes(bytes).toString('hex'))&mask;} while(roll>=span);
  return amounts.serialize(low+roll);
}
module.exports={COOLDOWN_MS,NAMING_MIN_CM,FISH,GEAR,GEAR_COSTS,fishWeights,bigFishChance,economy,cast,finish,nameFish,upgrade,view,leaderboard,extremeLimit,randomLength};
