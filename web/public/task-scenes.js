'use strict';

/* 场景负责物件和反馈；任务生命周期、取消与结算由 tasks.js 统一管理。 */
(function initTaskScenes() {
  const leafArt = '<svg viewBox="0 0 70 52" aria-hidden="true"><path d="M5 38Q13 0 62 8Q66 46 21 45Z" fill="currentColor" stroke="#553f2d" stroke-width="3"/><path d="M9 43L55 15M24 32L24 20M36 24L48 32" fill="none" stroke="#785737" stroke-width="2"/></svg>';

  function leaves(board, { listen, cleanups, complete, status, play, isSolved }) {
    board.classList.add('leaf-scene');
    board.innerHTML = '<div class="filter-grille" aria-hidden="true"></div><button type="button" class="leaf-vent" aria-label="吸入口，选中落叶后点击此处清理"><i></i><i></i><i></i><span>吸入口</span></button><span class="machine-label" aria-hidden="true">进气过滤箱</span>';
    const vent = board.querySelector('.leaf-vent');
    let selected = null;
    let dragging = null;
    let count = 0;
    const positions = [[.4,.2],[.7,.23],[.52,.48],[.82,.58],[.4,.78],[.72,.83]];
    const colors = ['#d3a15a', '#ba7448', '#cbb965', '#9eaf66', '#d3a15a', '#af7750'];
    const leaves = positions.map(([x,y], index) => {
      const leaf = document.createElement('button');
      leaf.type = 'button';
      leaf.className = 'loose-leaf';
      leaf.setAttribute('aria-label', `落叶 ${index + 1}`);
      leaf.setAttribute('aria-pressed', 'false');
      leaf.style.cssText = `left:${x*100}%;top:${y*100}%;--turn:${index*51-30}deg;color:${colors[index]}`;
      leaf.innerHTML = leafArt;
      board.appendChild(leaf);
      listen(leaf, 'click', () => {
        if (leaf.disabled || isSolved()) return;
        selected = leaf;
        leaves.forEach(item => item.setAttribute('aria-pressed', String(item === leaf)));
        vent.classList.add('ready');
      });
      listen(leaf, 'pointerdown', event => {
        if (event.button !== 0 || dragging || leaf.disabled || isSolved()) return;
        const r = board.getBoundingClientRect();
        const l = leaf.getBoundingClientRect();
        dragging = { id:event.pointerId, leaf, ox:event.clientX-(l.left+l.width/2), oy:event.clientY-(l.top+l.height/2) };
        leaf.setPointerCapture(event.pointerId);
        leaf.classList.add('dragging');
        vent.classList.add('ready');
        leaf.style.left = `${(event.clientX-r.left-dragging.ox)/r.width*100}%`;
      });
      listen(leaf, 'pointermove', event => {
        if (!dragging || dragging.id !== event.pointerId || dragging.leaf !== leaf) return;
        const r = board.getBoundingClientRect();
        leaf.style.left = `${Math.max(.07,Math.min(.93,(event.clientX-r.left-dragging.ox)/r.width))*100}%`;
        leaf.style.top = `${Math.max(.08,Math.min(.92,(event.clientY-r.top-dragging.oy)/r.height))*100}%`;
      });
      listen(leaf, 'pointerup', event => {
        if (!dragging || dragging.id !== event.pointerId || dragging.leaf !== leaf) return;
        dragging = null;
        leaf.classList.remove('dragging');
        const r = vent.getBoundingClientRect();
        const l = leaf.getBoundingClientRect();
        const cx = l.left + l.width/2;
        const cy = l.top + l.height/2;
        if (cx >= r.left-12 && cx <= r.right+12 && cy >= r.top-12 && cy <= r.bottom+12) collect(leaf);
      });
      listen(leaf, 'pointercancel', () => { dragging = null; leaf.classList.remove('dragging'); });
      return leaf;
    });
    function collect(leaf) {
      if (leaf.disabled || isSolved()) return;
      leaf.disabled = true;
      leaf.classList.add('collected');
      leaf.setAttribute('aria-pressed', 'false');
      selected = null;
      count += 1;
      play('rub');
      vent.classList.remove('ready');
      status.textContent = `${count} / 6`;
      if (count === leaves.length) complete();
    }
    listen(vent, 'click', () => { if (selected) collect(selected); });
    cleanups.push(() => { dragging = null; });
    status.textContent = '0 / 6';
  }

  function wipe(board, { listen, complete, status, play, isSolved }) {
    board.classList.add('wipe-scene');
    board.innerHTML = `<div class="glass-pane"><svg class="window-view" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id="window-sky" x2="0" y2="1"><stop stop-color="#798a9e"/><stop offset="1" stop-color="#c5d4cb"/></linearGradient></defs>
      <path fill="url(#window-sky)" d="M0 0H640V400H0Z"/><circle cx="477" cy="80" r="31" fill="#e9dba7"/>
      <path d="M0 243Q130 190 240 230T640 222V400H0Z" fill="#719288"/><path d="M0 290Q200 228 390 276T640 282V400H0Z" fill="#478083"/>
      <path d="M0 341Q160 308 330 344T640 332M30 365H210M350 378H590" fill="none" stroke="#a1bdb1" stroke-width="4" opacity=".6"/>
      <g fill="#d1c4a5" stroke="#5a615b" stroke-width="5"><path d="M197 285V164H222V285ZM417 285V164H442V285Z"/><path d="M185 171L319 113L454 171Z" fill="#575f68"/><path d="M218 174H421V205H218Z"/></g>
      <path d="M252 191H385" stroke="#85806a" stroke-width="4"/>
      <path d="M68 297V147M566 290V140" stroke="#555f55" stroke-width="16"/><g fill="#586e59"><circle cx="58" cy="140" r="56"/><circle cx="100" cy="175" r="44"/><circle cx="563" cy="132" r="62"/><circle cx="605" cy="180" r="47"/></g>
      <g fill="#d7a5a1"><circle cx="58" cy="113" r="32"/><circle cx="102" cy="165" r="27"/><circle cx="551" cy="108" r="37"/></g>
      </svg><canvas width="640" height="400" tabindex="0" role="application" aria-label="雾玻璃，按住拖动擦拭；键盘方向键移动抹布，按住空格擦拭"></canvas><i class="wipe-cloth" aria-hidden="true"></i></div>`;
    const canvas = board.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const cloth = board.querySelector('.wipe-cloth');
    const mask = NTJ.taskMath.createWipeMask();
    const fog = ctx.createLinearGradient(0,0,640,400);
    fog.addColorStop(0,'#9aa9acd9'); fog.addColorStop(.5,'#c9cec1f5'); fog.addColorStop(1,'#718989e8');
    ctx.fillStyle = fog; ctx.fillRect(0,0,640,400);
    // 固定随机斑痕只绘制一次，擦掉的就是玩家实际经过的位置。
    for (let i=0;i<85;i+=1) {
      ctx.beginPath(); ctx.ellipse((i*137)%640,(i*83)%400,13+i%22,3+i%8,i*.8,0,Math.PI*2);
      ctx.fillStyle = i%2 ? '#677f842f' : '#edf0d436'; ctx.fill();
    }
    let pointer = null;
    let previous = null;
    let keyboard = {x:320,y:200};
    let rubbing = false;
    let lastSound = 0;
    function erase(point) {
      if (isSolved()) return;
      const from = previous || point;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
      ctx.lineWidth = 78; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(point.x,point.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(point.x,point.y,39,0,Math.PI*2); ctx.fill();
      const ratio = mask.stroke(from,point,36);
      cloth.style.left = `${point.x/640*100}%`; cloth.style.top = `${point.y/400*100}%`;
      cloth.classList.add('visible');
      status.textContent = `${Math.min(100,Math.round(ratio/.78*100))}%`;
      if (performance.now()-lastSound>160) { play('rub'); lastSound=performance.now(); }
      previous = point;
      if (ratio >= .78) { ctx.clearRect(0,0,640,400); cloth.classList.remove('visible'); complete(); }
    }
    function point(event) {
      const r = canvas.getBoundingClientRect();
      return {x:Math.max(0,Math.min(640,(event.clientX-r.left)/r.width*640)),y:Math.max(0,Math.min(400,(event.clientY-r.top)/r.height*400))};
    }
    function stop() { pointer=null; previous=null; rubbing=false; cloth.classList.remove('visible'); }
    listen(canvas,'pointerdown',event=>{ if(event.button!==0 || pointer!==null)return; pointer=event.pointerId; previous=null; canvas.setPointerCapture(pointer); erase(point(event)); });
    listen(canvas,'pointermove',event=>{ if(pointer===event.pointerId)erase(point(event)); });
    listen(canvas,'pointerup',stop); listen(canvas,'pointercancel',stop); listen(window,'blur',stop);
    listen(canvas,'keydown',event=>{
      if (event.key===' ') {event.preventDefault();rubbing=true;erase(keyboard);return;}
      const delta={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[event.key];
      if(!delta)return;
      event.preventDefault();keyboard={x:Math.max(0,Math.min(640,keyboard.x+delta[0])),y:Math.max(0,Math.min(400,keyboard.y+delta[1]))};
      if(rubbing)erase(keyboard);
      else {cloth.style.left=`${keyboard.x/640*100}%`;cloth.style.top=`${keyboard.y/400*100}%`;cloth.classList.add('visible');}
    });
    listen(canvas,'keyup',event=>{if(event.key===' ')stop();}); listen(canvas,'blur',stop);
    status.textContent='0%';
  }

  function trash(board, { listen, cleanups, complete, status, play, isSolved }) {
    board.classList.add('trash-scene');
    board.innerHTML='<div class="trash-hopper"><span class="machine-label">收集舱</span><div class="trash-pieces"></div><div class="hatch" aria-hidden="true"><i></i><i></i></div></div><div class="lever-track"><span>关</span><button type="button" class="trash-lever" aria-label="垃圾舱拉杆，向下拖动到底并保持，键盘按住空格"><i></i></button><span>开</span></div>';
    const pieces=board.querySelector('.trash-pieces');
    for(let i=0;i<12;i+=1) {
      const piece=document.createElement('i');
      piece.className=`trash-piece piece-${i%3}`;
      piece.style.cssText=`--x:${14+(i*29)%72}%;--y:${12+(i*37)%67}%;--angle:${i*63}deg;--delay:${i*.035}s`;
      piece.innerHTML=i%3===0?leafArt:'';
      pieces.appendChild(piece);
    }
    const lever=board.querySelector('.trash-lever');
    const track=board.querySelector('.lever-track');
    let pointer=null;
    let frame=0;
    let last=0;
    let drained=0;
    let pull=0;
    function position(value) {pull=value; board.style.setProperty('--pull',String(value));}
    function tick(now) {
      const elapsed=Math.min(80,now-last);last=now;
      if(pull>.82 && !document.hidden)drained=Math.min(1,drained+elapsed/1800);
      board.style.setProperty('--drained',String(drained));
      board.classList.toggle('draining',pull>.82);
      status.textContent=`${Math.round(drained*100)}%`;
      if(drained===1) {board.classList.add('emptied');complete();return;}
      frame=requestAnimationFrame(tick);
    }
    function start(){if(frame||isSolved())return;last=performance.now();frame=requestAnimationFrame(tick);}
    function stop(){pointer=null;position(0);board.classList.remove('draining');cancelAnimationFrame(frame);frame=0;}
    function move(event){const r=track.getBoundingClientRect();position(Math.max(0,Math.min(1,(event.clientY-r.top-36)/(r.height-72))));}
    listen(lever,'pointerdown',event=>{if(event.button!==0||pointer!==null||isSolved())return;pointer=event.pointerId;lever.setPointerCapture(pointer);play('rub');move(event);start();});
    listen(lever,'pointermove',event=>{if(event.pointerId===pointer)move(event);});
    listen(lever,'pointerup',stop);listen(lever,'pointercancel',stop);listen(lever,'blur',stop);listen(window,'blur',stop);
    listen(document,'visibilitychange',()=>{if(document.hidden)stop();});
    listen(lever,'keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();if(isSolved())return;position(1);start();}});
    listen(lever,'keyup',event=>{if(event.key===' '||event.key==='Enter')stop();});
    cleanups.push(stop);status.textContent='0%';
  }
  function memory(board, { listen, cleanups, complete, status, play, isSolved }) {
    board.classList.add('memory-scene');
    board.innerHTML='<div class="memory-lamps" aria-hidden="true"><i></i><i></i></div><div class="memory-grid"></div>';
    const pattern=[];
    while(pattern.length<3) {const n=Math.floor(Math.random()*9);if(!pattern.includes(n))pattern.push(n);}
    const sequence=NTJ.taskMath.createMemorySequence(pattern);
    const timers=new Set();
    const later=(fn,delay)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},delay);timers.add(timer);};
    let round=2;
    let ready=false;
    const buttons=Array.from({length:9},(_,i)=>{
      const button=document.createElement('button');
      button.type='button';button.textContent=String(i+1);button.setAttribute('aria-label',`位置 ${i+1}`);
      board.querySelector('.memory-grid').appendChild(button);
      listen(button,'click',()=>{
        if(!ready||isSolved())return;
        play('connect');
        const result=sequence.accept(i);
        if(!result.matched) {
          ready=false;board.classList.add('wrong');status.textContent='再看一遍。';
          later(()=>{board.classList.remove('wrong');playback();},600);return;
        }
        button.classList.add('lit');later(()=>button.classList.remove('lit'),180);
        if(result.advance || result.complete) {
          ready=false;
          board.querySelectorAll('.memory-lamps i')[round-2].classList.add('on');
          if(round===3)complete();
          else {round=3;later(playback,600);}
        }
      });
      return button;
    });
    function playback() {
      ready=false;status.textContent='记住亮起的顺序。';
      buttons.forEach(button=>{button.disabled=true;button.classList.remove('lit');});
      for(let i=0;i<round;i+=1) {
        later(()=>{buttons[pattern[i]].classList.add('lit');play('connect');status.textContent=`亮起：${pattern[i]+1}`;},400+i*650);
        later(()=>buttons[pattern[i]].classList.remove('lit'),800+i*650);
      }
      later(()=>{ready=true;buttons.forEach(button=>{button.disabled=false;});status.textContent='按刚才的顺序点亮。';},500+round*650);
    }
    cleanups.push(()=>{timers.forEach(timer=>clearTimeout(timer));timers.clear();});
    playback();
  }

  function valve(board, { listen, complete, status, play, isSolved }) {
    board.classList.add('valve-scene');
    board.innerHTML='<div class="water-gauge" aria-hidden="true"><i></i><span>水位</span></div><div class="water-pipe" aria-hidden="true"></div><button type="button" class="valve-wheel" aria-label="排水阀，顺时针转动一圈；键盘方向右键转动"><i></i><i></i><i></i><span></span></button><div class="valve-direction" aria-hidden="true">顺时针 ↻</div>';
    const wheel=board.querySelector('.valve-wheel');
    let pointer=null;
    let previous=null;
    let angle=0;
    let lastSound=0;
    function turn(delta) {
      if(isSolved())return;
      angle=Math.max(0,Math.min(360,angle+delta));
      board.style.setProperty('--angle',`${angle}deg`);
      board.style.setProperty('--water',`${100-angle/360*100}%`);
      status.textContent=`${Math.round(angle/360*100)}%`;
      if(performance.now()-lastSound>160) {play('rub');lastSound=performance.now();}
      if(angle>=360)complete();
    }
    function bearing(event) {
      const r=wheel.getBoundingClientRect();
      return Math.atan2(event.clientY-r.top-r.height/2,event.clientX-r.left-r.width/2)*180/Math.PI;
    }
    function stop(){pointer=null;previous=null;wheel.classList.remove('turning');}
    listen(wheel,'pointerdown',event=>{if(event.button!==0||pointer!==null||isSolved())return;pointer=event.pointerId;previous=bearing(event);wheel.setPointerCapture(pointer);wheel.classList.add('turning');});
    listen(wheel,'pointermove',event=>{
      if(pointer!==event.pointerId)return;
      const next=bearing(event);
      const delta=(next-previous+540)%360-180;
      previous=next;
      // 忽略跨过圆心造成的大幅跳角，必须实际沿阀轮转动。
      if(Math.abs(delta)<70)turn(delta);
    });
    listen(wheel,'pointerup',stop);listen(wheel,'pointercancel',stop);listen(wheel,'blur',stop);listen(window,'blur',stop);
    listen(wheel,'keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();turn(event.key==='ArrowRight'?20:-20);}});
    status.textContent='0%';
  }
  function pipes(board, { listen, complete, status, play, isSolved }) {
    const size = 4;
    const directions = ['上', '右', '下', '左'];
    const endpoints = ['20 0', '40 20', '20 40', '0 20'];
    const steps = [1, 1, 1, 2, 2, 2];
    for (let i = steps.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [steps[i], steps[j]] = [steps[j], steps[i]];
    }
    const tiles = Array.from({ length: size * size }, () => [
      Math.random() < .5 ? 1 : 2,
      3
    ]);
    let position = 0;
    let inlet = 3;
    for (const outlet of [...steps, 1]) {
      tiles[position] = [inlet, outlet];
      position += outlet === 1 ? 1 : size;
      inlet = (outlet + 2) % 4;
    }

    const rotations = tiles.map(() => Math.floor(Math.random() * 4));
    rotations[0] = 1; // 每局至少需要修正入口。
    board.classList.add('pipe-scene');
    board.innerHTML = '<div class="pipe-header"><span>● 进水</span><span>排水 ○</span></div><div class="pipe-grid"></div>';
    const grid = board.querySelector('.pipe-grid');
    const buttons = tiles.map((_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pipe-tile';
      button.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path/></svg>';
      listen(button, 'click', () => {
        if (isSolved()) return;
        rotations[index] = (rotations[index] + 1) % 4;
        play('connect');
        render();
      });
      grid.append(button);
      return button;
    });

    function render() {
      const openings = tiles.map((tile, index) =>
        tile.map(direction => (direction + rotations[index]) % 4));
      const wet = new Set();
      let index = 0;
      let entry = 3;
      let drained = false;
      while (!wet.has(index) && openings[index].includes(entry)) {
        wet.add(index);
        const exit = openings[index].find(direction => direction !== entry);
        const row = Math.floor(index / size);
        const column = index % size;
        const nextRow = row + (exit === 2 ? 1 : exit === 0 ? -1 : 0);
        const nextColumn = column + (exit === 1 ? 1 : exit === 3 ? -1 : 0);
        if (nextRow < 0 || nextRow >= size || nextColumn < 0 || nextColumn >= size) {
          drained = index === tiles.length - 1 && exit === 1;
          break;
        }
        index = nextRow * size + nextColumn;
        entry = (exit + 2) % 4;
      }
      buttons.forEach((button, i) => {
        const [a, b] = openings[i];
        button.querySelector('path').setAttribute('d', `M${endpoints[a]} Q20 20 ${endpoints[b]}`);
        button.setAttribute('aria-label', `第${Math.floor(i / size) + 1}行第${i % size + 1}列，开口朝${directions[a]}和${directions[b]}，旋转管段`);
        button.classList.toggle('wet', wet.has(i));
      });
      status.textContent = wet.size ? `水已流过 ${wet.size} 段` : '从左上角的进水口接起';
      if (drained) complete();
    }
    render();
  }
  function sigils(board, { listen, complete, status, play, isSolved }) {
    const side = 3;
    const lamps = Array(side * side).fill(false);
    function flip(index) {
      const row = Math.floor(index / side);
      const column = index % side;
      lamps[index] = !lamps[index];
      if (row > 0) lamps[index - side] = !lamps[index - side];
      if (row < side - 1) lamps[index + side] = !lamps[index + side];
      if (column > 0) lamps[index - 1] = !lamps[index - 1];
      if (column < side - 1) lamps[index + 1] = !lamps[index + 1];
    }
    const choices = lamps.map((_, index) => index);
    for (let i = 0; i < 3; i += 1) {
      const [index] = choices.splice(Math.floor(Math.random() * choices.length), 1);
      flip(index);
    }
    if (!lamps.some(Boolean)) flip(4);
    const initial = [...lamps];
    board.classList.add('sigil-scene');
    board.innerHTML = '<div class="sigil-grid" role="group" aria-label="九盏地灯"></div><button type="button" class="sigil-reset">复原灯阵</button>';
    const grid = board.querySelector('.sigil-grid');
    const buttons = lamps.map((_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 42 24 24 42 6 24Z M24 14 34 24 24 34 14 24Z"/><circle cx="24" cy="24" r="3"/></svg>';
      button.setAttribute('aria-label', `第${Math.floor(index / side) + 1}行第${index % side + 1}列地灯`);
      listen(button, 'click', () => {
        if (isSolved()) return;
        flip(index);
        play('connect');
        render();
      });
      grid.append(button);
      return button;
    });
    listen(board.querySelector('.sigil-reset'), 'click', () => {
      if (isSolved()) return;
      initial.forEach((lit, index) => { lamps[index] = lit; });
      render();
    });
    function render() {
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(lamps[index])));
      const remaining = lamps.filter(Boolean).length;
      status.textContent = `还有 ${remaining} 盏亮着`;
      if (!remaining) complete();
    }
    render();
  }
  NTJ.taskScenes={wipe,leaves,trash,memory,valve,pipes,sigils};
})();
