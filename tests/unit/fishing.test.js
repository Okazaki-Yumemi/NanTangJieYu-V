'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fishing = require('../../server/domain/fishing');
const game = require('../../web/public/fishing-game');
const { execFileSync } = require('node:child_process');
const { createFixture } = require('../helpers/fixture');

test('jackpot test pool has 50 percent giant fish and does not change the normal pool',()=>{
  const pool=fishing.fishWeights({bait:5},true);
  const total=pool.reduce((sum,fish)=>sum+fish.weight,0);
  assert.equal(pool.find(fish=>fish.id==='leviathan').weight/total,.5);
  assert.equal(pool.find(fish=>fish.id==='tractor').weight/total,.3);
  assert.equal(pool.find(fish=>fish.id==='moon').weight/total,.2);
  assert.equal(fishing.fishWeights({bait:0}).find(fish=>fish.id==='leviathan').weight,1);
});

test('preview mode bypasses stored cooldowns and allows consecutive casts',()=>{
  const output=execFileSync(process.execPath,['-e',`
    const fishing=require('./server/domain/fishing');
    const user={id:'preview'};
    const state={users:{preview:user},fishing:{players:{preview:{next_cast_at:Date.now()+300000}}}};
    const first=fishing.cast(state,user);
    const second=fishing.cast(state,user);
    const view=fishing.view(state,user);
    process.stdout.write(JSON.stringify({first:!!first.challenge,second:!!second.challenge,cooldown:view.cooldown_sec,enabled:view.cooldown_enabled}));
  `],{cwd:require('node:path').resolve(__dirname,'../..'),env:{...process.env,FISHING_NO_COOLDOWN:'1'},encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),{first:true,second:true,cooldown:0,enabled:false});
});

function play(config) {
  const state=game.createGame(config);
  const controls=[];
  let last=false;
  while(state.status==='playing') {
    // 提前考虑惯性，代表一个可复现的跟鱼控制策略。
    const target=game.fishPosition(state.tick+5,config);
    const held=state.y+state.velocity*.13>target;
    if(held!==last) {controls.push({tick:state.tick,held});last=held;}
    game.step(state,held,config);
  }
  return {state,controls};
}

test('shared fishing simulation can be replayed exactly and is playable across difficulties',()=>{
  for(const difficulty of [.22,.48,.78,.99]) {
    const config={seed:12345,difficulty};
    const {state,controls}=play(config);
    assert.equal(state.status,'caught',`difficulty ${difficulty}`);
    assert.deepEqual(game.replay(config,controls,state.tick),state);
  }
});

test('harder fish have smaller green zones, shared by drawing and hit detection',()=>{
  assert.ok(game.zoneSize({difficulty:.2})>=.30);
  assert.ok(game.zoneSize({difficulty:.73})<.21);
  assert.ok(game.zoneSize({difficulty:.99})<.15);
  assert.ok(game.zoneSize({difficulty:.2})>game.zoneSize({difficulty:.5}));
  assert.ok(game.zoneSize({difficulty:.5})>game.zoneSize({difficulty:.99}));
});

test('cast cooldown survives serialization and never consumes activity energy',()=>{
  const f=createFixture({userCount:1});const user=f.registered[0];const now=1700000000000;
  const energy=user.energy;
  const result=fishing.cast(f.state,user,now);
  assert.ok(result.challenge);
  assert.equal(user.energy,energy);
  const restored=JSON.parse(JSON.stringify(f.state));
  assert.equal(fishing.cast(restored,user,now+29999).error,'FISHING_COOLDOWN');
  assert.ok(fishing.cast(restored,user,now+30000).challenge);
});

test('rarest roll produces a 500 metre fish with very high difficulty',()=>{
  const f=createFixture({userCount:1});
  const rolls=[999,50000,30,12345];
  const result=fishing.cast(f.state,f.registered[0],1700000000000,()=>rolls.shift());
  const attempt=f.state.fishing.players[f.registered[0].id].attempt;
  assert.equal(attempt.fish_id,'leviathan');
  assert.equal(attempt.length_cm,50000);
  assert.ok(result.challenge.difficulty>=.96);
});

