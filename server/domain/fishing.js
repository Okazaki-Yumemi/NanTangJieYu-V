'use strict';

const { randomInt } = require('node:crypto');
const { newId } = require('../auth');
const { validateDisplayName } = require('./players');
const game = require('../../web/public/fishing-game');
const COOLDOWN_MS = 5 * 60 * 1000;
const NAMING_MIN_CM = 100;
const FISH = [
  { id: 'bitterling', name: '鳑鲏', rarity: '常见', weight: 380, min: 12, max: 35, difficulty: .2, color: '#c9be8e' },
  { id: 'crucian', name: '鲫鱼', rarity: '常见', weight: 300, min: 20, max: 75, difficulty: .3, color: '#a7bec0' },
  { id: 'carp', name: '鲤鱼', rarity: '少见', weight: 200, min: 45, max: 160, difficulty: .43, color: '#d7a16c' },
  { id: 'catfish', name: '夜行鲶鱼', rarity: '稀有', weight: 80, min: 90, max: 280, difficulty: .58, color: '#8c9baa' },
  { id: 'moon', name: '月下银鲤', rarity: '珍奇', weight: 34, min: 250, max: 1200, difficulty: .73, color: '#d9d6ae' },
  { id: 'tractor', name: '湖底拖拉机鱼', rarity: '离谱', weight: 5, min: 5000, max: 18000, difficulty: .86, color: '#a8b581' },
  { id: 'leviathan', name: '五百米的鱼', rarity: '传说', weight: 1, min: 50000, max: 50000, difficulty: .96, color: '#bb9dcd' }
];
function data(state) {
  state.fishing ||= { players: {} };
  state.fishing.players ||= {};
  return state.fishing;
}
function record(state, userId) { return state.fishing?.players?.[userId] || null; }
function leaderboard(state) {
  return Object.entries(state.fishing?.players || {})
    .filter(([id, value]) => value.best && state.users[id] && !state.users[id].banned)
    .map(([id, value]) => ({ ...value.best, user_id: id, display_name: state.users[id].display_name, catches: value.catches }))
    .sort((a,b) => b.length_cm - a.length_cm || a.caught_at - b.caught_at || a.user_id.localeCompare(b.user_id))
    .slice(0,30).map((row,index) => ({ ...row, rank:index+1 }));
}
function view(state, user, now = Date.now()) {
  const item = user ? record(state,user.id) : null;
  return {
    logged_in: Boolean(user), banned: Boolean(user?.banned),
    display_name: user?.display_name || '',
    cooldown_sec: Math.max(0,Math.ceil(((item?.next_cast_at || 0)-now)/1000)),
    next_cast_at: item?.next_cast_at || 0,
    server_time: now, best: item?.best || null, last_catch: item?.last_catch || null,
    catches: item?.catches || 0, rows: leaderboard(state),
    naming_min_cm: NAMING_MIN_CM, history: item?.history || []
  };
}
function cast(state, user, now = Date.now(), pick = randomInt) {
  if (user.banned) return {error:'FORBIDDEN',message:'该账号已被封禁。'};
  const existing = record(state,user.id);
  if (existing && existing.next_cast_at > now) return {error:'FISHING_COOLDOWN',message:'鱼还没回来，再等一会儿。',retry_in_sec:Math.ceil((existing.next_cast_at-now)/1000)};
  let roll = pick(1000);
  const fish = FISH.find(item => {roll-=item.weight;return roll<0;});
  const length = pick(fish.min,fish.max+1);
  const difficulty = Math.min(.99,fish.difficulty + pick(0,61)/1000);
  const attempt = {id:newId('cast'),seed:pick(1,1000000),difficulty,fish_id:fish.id,length_cm:length,created_at:now,expires_at:now+90000,result:null};
  data(state).players[user.id] = { ...existing, next_cast_at:now+COOLDOWN_MS, attempt, catches:existing?.catches || 0 };
  return {ok:true,challenge:{id:attempt.id,seed:attempt.seed,difficulty,expires_at:attempt.expires_at},next_cast_at:now+COOLDOWN_MS,server_time:now};
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
    const fish = FISH.find(value=>value.id===attempt.fish_id);
    const catchRecord={id:attempt.id,fish_id:fish.id,name:fish.name,rarity:fish.rarity,color:fish.color,length_cm:attempt.length_cm,difficulty:attempt.difficulty,caught_at:now};
    item.catches+=1;
    item.last_catch=catchRecord;
    item.history=[...(item.history || []),catchRecord].slice(-20);
    if (!item.best || catchRecord.length_cm>item.best.length_cm) item.best=catchRecord;
    attempt.result={caught:true,fish:catchRecord};
  } else attempt.result={caught:false};
  return {ok:true,result:attempt.result};
}
function nameFish(state,user,payload,seeds) {
  if(user.banned)return {error:'FORBIDDEN',message:'该账号已被封禁。'};
  const item=record(state,user.id);
  const copies=[...(item?.history || []),item?.best,item?.last_catch,item?.attempt?.result?.fish].filter(fish=>fish && fish.id===payload.id);
  if(!copies.length)return {error:'BAD_REQUEST',message:'没有找到你的这条鱼。'};
  if(copies[0].length_cm<NAMING_MIN_CM)return {error:'BAD_REQUEST',message:'满 1 米的鱼才能命名。'};
  if(typeof payload.name!=='string')return {error:'BAD_REQUEST',message:'请输入鱼名。'};
  const check=validateDisplayName(payload.name,seeds.activity,seeds.sensitiveWords);
  if(check.error)return {error:'BAD_REQUEST',message:check.error.replaceAll('昵称','鱼名')};
  copies.forEach(fish=>{fish.custom_name=check.displayName;});
  return {ok:true,fish:copies[0]};
}
module.exports={COOLDOWN_MS,NAMING_MIN_CM,FISH,cast,finish,nameFish,view,leaderboard};
