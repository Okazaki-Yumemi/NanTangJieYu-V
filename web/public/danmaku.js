(() => {
  'use strict';

  const engine = window.NTJDanmaku;
  const byId = name => document.getElementById(`firefly-${name}`);
  const canvas = byId('field');
  const shell = document.querySelector('.firefly-shell');
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const start = byId('start');
  const pause = byId('pause');
  const burstButton = byId('burst');
  const focusButton = byId('focus');
  const curtain = byId('curtain');
  const mode = byId('mode');
  const sprite = new Image();
  sprite.src = '/assets/reimu-survivors.png';
  const keys = new Set();
  const movementKeys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
  let game = engine.createGame(mode.value);
  game.phase = 'ready';
  game.lantern = null;
  let best = readBest();
  let runId = 0;
  let pointer = null;
  let pointerPoint = null;
  let target = null;
  let focusLocked = false;
  let pendingBurst = false;
  let frame;
  let last = 0;
  let accumulator = 0;

  function scoreKey() { return `ntj-firefly-${game.mode}-v2`; }
  function rankingMode() { return `${game.mode}-v2`; }
  function readBest() {
    try { return Math.max(0, Number(localStorage.getItem(scoreKey())) || 0); }
    catch { return 0; }
  }
  function isFocused() { return focusLocked || keys.has('Shift'); }
  function text(id, value) {
    const node = byId(id);
    if (node.textContent !== String(value)) node.textContent = value;
  }

  function draw() {
    const { elapsed, warning, bullets, guard, invulnerableUntil, lantern, player, notes } = game;
    const pattern = Math.min(2, Math.floor(elapsed / 12));
    ctx.fillStyle = ['#162824', '#192533', '#2a2031'][pattern];
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#bcc8b438';
    ctx.strokeRect(10, 10, width - 20, height - 20);
    ctx.strokeStyle = '#bcc8b420';
    for (const radius of [68, 106, 145]) {
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (warning) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.5;
      for (const shot of warning) {
        ctx.strokeStyle = shot.color;
        ctx.globalAlpha = .55;
        ctx.beginPath();
        ctx.moveTo(shot.x, shot.y);
        ctx.lineTo(shot.x + shot.vx * .48, shot.y + shot.vy * .48);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const bullet of bullets) {
      ctx.strokeStyle = bullet.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bullet.x, bullet.y);
      ctx.lineTo(bullet.x - bullet.vx * .08, bullet.y - bullet.vy * .08);
      ctx.stroke();
      ctx.fillStyle = bullet.color;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff1e4';
      ctx.fillRect(bullet.x - 1, bullet.y - 1, 2, 2);
    }
    if (guard >= 8 || elapsed < invulnerableUntil) {
      ctx.strokeStyle = '#9ee5d6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (lantern) {
      ctx.fillStyle = '#ffd27f35';
      ctx.fillRect(lantern.x - 10, lantern.y - 10, 20, 20);
      ctx.fillStyle = '#ffd27f';
      ctx.fillRect(lantern.x - 5, lantern.y - 6, 10, 12);
      ctx.fillStyle = '#fff0b0';
      ctx.fillRect(lantern.x - 2, lantern.y - 3, 4, 6);
    }
    for (const effect of game.effects) {
      const progress = Math.min(1, (elapsed - effect.at) / .35);
      ctx.strokeStyle = '#b0f5e0';
      ctx.globalAlpha = 1 - progress;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * (.25 + .75 * progress), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (isFocused() && game.phase === 'playing') {
      ctx.strokeStyle = '#fff3bf80';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 21, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (sprite.naturalWidth) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, 0, 0, 13, 13, Math.round(player.x) - 13, Math.round(player.y) - 14, 26, 26);
    }
    // This pin remains visible on the sprite so the player can read the hitbox.
    ctx.fillStyle = '#211828';
    ctx.beginPath();
    ctx.arc(player.x, player.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3bf';
    ctx.beginPath();
    ctx.arc(player.x, player.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 12px system-ui';
    for (const note of notes) {
      ctx.globalAlpha = Math.max(0, 1 - (elapsed - note.at));
      ctx.fillStyle = '#ffe8b9';
      ctx.fillText(note.label, Math.min(note.x + 9, width - 60), note.y - (elapsed - note.at) * 26);
    }
    ctx.globalAlpha = 1;
  }

  function updateLedger() {
    const rules = engine.MODES[game.mode];
    const playing = game.phase === 'playing';
    text('score', game.score);
    text('time', Math.max(0, Math.ceil(engine.DURATION - game.elapsed)));
    text('best', best);
    text('chain', `×${game.elapsed - game.lastLamp < 4 ? Math.min(game.chain + 1, 4) : 1}`);
    const remaining = Math.max(0, Math.ceil((game.spell + 1) * 12 - game.elapsed));
    text('pattern', `${engine.PATTERNS[game.spell]}${rules.quota ? ` · 灯 ${game.spellLamps}/${rules.quota} · ${remaining}秒` : ''}`);
    text('guard', game.guard === 8 ? '护身符就绪' : `护身符 ${game.guard}/8`);
    text('burst', game.guard === 8 ? '灵击 · 就绪' : `灵击 ${game.guard}/8`);
    burstButton.disabled = !playing || game.guard < engine.GUARD_MAX;
    focusButton.disabled = !playing;
    focusButton.setAttribute('aria-pressed', String(isFocused()));
    text('focus', isFocused() ? '低速 · 开' : '低速 · 关');
    byId('chain-time').value = Math.max(0, 4 - (game.elapsed - game.lastLamp));
  }

  function releaseInput() {
    keys.clear();
    pointer = pointerPoint = target = null;
    pendingBurst = false;
    updateLedger();
  }

  function showRanking() {
    window.NTJArcadeScores?.mount(byId('ranking'), 'danmaku', rankingMode());
  }

  async function submitResult() {
    if (!window.NTJArcadeScores || game.score === 0) return;
    const finishedRun = runId;
    text('ranking-status', '正在保存成绩…');
    const result = await window.NTJArcadeScores.submit('danmaku', { mode: rankingMode(), score: game.score });
    if (finishedRun !== runId) return;
    text('ranking-status', result.message || (result.improved ? '已刷新榜上纪录。' : '已保留你的榜上最佳。'));
  }

  function showCurtain() {
    cancelAnimationFrame(frame);
    releaseInput();
    const finished = game.phase === 'over';
    shell.classList.toggle('is-running', !finished);
    if (finished && game.score > best) {
      best = game.score;
      try { localStorage.setItem(scoreKey(), String(best)); } catch { /* Storage is optional. */ }
    }
    updateLedger();
    curtain.classList.remove('hidden');
    text('result', finished ? game.result : '暂停');
    text('detail', finished ? `${game.score} 分 · 灯 ${game.lamps} 盏 · 擦弹 ${game.grazes} 次 · 灵击 ${game.bursts} 次` : '点击继续，接着刚才的位置玩。');
    byId('breakdown').classList.toggle('hidden', !finished);
    if (finished) {
      text('lamp-points', game.lampPoints);
      text('graze-points', game.grazePoints);
      text('burst-points', game.burstPoints);
      text('clear-points', game.clearPoints);
      void submitResult();
    }
    start.textContent = finished ? '再来一次' : '继续';
    pause.disabled = true;
    mode.disabled = !finished;
    start.focus({ preventScroll: true });
  }

  function tick(now) {
    if (game.phase !== 'playing') return;
    accumulator += Math.min(.1, Math.max(0, (now - last) / 1000));
    last = now;
    while (accumulator >= engine.STEP && game.phase === 'playing') {
      engine.step(game, {
        dx: Number(keys.has('right')) - Number(keys.has('left')),
        dy: Number(keys.has('down')) - Number(keys.has('up')),
        target, focus: isFocused(), burst: pendingBurst
      });
      pendingBurst = false;
      accumulator -= engine.STEP;
    }
    draw();
    updateLedger();
    if (game.phase === 'over') showCurtain();
    else frame = requestAnimationFrame(tick);
  }

  start.addEventListener('click', () => {
    if (game.phase !== 'paused') {
      runId += 1;
      game = engine.createGame(mode.value);
      text('ranking-status', '');
    }
    game.phase = 'playing';
    shell.classList.add('is-running');
    releaseInput();
    mode.disabled = true;
    curtain.classList.add('hidden');
    pause.disabled = false;
    canvas.focus({ preventScroll: true });
    document.querySelector('.firefly-ledger').scrollIntoView({ block: 'start', behavior: 'auto' });
    last = performance.now();
    accumulator = 0;
    frame = requestAnimationFrame(tick);
  });

  mode.addEventListener('change', () => {
    runId += 1;
    game = engine.createGame(mode.value);
    game.phase = 'ready';
    shell.classList.remove('is-running');
    game.lantern = null;
    best = readBest();
    releaseInput();
    text('ranking-status', '');
    byId('breakdown').classList.add('hidden');
    text('result', engine.MODES[game.mode].label);
    const quota = engine.MODES[game.mode].quota;
    text('detail', quota ? `每道符卡 12 秒，至少取 ${quota} 盏灯。瞄准预警出现后再换位。` : '穿过三道符卡，撑过 36 秒。');
    start.textContent = '开始';
    draw();
    showRanking();
  });

  function pauseGame() {
    if (game.phase !== 'playing') return;
    game.phase = 'paused';
    showCurtain();
  }
  pause.addEventListener('click', pauseGame);
  window.addEventListener('blur', pauseGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  document.addEventListener('keydown', event => {
    if (game.phase !== 'playing' || event.ctrlKey || event.altKey || event.metaKey ||
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'Escape') { event.preventDefault(); pauseGame(); return; }
    if (key === 'x' || key === ' ') {
      event.preventDefault();
      if (!event.repeat) pendingBurst = true;
    } else if (key === 'Shift' || Object.hasOwn(movementKeys, key)) {
      event.preventDefault();
      keys.add(movementKeys[key] || key);
    }
  });
  document.addEventListener('keyup', event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    keys.delete(movementKeys[key] || key);
  });
  // 第二根手指点灵击 / 低速时，保持第一根手指的拖动。
  canvas.addEventListener('blur', () => keys.clear());
  burstButton.addEventListener('click', () => {
    if (game.phase !== 'playing') return;
    canvas.focus({ preventScroll: true });
    pendingBurst = true;
  });
  focusButton.addEventListener('click', () => {
    if (game.phase !== 'playing') return;
    focusLocked = !focusLocked;
    canvas.focus({ preventScroll: true });
    updateLedger();
  });

  function aim(event) {
    if (event.pointerId !== pointer) return;
    const rect = canvas.getBoundingClientRect();
    const current = { x: event.clientX, y: event.clientY };
    target = engine.dragTarget(target, pointerPoint, current, rect);
    pointerPoint = current;
  }
  canvas.addEventListener('pointerdown', event => {
    if (game.phase !== 'playing' || pointer !== null || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    pointer = event.pointerId;
    pointerPoint = { x: event.clientX, y: event.clientY };
    target = { ...game.player };
    canvas.setPointerCapture(pointer);
  });
  canvas.addEventListener('pointermove', aim);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      if (event.pointerId === pointer) pointer = pointerPoint = target = null;
    });
  }
  draw();
  updateLedger();
  showRanking();
  sprite.addEventListener('load', () => { if (game.phase !== 'playing') draw(); });
})();