test('roughly 44 percent of casts encounter nameable fish while giant fish stay rare',()=>{
  const total=fishing.FISH.reduce((sum,fish)=>sum+fish.weight,0);
  assert.equal(total,1000);
  const probability=fishing.FISH.reduce((sum,fish)=>{
    const eligible=Math.max(0,fish.max-Math.max(fish.min,fishing.NAMING_MIN_CM)+1);
    return sum+fish.weight/total*eligible/(fish.max-fish.min+1);
  },0);
  assert.ok(probability>.43 && probability<.45);
  assert.equal(fishing.FISH.find(fish=>fish.id==='leviathan').weight/total,.001);
});

test('only a valid completed replay creates one catch; duplicate submissions are idempotent',()=>{
  const f=createFixture({userCount:1});const user=f.registered[0];const now=1700000000000;
  const cast=fishing.cast(f.state,user,now,(min,max)=>max===undefined?0:min);
  const {state,controls}=play(cast.challenge);
  const payload={id:cast.challenge.id,ticks:state.tick,controls,length_cm:999999999};
  assert.equal(fishing.finish(f.state,user,payload,now).error,'BAD_REQUEST');
  assert.equal(fishing.finish(f.state,user,{...payload,id:'another-cast'},now+60000).error,'BAD_REQUEST');
  const result=fishing.finish(f.state,user,payload,now+state.tick*20+10);
  assert.equal(result.result.caught,true);
  assert.notEqual(result.result.fish.length_cm,payload.length_cm);
  assert.equal(fishing.finish(f.state,user,payload,now+60000).duplicate,true);
  assert.equal(fishing.view(f.state,user,now).catches,1);
  assert.equal(fishing.view(f.state,user,now).wallet_cm,result.result.fish.length_cm);
  assert.equal(fishing.view(f.state,user,now).total_cm,result.result.fish.length_cm);
  assert.equal(fishing.leaderboard(f.state).length,1);
});

test('equipment spends only wallet metres, checks expected level and preserves cast snapshots',()=>{
  const f=createFixture({userCount:1});const user=f.registered[0];const now=1700000000000;
  f.state.fishing.players[user.id]={wallet_cm:2000,total_cm:2000,gear:{rod:0,reel:0,line:0,bait:0},catches:0};
  const cast=fishing.cast(f.state,user,now);
  const bought=fishing.upgrade(f.state,user,{gear_id:'rod',expected_level:0,price_cm:0});
  assert.equal(bought.spent_cm,200);
  assert.equal(fishing.view(f.state,user,now).wallet_cm,1800);
  assert.equal(fishing.view(f.state,user,now).total_cm,2000);
  assert.equal(fishing.upgrade(f.state,user,{gear_id:'rod',expected_level:0}).error,'BAD_REQUEST');
  assert.equal(fishing.view(f.state,user,now).wallet_cm,1800);
  assert.equal(cast.challenge.gear.rod,0);
  assert.equal(f.state.fishing.players[user.id].attempt.gear.rod,0);
  assert.equal(fishing.cast(f.state,user,now+30000).challenge.gear.rod,1);
});

test('shop rejects unknown gear, insufficient metres, bans and levels above the cap',()=>{
  const f=createFixture({userCount:1});const user=f.registered[0];
  assert.equal(fishing.upgrade(f.state,user,{gear_id:'unknown',expected_level:0}).error,'BAD_REQUEST');
  assert.equal(fishing.upgrade(f.state,user,{gear_id:'rod',expected_level:0}).error,'BAD_REQUEST');
  const item=f.state.fishing.players[user.id];item.wallet_cm=100000;item.total_cm=100000;
  for(let level=0;level<5;level++)assert.equal(fishing.upgrade(f.state,user,{gear_id:'rod',expected_level:level}).level,level+1);
  const balance=item.wallet_cm;
  assert.equal(fishing.upgrade(f.state,user,{gear_id:'rod',expected_level:5}).error,'BAD_REQUEST');
  assert.equal(item.wallet_cm,balance);
  user.banned=true;
  assert.equal(fishing.upgrade(f.state,user,{gear_id:'bait',expected_level:0}).error,'FORBIDDEN');
});

test('old retained catches are credited once and survive serialization without double credit',()=>{
  const f=createFixture({userCount:1});const user=f.registered[0];
  const fish={id:'old-fish',length_cm:300};
  f.state.fishing.players[user.id]={history:[{...fish}],best:{...fish},last_catch:{...fish},catches:1};
  assert.equal(fishing.view(f.state,user).wallet_cm,300);
  fishing.upgrade(f.state,user,{gear_id:'rod',expected_level:0});
  const restored=JSON.parse(JSON.stringify(f.state));
  assert.equal(fishing.view(restored,user).wallet_cm,100);
  assert.equal(fishing.view(restored,user).total_cm,300);
});

