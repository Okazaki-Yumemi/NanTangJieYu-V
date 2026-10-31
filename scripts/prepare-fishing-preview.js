'use strict';

// 请先停止服务，避免两个进程同时写入同一存档。只创建新试玩账号，不重置已有账号。
const {bootScript}=require('./lib');
const {newToken}=require('../server/auth');
const codes=require('../server/domain/codes');
const players=require('../server/domain/players');

async function main(){
  const {seeds,store}=bootScript();await store.initialize();
  const displayName='满级钓鱼测试';const password=newToken(9);
  const result=await store.transact(state=>{
    if(players.findUserByDisplayName(state,displayName))return store.abort({error:'测试账号已存在，请勿重复创建。'});
    const now=Math.floor(Date.now()/1000);
    const generated=codes.generateCodes(state,{count:1,type:'ordinary',note:'fishing-equipment-test'},now);
    if(generated.error)return store.abort(generated);
    const team=Object.keys(state.teams).sort((a,b)=>state.teams[a].member_count-state.teams[b].member_count)[0];
    const registered=players.registerPlayer(state,{code:generated.created[0].code,display_name:displayName,password,team},{seeds},now);
    if(registered.error)return store.abort(registered);
    const user=registered.user;user.fishing_test_account=true;
    state.fishing.players[user.id]={catches:0,total_cm:0,wallet_cm:0,gear:{rod:5,reel:5,line:5,bait:5},next_cast_at:0};
    return {display_name:displayName,password};
  });
  if(result.error)throw new Error(result.message || result.error);
  process.stdout.write(JSON.stringify(result));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
