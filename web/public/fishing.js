'use strict';

(function initFishing() {
  const $ = id => document.getElementById(id);
  const { api, escapeHtml: esc } = NTJ;
  const sprites={bitterling:'yellow',crucian:'blue',carp:'orange',catfish:'green',moon:'yellow',tractor:'green',leviathan:'red'};
  const sprite = fish => `/assets/fish/${sprites[fish.fish_id] || 'blue'}.png`;
  const length = cm => FishingAmounts.format(cm);
  const metres = cm => FishingAmounts.format(cm,true);
  const clock = sec => `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  let view=null;
  let serverOffset=0;
  let active=null;
  let casting=false;
  let selectedFish=null;
  let pending=null;
  let submitting=false;
  let buying=false;
  const anglers=[['reimu','博丽灵梦'],['marisa','雾雨魔理沙'],['aya','射命丸文'],['chen','橙'],['cirno','琪露诺'],['eirin','八意永琳'],['kaguya','蓬莱山辉夜'],['kanako','八坂神奈子'],['koishi','古明地恋'],['meiling','红美铃'],['mokou','藤原妹红'],['momiji','犬走椛'],['nitori','河城荷取'],['patchouli','帕秋莉'],['sanae','东风谷早苗'],['satori','古明地觉'],['suwako','洩矢诹访子'],['tewi','因幡帝'],['youmu','魂魄妖梦'],['yukari','八云紫'],['yuyuko','西行寺幽幽子']];
  function pickAngler() {
    let previous='';try{previous=sessionStorage.getItem('ntj-last-angler') || '';}catch{}
    const pool=anglers.filter(([id])=>id!==previous);
    const [id,name]=pool[Math.floor(Math.random()*pool.length)];
    const image=document.querySelector('.pond-angler');image.src=`/assets/characters/${id}.png`;image.alt=`湖边的${name}`;
    try{sessionStorage.setItem('ntj-last-angler',id);}catch{}
  }
  pickAngler();
  const pendingKey='ntj-fishing-pending';
  try { pending=JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { /* 浏览器禁用存储时仍可游玩。 */ }

  function renderButton() {
    const button=$('cast-button');
    $('practice-cast-button').disabled=Boolean(active || casting || buying || submitting);
    if(buying){button.disabled=true;button.textContent='正在升级装备…';return;}
    if(active || casting) {button.disabled=true;button.textContent=active?'鱼儿上钩了':'正在抛竿…';return;}
    if(pending) {button.disabled=submitting;button.textContent=submitting?'正在保存…':'重试保存钓获';return;}
    if(!view)return;
    if(!view.logged_in){button.disabled=true;button.textContent='登录后抛竿';return;}
    if(view.banned){button.disabled=true;button.textContent='暂时不能钓鱼';return;}
    const remaining=Math.max(0,Math.ceil((view.next_cast_at-Date.now()-serverOffset)/1000));
    button.disabled=remaining>0;
    button.textContent=remaining?`下次抛竿 ${clock(remaining)}`:'抛竿';
  }

  function renderRanks(rows) {
    $('fishing-ranks').innerHTML=rows.length?rows.map(row=>`<li><span>${row.rank}</span><img src="${sprite(row)}" alt="" /><div><span class="rank-name">${esc(row.custom_name || row.name)}</span><small>${esc(row.display_name)} · ${esc(row.name)}</small><strong>${length(row.length_cm)}</strong></div></li>`).join(''):'<li class="rank-empty">还没有人上榜。第一竿会是谁？</li>';
  }
  function showCatch(fish) {
    selectedFish=fish;
    $('catch-result').classList.remove('hidden');
    $('caught-sprite').src=sprite(fish);
    $('caught-rarity').textContent=fish.rarity;
    $('caught-name').textContent=fish.custom_name || fish.name;
    $('caught-length').textContent=length(fish.length_cm);
    $('caught-description').textContent=fish.length_cm>=50000?'这条鱼，校园的湖可能装不下。':fish.length_cm>=5000?'看着它，你开始怀疑手里这根竿。':fish.length_cm>=100?'是条大家伙。':'收进鱼篓了。';
    const eligible=fish.length_cm>=(view?.naming_min_cm || 100);
    $('fish-name-form').classList.toggle('hidden',!eligible);
    $('fish-nickname').value=fish.custom_name || '';
    $('fish-name-error').textContent='';
  }
  function renderHistory() {
    const history=[...(view.history || [])];
    if(view.best && !history.some(f=>f.id===view.best.id))history.unshift(view.best);
    const recent=history.reverse().slice(0,20);
    $('fish-history-list').innerHTML=recent.length?recent.map(fish=>`<button type="button" class="history-fish" data-fish="${esc(fish.id)}"><img src="${sprite(fish)}" alt="" /><span>${esc(fish.custom_name || fish.name)}</span><small>${length(fish.length_cm)}</small></button>`).join(''):'<p class="muted small">鱼篓还是空的。</p>';
    for(const button of $('fish-history-list').querySelectorAll('[data-fish]'))button.addEventListener('click',()=>showCatch(history.find(f=>f.id===button.dataset.fish)));
  }
  function renderShop() {
    $('fish-wallet').textContent=metres(view.wallet_cm || 0);
    $('fish-total').textContent=metres(view.total_cm || 0);
    $('shop-chance').textContent=view.jackpot_test_mode?'大奖鱼测试：叠界巨鱼 50% · 拖拉机鱼 30% · 银鲤 20%':`当前鱼饵：约 ${Math.round(view.big_fish_chance*100)}% 的抛竿会遇到满一米的鱼。`;
    $('fishing-shop').innerHTML=(view.shop || []).map(item=>{
      const max=item.level>=item.max_level;
      const unavailable=!view.logged_in || view.banned || active || casting || buying || max || FishingAmounts.compare(view.wallet_cm,item.next_cost_cm)<0;
      return `<article class="gear-card"><i class="gear-icon gear-${esc(item.id)}" aria-hidden="true"></i><div><h3>${esc(item.name)} <small>Lv.${item.level} / ${item.max_level}</small></h3><p>${esc(item.description)}${item.next_big_fish_chance ? ` 下一级约 ${Math.round(item.next_big_fish_chance*100)}% 遇到大鱼。` : ""}</p><div class="gear-levels" aria-hidden="true">${Array.from({length:item.max_level},(_,index)=>`<i class="${index<item.level?'on':''}"></i>`).join('')}</div></div><button type="button" data-gear="${esc(item.id)}" data-level="${item.level}" ${unavailable?'disabled':''}>${max?'已满级':`升级 · ${length(item.next_cost_cm)}`}</button></article>`;
    }).join('');
    for(const button of $('fishing-shop').querySelectorAll('[data-gear]'))button.addEventListener('click',async()=>{
      if(buying || active || casting)return;
      const gearId=button.dataset.gear;const level=Number(button.dataset.level);
      buying=true;renderShop();renderButton();
      try {
        const result=await api('POST','/api/player/fishing/upgrade',{gear_id:gearId,expected_level:level});
        $('shop-message').textContent=`升级完成，Lv.${result.level}。下一竿就能用。`;
      } catch(error){$('shop-message').textContent=error.message || '没买成功，请重试。';}
      finally{buying=false;await refresh();renderButton();}
    });
  }
  async function refresh() {
    if(active || casting || submitting || buying)return;
    try {
      view=await api('GET','/api/player/fishing/state');
      serverOffset=view.server_time-Date.now();
      $('fisher-name').textContent=view.display_name;
      $('extreme-fish-limit').textContent=`极端鱼当前上限：${length(view.extreme_limit_cm)}。随榜首纪录翻倍，没有光年封顶。`;
      $('fishing-rule').textContent=view.cooldown_enabled
        ? `不消耗能量 · 每 ${view.cooldown_interval_sec} 秒一竿。从抛竿开始计时。`
        : '不消耗能量 · 试玩期间无冷却，可以连续抛竿。';
      $('fishing-login').classList.toggle('hidden',view.logged_in);
      renderRanks(view.rows);renderHistory();renderShop();renderButton();
      if(!selectedFish && view.last_catch)showCatch(view.last_catch);
    } catch(error){$('fishing-message').textContent=error.message || '鱼情暂时没查到，请稍后重试。';}
  }
  function savePending() {try{if(pending)sessionStorage.setItem(pendingKey,JSON.stringify(pending));else sessionStorage.removeItem(pendingKey);}catch{}}
  async function submit() {
    if(!pending || submitting)return;
    submitting=true;renderButton();
    try {
      const response=await api('POST','/api/player/fishing/finish',pending);
      pending=null;savePending();
      if(response.result.caught){$('fishing-message').textContent=`钓上来了！米数 +${length(response.result.fish.length_cm)}`;showCatch(response.result.fish);}
      else $('fishing-message').textContent='鱼跑了。歇一会儿，待会儿再来。';
    } catch(error) {
      $('fishing-message').textContent=error.message || '没有保存成功，可以重试。';
      // 网络故障允许原样重试；过期或失效的记录不能阻塞下一次抛竿。
      if(error.error==='BAD_REQUEST' || error.error==='USER_NOT_FOUND' || error.error==='FORBIDDEN'){pending=null;savePending();}
    } finally{submitting=false;await refresh();renderButton();}
  }
  function stopGame() {
    if(!active)return;
    cancelAnimationFrame(active.frame);
    active=null;
    $('reel-button').classList.remove('held');
    $('fishing-overlay').classList.add('hidden');
  }
  function setHeld(held) {
    if(!active || active.held===held)return;
    active.held=held;
    const change={tick:active.state.tick,held};
    const last=active.controls[active.controls.length-1];
    if(last?.tick===change.tick)active.controls[active.controls.length-1]=change;
    else active.controls.push(change);
    $('reel-button').classList.toggle('held',held);
  }
  function startGame(challenge, practice = false) {
    active={challenge,state:FishingGame.createGame(challenge),controls:[],held:false,frame:0,last:performance.now(),accumulator:0};
    $('fishing-overlay').classList.remove('hidden');
    $('fish-temper').textContent=challenge.difficulty>.85?'鱼劲儿很大':challenge.difficulty>.55?'鱼很灵活':'鱼影轻快';
    $('catch-zone').style.height=`${FishingGame.zoneSize(challenge)*100}%`;
    const rhythm=$('reel-rhythm');
    const rhythmFill=rhythm.querySelector('i');
    const rhythmLabel=rhythm.querySelector('span');
    rhythm.classList.toggle('hidden',!challenge.rhythm);
    rhythm.classList.remove('charged');
    rhythmFill.style.width='0%';
    rhythmLabel.textContent='连稳 1.5 秒加速';
    let rhythmCharged=false;
    $('fishing-message').textContent=practice?'试钓 · 不计鱼获和冷却':'咬钩了！';
    document.querySelector('.pond-scene').scrollIntoView({ block:'center', behavior:'auto' });
    $('reel-button').focus({preventScroll:true});
    function frame(now) {
      if(!active)return;
      const run=active;
      const elapsed=Math.min(.1,(now-run.last)/1000);run.last=now;
      // 切到后台不累计进度，重新回来后继续；服务端抛竿有效期照常流逝。
      if(!document.hidden)run.accumulator+=elapsed;
      while(run.accumulator>=FishingGame.DT && run.state.status==='playing') {
        FishingGame.step(run.state,run.held,challenge);run.accumulator-=FishingGame.DT;
      }
      const state=run.state;
      $('catch-zone').style.top=`${state.y*100}%`;
      $('fish-shadow').style.top=`${state.fish*100}%`;
      $('catch-fill').style.height=`${state.progress*100}%`;
      if(challenge.rhythm) {
        const charge=state.trackingTicks/FishingGame.RHYTHM_TICKS;
        rhythmFill.style.width=`${charge*100}%`;
        const charged=charge===1;
        if(charged!==rhythmCharged) {
          rhythmCharged=charged;
          rhythm.classList.toggle('charged',charged);
          rhythmLabel.textContent=charged?'稳线加速 +35%':'连稳 1.5 秒加速';
        }
      }
      document.querySelector('.catch-meter').setAttribute('aria-valuenow',String(Math.round(state.progress*100)));
      if(!practice && Date.now()+serverOffset>challenge.expires_at){stopGame();$('fishing-message').textContent='这次抛竿结束了。';refresh();return;}
      if(state.status!=='playing') {
        if(practice) {
          stopGame();
          $('fishing-message').textContent=state.status==='caught'?'试钓成功！':'练习鱼溜走了，再甩一竿？';
          renderButton();if(view)renderShop();$('practice-cast-button').focus();
          return;
        }
        // 松手事件可能与最后一步同帧，不提交模拟结束后的无效输入。
        pending={id:challenge.id,ticks:state.tick,controls:run.controls.filter(input=>input.tick<state.tick)};
        savePending();stopGame();submit();return;
      }
      run.frame=requestAnimationFrame(frame);
    }
    active.frame=requestAnimationFrame(frame);if(view)renderShop();renderButton();
  }
  $('practice-cast-button').addEventListener('click',()=>{
    if(active || casting || buying || submitting)return;
    startGame({
      seed:Math.floor(Math.random()*999999)+1,
      difficulty:Number($('practice-difficulty').value),
      rhythm:true
    },true);
  });
  $('cast-button').addEventListener('click',async()=>{
    if(pending){submit();return;}
    if(casting || active || buying)return;
    casting=true;renderButton();
    try {
      const result=await api('POST','/api/player/fishing/cast',{rhythm:true});
      serverOffset=result.server_time-Date.now();
      view.next_cast_at=result.next_cast_at;
      startGame(result.challenge);
    } catch(error){$('fishing-message').textContent=error.message || '没有抛出去，请稍后重试。';}
    finally{casting=false;if(!active)await refresh();renderButton();}
  });
  const reel=$('reel-button');
  let pointer=null;
  reel.addEventListener('pointerdown',event=>{if(event.button!==0 || pointer!==null)return;pointer=event.pointerId;reel.setPointerCapture(pointer);setHeld(true);});
  const release=()=>{pointer=null;setHeld(false);};
  const releasePointer=event=>{if(event.pointerId===pointer)release();};
  reel.addEventListener('pointerup',releasePointer);
  reel.addEventListener('pointercancel',releasePointer);
  reel.addEventListener('lostpointercapture',releasePointer);
  reel.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();setHeld(true);}});
  reel.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();release();}});
  reel.addEventListener('blur',release);window.addEventListener('blur',release);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  $('abandon-button').addEventListener('click',()=>{
    stopGame();$('fishing-message').textContent='收竿了。下次再来。';
    renderButton();if(view)renderShop();refresh();
  });
  $('fish-name-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!selectedFish)return;
    const button=event.currentTarget.querySelector('button');button.disabled=true;
    try {
      const result=await api('POST','/api/player/fishing/name',{id:selectedFish.id,name:$('fish-nickname').value});
      showCatch(result.fish);await refresh();$('fish-name-error').textContent='名字记下了。';
    } catch(error){$('fish-name-error').textContent=error.message || '没记下来，重试一下。';}
    finally{button.disabled=false;}
  });

  // 低分辨率场景，按像素放大。鱼的控制判定独立运行在 50Hz 固定模拟中。
  const canvas=$('pond-canvas');const ctx=canvas.getContext('2d');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pondFrame=0;let lastPaint=0;
  function drawPond(now) {
    if(now-lastPaint>100 || !lastPaint) {
      lastPaint=now;
      ctx.fillStyle='#90aaa0';ctx.fillRect(0,0,240,150);
      ctx.fillStyle='#c3c9a2';ctx.fillRect(0,0,240,43);
      ctx.fillStyle='#8caa87';ctx.fillRect(0,29,240,29);
      ctx.fillStyle='#577964';
      for(let i=0;i<14;i+=1){const x=i*20-8;ctx.fillRect(x,26+(i%3)*4,24,22);ctx.fillRect(x+4,17+(i%3)*4,15,18);}
      ctx.fillStyle='#567d83';ctx.fillRect(0,58,240,92);
      ctx.fillStyle='#385e68';ctx.fillRect(0,58,240,5);
      ctx.fillStyle='#7da29d';
      const t=reduced?0:now/900;
      for(let i=0;i<24;i+=1){const x=(i*37+Math.floor(Math.sin(t+i)*3)+240)%240;const y=66+i*17%79;ctx.fillRect(x,y,8+i%6,1);}
      ctx.fillStyle='#667f59';ctx.fillRect(0,82,21,68);ctx.fillRect(0,107,38,43);
      ctx.fillStyle='#b59b6f';ctx.fillRect(17,98,50,18);ctx.fillRect(17,118,50,8);
      ctx.fillStyle='#665941';ctx.fillRect(17,116,50,3);ctx.fillRect(24,126,4,15);ctx.fillRect(56,126,4,15);
      ctx.strokeStyle='#dbc79a';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(51,96);ctx.lineTo(89,73);ctx.lineTo(128,94);ctx.stroke();
      ctx.fillStyle='#c7bc85';ctx.fillRect(210,43,12,4);ctx.fillRect(214,38,4,12);
    }
    if(!reduced)pondFrame=requestAnimationFrame(drawPond);
  }
  drawPond(performance.now());
  let timer=setInterval(()=>{renderButton();},1000);
  let poll=setInterval(()=>refresh(),15000);
  window.addEventListener('pagehide',()=>{stopGame();cancelAnimationFrame(pondFrame);clearInterval(timer);clearInterval(poll);});
  window.addEventListener('pageshow',event=>{
    if(!event.persisted)return;
    pickAngler();
    lastPaint=0;drawPond(performance.now());
    timer=setInterval(renderButton,1000);poll=setInterval(refresh,15000);refresh();
  });
  refresh();
})();
