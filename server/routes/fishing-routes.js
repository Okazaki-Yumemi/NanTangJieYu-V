'use strict';

const { SESSION_COOKIE } = require('../../shared/constants');
const { sendJson, collectBody, getCookie } = require('../http-utils');
const players = require('../domain/players');
const fishing = require('../domain/fishing');
const { sendPersistenceError } = require('./player-routes');

function registerRoutes(router, appCtx) {
  const { store } = appCtx;
  router.get('/api/player/fishing/state', async (req,res) => {
    const state=store.getLatest();
    const user=players.getSessionUser(state,getCookie(req,SESSION_COOKIE));
    sendJson(res,200,fishing.view(state,user));
  });
  router.get('/api/fishing/leaderboard', async (req,res) => {
    sendJson(res,200,{rows:fishing.leaderboard(store.getLatest())});
  });
  for (const [path,action] of [['cast',fishing.cast],['finish',fishing.finish],['name',fishing.nameFish]]) {
    router.post(`/api/player/fishing/${path}`,async(req,res)=>{
      let body;
      try { body=await collectBody(req); }
      catch {sendJson(res,400,{error:'BAD_REQUEST',message:'请求格式错误。'});return;}
      if (!body || typeof body !== 'object' || Array.isArray(body)) {sendJson(res,400,{error:'BAD_REQUEST',message:'请求格式错误。'});return;}
      try {
        const result=await store.transact(state=>{
          const sessionId=getCookie(req,SESSION_COOKIE);
          const user=players.getSessionUser(state,sessionId);
          if(!user)return store.abort({error:'USER_NOT_FOUND',message:'请先登录再来钓鱼。'});
          const outcome=path==='cast'?action(state,user):path==='name'?action(state,user,body,appCtx.seeds):action(state,user,body);
          if(outcome.error)return store.abort(outcome);
          state.sessions[sessionId].last_seen_at=Math.floor(Date.now()/1000);
          return outcome;
        });
        const status=result.error?(result.error==='USER_NOT_FOUND'?401:result.error==='FORBIDDEN'?403:result.error==='FISHING_COOLDOWN'?429:400):200;
        sendJson(res,status,result);
      } catch(error) {sendPersistenceError(res,error);}
    });
  }
}
module.exports={registerRoutes};
