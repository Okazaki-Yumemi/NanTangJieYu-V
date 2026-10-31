'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fishing = require('../../server/domain/fishing');
const game = require('../../web/public/fishing-game');
const { execFileSync } = require('node:child_process');
const { createFixture } = require('../helpers/fixture');

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
    const target=game.fishPosition(state.tick+10,config);
    const held=state.y+state.velocity*.2>target;
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

test('cast cooldown survives serialization and never consumes activity energy',()=>{
  const f=createFixture({userCount:1});const user=f.registered[0];const now=1700000000000;
  const energy=user.energy;
  const result=fishing.cast(f.state,user,now);
  assert.ok(result.challenge);
  assert.equal(user.energy,energy);
  const restored=JSON.parse(JSON.stringify(f.state));
  assert.equal(fishing.cast(restored,user,now+299999).error,'FISHING_COOLDOWN');
  assert.ok(fishing.cast(restored,user,now+300000).challenge);
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
  assert.equal(fishing.leaderboard(f.state).length,1);
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