test('rod widens the zone, reel fills faster, line reduces loss, bait increases big fish odds',()=>{
  const config={difficulty:.7,seed:12345};
  assert.ok(game.zoneSize({...config,gear:{rod:5}})>game.zoneSize(config));
  const base=game.createGame(config);base.tick=180;base.y=.5;base.fish=.5;
  const reel={...base};
  // 找到当前固定轨迹附近的可捕获位置，避免把控制惯性误当装备效果。
  base.y=game.fishPosition(181,config);reel.y=base.y;
  game.step(base,false,config);game.step(reel,false,{...config,gear:{reel:5}});
  assert.ok(reel.progress>base.progress);
  const outside=game.fishPosition(181,config)>.5?.1:.9;
  const loose={...game.createGame(config),tick:180,y:outside};const protectedLine={...loose};
  game.step(loose,false,config);game.step(protectedLine,false,{...config,gear:{line:5}});
  assert.ok(protectedLine.progress>loose.progress);
  let previous=fishing.bigFishChance({bait:0});
  for(let level=1;level<=5;level++){
    const chance=fishing.bigFishChance({bait:level});assert.ok(chance>previous);previous=chance;
  }
});

test('malformed, unfinished, expired and cross-player runs cannot enter the leaderboard',()=>{
  const f=createFixture({userCount:2});const [user,other]=f.registered;const now=1700000000000;
  const cast=fishing.cast(f.state,user,now);const payload={id:cast.challenge.id,ticks:1,controls:[]};
  assert.equal(fishing.finish(f.state,user,payload,now+100).error,'BAD_REQUEST');
  assert.equal(fishing.finish(f.state,other,payload,now+100).error,'BAD_REQUEST');
  assert.equal(fishing.finish(f.state,user,payload,now+90001).error,'BAD_REQUEST');
  assert.equal(game.replay(cast.challenge,[{tick:0,held:'yes'}],5),null);
  assert.equal(game.replay(cast.challenge,[{tick:0,held:true},{tick:0,held:false}],5),null);
  assert.equal(fishing.leaderboard(f.state).length,0);
});

test('leaderboard keeps one personal best per player and excludes banned users',()=>{
  const f=createFixture({userCount:2});const [first,second]=f.registered;
  f.state.fishing.players={
    [first.id]:{best:{length_cm:50000,caught_at:100},catches:3},
    [second.id]:{best:{length_cm:80,caught_at:90},catches:5}
  };
  assert.equal(fishing.leaderboard(f.state)[0].user_id,first.id);
  first.banned=true;
  assert.equal(fishing.leaderboard(f.state)[0].user_id,second.id);
});

test('fish naming shares nickname validation, checks ownership and updates every saved copy',()=>{
  const f=createFixture({userCount:2});const [user,other]=f.registered;
  const fish={id:'big-fish',length_cm:120,name:'鲤鱼',caught_at:100};
  f.state.fishing.players[user.id]={best:{...fish},last_catch:{...fish},history:[{...fish}],attempt:{result:{fish:{...fish}}}};
  assert.equal(fishing.nameFish(f.state,other,{id:fish.id,name:'大鱼'},f.seeds).error,'BAD_REQUEST');
  assert.equal(fishing.nameFish(f.state,user,{id:fish.id,name:'色 情'},f.seeds).error,'BAD_REQUEST');
  assert.equal(fishing.nameFish(f.state,user,{id:fish.id,name:'Ｎ Ｍ Ｓ Ｌ'},f.seeds).error,'BAD_REQUEST');
  assert.equal(fishing.nameFish(f.state,user,{id:fish.id,name:'x'.repeat(17)},f.seeds).error,'BAD_REQUEST');
  const result=fishing.nameFish(f.state,user,{id:fish.id,name:'  湖底巨物  '},f.seeds);
  assert.equal(result.fish.custom_name,'湖底巨物');
  const item=f.state.fishing.players[user.id];
  for(const saved of [item.best,item.last_catch,item.history[0],item.attempt.result.fish]) assert.equal(saved.custom_name,'湖底巨物');
  item.last_catch={id:'small',length_cm:99};
  assert.equal(fishing.nameFish(f.state,user,{id:'small',name:'小鱼'},f.seeds).error,'BAD_REQUEST');
});
