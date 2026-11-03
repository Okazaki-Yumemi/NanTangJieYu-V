'use strict';

/* 短任务只负责操作体验。贡献、能量与区域状态仍由服务端校验和结算。 */
(function initTasks() {
  const SYMBOLS = ['春', '夏', '秋', '冬'];
  const TYPES = {
    wires: { title: '接好电线', hint: '拖住线头，接到另一端。' },
    wipe: { title: '擦净玻璃', hint: '按住擦拭，露出窗外的风景。' },
    leaves: { title: '清理落叶', hint: '把落叶拖进左边的吸口。' },
    trash: { title: '清空垃圾', hint: '把右侧拉杆拉到底，保持住。' },
    memory: { title: '复现闪光', hint: '看清顺序，再照着点一遍。' },
    valve: { title: '转开水阀', hint: '顺时针转动阀轮，把积水排掉。' },
    pipes: { title: '接通排水管', hint: '点按旋转管段，让水从左上流到右下。' },
    tune: { title: '对准信号', hint: '把三个光点移到标记处。' },
    seal: { title: '封住裂隙', hint: '按住符印，直到裂隙闭合。' }
  };
  const POOLS = {
    investigate: ['wipe', 'wires', 'leaves', 'pipes'],
    patrol: ['leaves', 'trash'],
    ask_reimu: ['seal'], ask_marisa: ['wires'], deep_scan: ['tune', 'memory'],
    lake_netting: ['leaves', 'valve', 'pipes'], faith_offering: ['wipe'],
    phoenix_grill: ['trash'], sword_training: ['seal'],
    tengu_dash: ['wipe'], unguarded_wander: ['leaves', 'wipe']
  };
  const lastTasks = new Map();
  let active = null;
  let soundEnabled = true;
  let audio = null;
  function play(kind = 'connect') {
    if (!soundEnabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio ||= new Audio();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      oscillator.type = kind === 'rub' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(kind === 'win' ? 660 : kind === 'rub' ? 110 : 360, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'win' ? 990 : kind === 'rub' ? 80 : 540, now + .1);
      gain.gain.setValueAtTime(kind === 'rub' ? .015 : .045, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + .15);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(); oscillator.stop(now + .16);
    } catch { /* 不支持音频时仍可正常游玩。 */ }
  }
  function typeFor(actionId) {
    const pool = POOLS[actionId] || POOLS.investigate;
    const choices = pool.length > 1 ? pool.filter(type => type !== lastTasks.get(actionId)) : pool;
    const type = choices[Math.floor(Math.random() * choices.length)];
    lastTasks.set(actionId, type);
    return type;
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    if (result.every((item, index) => item === items[index])) result.push(result.shift());
    return result;
  }

  function run({ actionId = 'investigate', name = '', type = typeFor(actionId), practice = false } = {}) {
    if (active) return Promise.resolve(false);
    const task = TYPES[type];
    if (!task) return Promise.reject(new Error('未知任务类型'));
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'task-dialog';
    dialog.setAttribute('aria-labelledby', 'task-title');
    dialog.setAttribute('aria-describedby', 'task-hint');
    dialog.innerHTML = `
      <div class="task-top"><button type="button" class="task-sound" aria-pressed="false">声音 开</button><button type="button" class="task-close" aria-label="取消调查">×</button></div>
      <p class="task-action"></p><h2 id="task-title"></h2><p id="task-hint"></p>
      <div class="task-workbench"></div>
      <p class="task-status" role="status" aria-live="polite"></p>
      <div class="task-clear" aria-hidden="true"><span>✓</span><strong>任务完成</strong></div>
      <p class="task-note">完成后结算 · 取消不消耗能量</p>`;
    dialog.querySelector('.task-action').textContent = name;
    dialog.querySelector('h2').textContent = task.title;
    dialog.querySelector('#task-hint').textContent = task.hint;
    if (practice) dialog.querySelector('.task-note').textContent = '试玩模式 · 不消耗能量，不结算奖励';
    const board = dialog.querySelector('.task-workbench');
    const status = dialog.querySelector('.task-status');
    dialog.dataset.task = type;
    let finishTimer = null;
    let finishTask = null;
    const controller = new AbortController();
    const cleanups = [];
    let solved = false;
    const listen = (el, event, fn) => el.addEventListener(event, fn, { signal: controller.signal });
    const complete = () => {
      if (solved) return;
      solved = true;
      dialog.classList.add('task-solved');
      status.textContent = '任务完成';
      play('win');
      finishTimer = setTimeout(() => finishTask(true), 950);
    };
    document.body.appendChild(dialog);

    return new Promise(resolve => {
      let closed = false;
      function close(value) {
        if (closed) return;
        closed = true;
        controller.abort();
        cleanups.forEach(fn => fn());
        clearTimeout(finishTimer);
        dialog.close();
        dialog.remove();
        active = null;
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        resolve(value);
      }
      active = () => close(false);
      finishTask = close;
      listen(dialog.querySelector('.task-close'), 'click', () => close(false));
      listen(dialog, 'cancel', event => { event.preventDefault(); close(false); });
      const sound = dialog.querySelector('.task-sound');
      function soundLabel() {
        sound.textContent = soundEnabled ? '声音 开' : '声音 关';
        sound.setAttribute('aria-pressed', String(!soundEnabled));
      }
      soundLabel();
      listen(sound, 'click', () => { soundEnabled = !soundEnabled; soundLabel(); });
      listen(dialog, 'pointerdown', () => { if (soundEnabled && !audio) play('rub'); });

      if (NTJ.taskScenes && NTJ.taskScenes[type]) {
        NTJ.taskScenes[type](board, { listen, cleanups, complete, status, play, isSolved: () => solved });
      } else if (type === 'wires') {
        board.classList.add('wire-board');
        board.innerHTML = '<svg class="wire-lines" aria-hidden="true"></svg><div class="wire-column left"></div><div class="wire-column right"></div>';
        const lines = board.querySelector('svg');
        const connected = new Set();
        let selected = null;
        let pointerId = null;
        const buttons = [[], []];
        [SYMBOLS, shuffle(SYMBOLS)].forEach((items, side) => {
          items.forEach(symbol => {
            const index = SYMBOLS.indexOf(symbol);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `wire-socket season-${index}`;
            button.dataset.side = String(side);
            button.dataset.index = String(index);
            button.textContent = symbol;
            button.setAttribute('aria-label', `${side ? '右侧' : '左侧'}${symbol}`);
            board.querySelector(side ? '.right' : '.left').appendChild(button);
            buttons[side][index] = button;
            listen(button, 'click', () => pick(side, index));
            if (side === 0) {
              listen(button, 'pointerdown', event => {
                if (event.button !== 0 || connected.has(index) || pointerId !== null) return;
                pick(0, index);
                pointerId = event.pointerId;
                button.setPointerCapture(pointerId);
              });
              listen(button, 'pointermove', event => {
                if (pointerId === event.pointerId && selected !== null) draw({ x: event.clientX, y: event.clientY });
              });
              listen(button, 'pointerup', event => {
                if (pointerId !== event.pointerId) return;
                pointerId = null;
                const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.wire-socket');
                if (target && board.contains(target) && target.dataset.side === '1') pick(1, Number(target.dataset.index));
                draw();
              });
              listen(button, 'pointercancel', () => { pointerId = null; draw(); });
            }
          });
        });
        function pick(side, index) {
          if (connected.has(index)) return;
          if (side === 0) {
            selected = index;
            buttons[0].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
            status.textContent = `${connected.size} / 4`;
          } else if (selected === index) {
            connected.add(index);
            play('connect');
            [buttons[0][index], buttons[1][index]].forEach(button => {
              button.classList.add('connected');
              button.setAttribute('aria-label', `${button.getAttribute('aria-label')}，已连接`);
              button.setAttribute('aria-pressed', 'false');
            });
            selected = null;
            status.textContent = `${connected.size} / 4`;
            if (connected.size === SYMBOLS.length) complete();
            draw();
          } else {
            status.textContent = selected === null ? '先选择左侧的季节。' : '季节不对应，换一个接点试试。';
          }
        }
        function draw(cursor) {
          const bounds = board.getBoundingClientRect();
          lines.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
          lines.replaceChildren();
          function point(button) {
            const r = button.getBoundingClientRect();
            return { x: r.left + r.width / 2 - bounds.left, y: r.top + r.height / 2 - bounds.top };
          }
          function path(index, end) {
            const start = point(buttons[0][index]);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const bend = (end.x - start.x) * .45;
            line.setAttribute('d', `M${start.x} ${start.y} C${start.x + bend} ${start.y},${end.x - bend} ${end.y},${end.x} ${end.y}`);
            line.setAttribute('class', `season-${index}`);
            lines.appendChild(line);
          }
          connected.forEach(index => path(index, point(buttons[1][index])));
          if (cursor && selected !== null) path(selected, { x: cursor.x - bounds.left, y: cursor.y - bounds.top });
        }
        const observer = new ResizeObserver(() => draw());
        observer.observe(board);
        cleanups.push(() => observer.disconnect());
        status.textContent = '0 / 4';
      } else if (type === 'tune') {
        board.classList.add('tune-board');
        const values = [];
        const targets = [];
        const rows = [];
        for (let i = 0; i < 3; i += 1) {
          const target = 25 + Math.floor(Math.random() * 51);
          targets.push(target);
          values.push(5);
          const row = document.createElement('label');
          row.className = 'tune-row';
          row.innerHTML = `<span>结界 ${i + 1}<small>目标 ${target}</small></span><div class="tune-track" style="--target:${target}%"><i aria-hidden="true"></i><input type="range" min="0" max="100" value="5" aria-label="结界 ${i + 1}，目标 ${target}，允许偏差 7" /></div><output>偏离</output>`;
          board.appendChild(row);
          rows.push(row);
          listen(row.querySelector('input'), 'input', event => {
            if (solved) return;
            values[i] = Number(event.target.value);
            const matched = Math.abs(values[i] - targets[i]) <= 7;
            row.classList.toggle('aligned', matched);
            row.querySelector('output').textContent = matched ? '对准' : '偏离';
            const count = values.filter((v, j) => Math.abs(v - targets[j]) <= 7).length;
            status.textContent = `已调谐 ${count} / 3`;
            if (count === 3) {
              rows.forEach(item => { item.querySelector('input').disabled = true; });
              complete();
            }
          });
        }
        status.textContent = '已调谐 0 / 3';
      } else {
        board.classList.add('seal-board');
        board.innerHTML = '<div class="seal-door" aria-hidden="true"><i></i><i></i></div><button type="button" class="seal-control" aria-label="按住符印约三秒，或使用空格键"><span>封</span><small>按住符印</small></button><progress max="100" value="0" aria-label="封印进度"></progress>';
        const button = board.querySelector('button');
        const progress = board.querySelector('progress');
        let frame = 0;
        let start = null;
        let source = null;
        function reset() {
          cancelAnimationFrame(frame);
          start = null;
          source = null;
          if (solved) return;
          board.style.setProperty('--sealed', '0');
          progress.value = 0;
          button.classList.remove('holding');
          status.textContent = '按住符印，让后门闭合。';
        }
        function tick(now) {
          const ratio = Math.min(1, (now - start) / 2400);
          board.style.setProperty('--sealed', String(ratio));
          progress.value = Math.round(ratio * 100);
          if (ratio === 1) {
            complete();
            button.classList.remove('holding');
            button.querySelector('small').textContent = '封印完成';
            return;
          }
          frame = requestAnimationFrame(tick);
        }
        function begin(input) {
          if (solved || start !== null) return;
          source = input;
          start = performance.now();
          button.classList.add('holding');
          status.textContent = '正在封印……';
          frame = requestAnimationFrame(tick);
        }
        listen(button, 'pointerdown', event => {
          if (event.button !== 0) return;
          button.setPointerCapture(event.pointerId);
          begin(event.pointerId);
        });
        listen(button, 'pointerup', event => { if (source === event.pointerId) reset(); });
        listen(button, 'pointercancel', reset);
        listen(button, 'keydown', event => {
          if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); begin('keyboard'); }
        });
        listen(button, 'keyup', event => {
          if ((event.key === ' ' || event.key === 'Enter') && source === 'keyboard') reset();
        });
        listen(button, 'blur', reset);
        listen(window, 'blur', reset);
        listen(document, 'visibilitychange', () => { if (document.hidden) reset(); });
        cleanups.push(() => cancelAnimationFrame(frame));
        reset();
      }
      dialog.showModal();
      dialog.querySelector('.task-close').focus({ preventScroll: true });
    });
  }

  NTJ.tasks = { run, cancel() { if (active) active(); }, typeFor };
})();
