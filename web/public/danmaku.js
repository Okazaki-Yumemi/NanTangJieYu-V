(() => {
  'use strict';

  const byId = (name) => document.getElementById(`firefly-${name}`);
  const canvas = byId('field');
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const start = byId('start');
  const pause = byId('pause');
  const curtain = byId('curtain');
  const keys = new Set();
  const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const player = { x: 180, y: 324 };
  const storageKey = 'ntj-firefly-best';
  let best = 0;
  try { best = Math.max(0, Number(localStorage.getItem(storageKey)) || 0); } catch { /* Storage is optional. */ }
  let phase = 'ready';
  let score = 0;
  let elapsed = 0;
  let nextWave = 0;
  let wave = 0;
  let bullets = [];
  let lantern;
  let pointer = null;
  let target = null;
  let frame;
  let last;

  function spawnLantern() {
    lantern = { x: 35 + Math.random() * 290, y: 138 + Math.random() * 215 };
  }

  function draw() {
    ctx.fillStyle = '#23273b';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ae866b';
    ctx.beginPath();
    ctx.arc(180, 58, 31, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 30; i += 1) {
      ctx.fillStyle = i % 3 ? '#59617a' : '#af9a86';
      ctx.fillRect((i * 73 + 21) % width, (i * 43 + 12) % height, 2, 2);
    }
    ctx.fillStyle = '#2e374a';
    ctx.beginPath();
    ctx.moveTo(0, 147);
    ctx.lineTo(45, 113);
    ctx.lineTo(109, 150);
    ctx.lineTo(177, 106);
    ctx.lineTo(231, 148);
    ctx.lineTo(311, 112);
    ctx.lineTo(width, 141);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();
    ctx.strokeStyle = '#394657';
    for (let i = 0; i < 12; i += 1) {
      const x = (i * 67) % width;
      const y = 171 + i * 17;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18 + i * 2, y);
      ctx.stroke();
    }
    for (const bullet of bullets) {
      ctx.fillStyle = '#ed9b9e';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a74f64';
      ctx.fillRect(bullet.x - 1, bullet.y - 1, 2, 2);
    }
    if (lantern) {
      ctx.fillStyle = '#ffd27f35';
      ctx.fillRect(lantern.x - 10, lantern.y - 10, 20, 20);
      ctx.fillStyle = '#ffd27f';
      ctx.fillRect(lantern.x - 5, lantern.y - 6, 10, 12);
      ctx.fillStyle = '#fff0b0';
      ctx.fillRect(lantern.x - 2, lantern.y - 3, 4, 6);
    }
    ctx.fillStyle = '#ffe7ba';
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - 10);
    ctx.lineTo(player.x + 10, player.y + 7);
    ctx.lineTo(player.x, player.y + 4);
    ctx.lineTo(player.x - 10, player.y + 7);
    ctx.fill();
    ctx.fillStyle = '#b65a60';
    ctx.fillRect(player.x - 2, player.y - 2, 4, 4);
  }

  function updateLedger() {
    byId('score').textContent = score;
    byId('time').textContent = Math.max(0, Math.ceil(30 - elapsed));
    byId('best').textContent = best;
  }

  function releaseInput() {
    keys.clear();
    pointer = null;
    target = null;
  }

  function end(message, nextPhase) {
    phase = nextPhase;
    cancelAnimationFrame(frame);
    releaseInput();
    if (score > best) {
      best = score;
      try { localStorage.setItem(storageKey, String(best)); } catch { /* Play works without storage. */ }
    }
    updateLedger();
    curtain.classList.remove('hidden');
    byId('result').textContent = message;
    start.textContent = phase === 'paused' ? '继续' : '再来一次';
    pause.disabled = true;
    start.focus({ preventScroll: true });
  }

  function addWave() {
    const origin = 180 + Math.sin(wave * 1.33) * 104;
    const count = elapsed < 9 ? 5 : 7;
    const speed = 83 + elapsed * 1.8;
    const drift = Math.sin(wave * 1.9) * .25;
    for (let i = 0; i < count; i += 1) {
      const angle = drift + (i - (count - 1) / 2) * .25;
      bullets.push({ x: origin, y: -6, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed });
    }
    wave += 1;
    nextWave += Math.max(.5, 1.14 - elapsed * .019);
  }

  function movePlayer(dt) {
    const dx = target ? target.x - player.x : Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    const dy = target ? target.y - player.y : Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
    const distance = Math.hypot(dx, dy);
    if (!distance) return;
    const step = target ? Math.min(distance, 255 * dt) : 185 * dt;
    player.x = Math.max(9, Math.min(width - 9, player.x + dx / distance * step));
    player.y = Math.max(9, Math.min(height - 9, player.y + dy / distance * step));
  }

  function tick(now) {
    if (phase !== 'playing') return;
    const dt = Math.min(.033, (now - last) / 1000);
    last = now;
    elapsed += dt;
    if (elapsed >= nextWave) addWave();
    movePlayer(dt);
    for (const bullet of bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
    }
    bullets = bullets.filter(({ x, y }) => x > -8 && x < width + 8 && y < height + 8);
    if (Math.hypot(player.x - lantern.x, player.y - lantern.y) < 15) {
      score += 1;
      spawnLantern();
    }
    draw();
    updateLedger();
    if (bullets.some(({ x, y }) => Math.hypot(player.x - x, player.y - y) < 8)) {
      end(`撞上弹幕 · 拾得 ${score} 盏`, 'over');
    } else if (elapsed >= 30) {
      end(`顺利过关 · 拾得 ${score} 盏`, 'over');
    } else {
      frame = requestAnimationFrame(tick);
    }
  }

  start.addEventListener('click', () => {
    if (phase !== 'paused') {
      score = 0;
      elapsed = 0;
      nextWave = .7;
      wave = 0;
      bullets = [];
      Object.assign(player, { x: 180, y: 324 });
      spawnLantern();
    }
    phase = 'playing';
    curtain.classList.add('hidden');
    pause.disabled = false;
    canvas.focus({ preventScroll: true });
    last = performance.now();
    frame = requestAnimationFrame(tick);
  });

  function pauseGame() {
    if (phase === 'playing') end('暂停', 'paused');
  }

  pause.addEventListener('click', pauseGame);
  window.addEventListener('blur', pauseGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  canvas.addEventListener('keydown', (event) => {
    if (phase !== 'playing') return;
    if (event.key === 'Escape') pauseGame();
    if (!arrows.includes(event.key)) return;
    event.preventDefault();
    keys.add(event.key);
  });
  canvas.addEventListener('keyup', (event) => keys.delete(event.key));
  canvas.addEventListener('blur', releaseInput);

  function aim(event) {
    if (event.pointerId !== pointer) return;
    const rect = canvas.getBoundingClientRect();
    target = {
      x: (event.clientX - rect.left) * width / rect.width,
      y: (event.clientY - rect.top) * height / rect.height - (event.pointerType === 'touch' ? 21 : 0),
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (phase !== 'playing' || pointer !== null || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    aim(event);
  });
  canvas.addEventListener('pointermove', aim);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, (event) => {
      if (event.pointerId === pointer) {
        pointer = null;
        target = null;
      }
    });
  }

  draw();
  updateLedger();
})();
