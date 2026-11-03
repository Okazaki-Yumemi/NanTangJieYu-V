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
  const sprite = new Image();
  sprite.src = '/assets/reimu-survivors.png';
  const mode = byId('mode');
  const duration = 36;
  const patterns = ['一符 · 花雨', '二符 · 横流', '三符 · 星环'];
  const colors = ['#ff9eaa', '#94d9ee', '#e0a6f4'];
  let expert = false;
  let best = readBest();
  let phase = 'ready';
  let score = 0;
  let lampPoints = 0;
  let clearPoints = 0;
  let runId = 0;
  let lamps = 0;
  let spellLamps = 0;
  let spell = 0;
  let grazes = 0;
  let guard = 0;
  let invulnerableUntil = 0;
  let chain = 0;
  let lastLamp = -Infinity;
  let notes = [];
  let elapsed = 0;
  let nextWave = 0;
  let wave = 0;
  let bullets = [];
  let warning = null;
  let lantern;
  let pointer = null;
  let target = null;
  let frame;
  let last;

  function scoreKey() {
    return expert ? 'ntj-firefly-expert-v1' : 'ntj-firefly-score-v2';
  }

  function readBest() {
    try { return Math.max(0, Number(localStorage.getItem(scoreKey())) || 0); } catch { return 0; }
  }

  function spawnLantern() {
    const half = player.x > width / 2 ? 28 : width / 2 + 30;
    lantern = { x: half + Math.random() * 115, y: 124 + Math.random() * 232 };
  }

  function draw() {
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
    byId('score').textContent = score;
    byId('time').textContent = Math.max(0, Math.ceil(duration - elapsed));
    byId('best').textContent = best;
    byId('chain').textContent = `×${elapsed - lastLamp < 4 ? Math.min(chain + 1, 4) : 1}`;
    const pattern = expert ? `${patterns[spell]} · 灯火 ${Math.min(spellLamps, 2)}/2` : patterns[spell];
    if (byId('pattern').textContent !== pattern) byId('pattern').textContent = pattern;
    byId('guard').textContent = guard === 8 ? '护身符就绪' : `护身符 ${guard}/8`;
  }

  function releaseInput() {
    keys.clear();
    pointer = null;
    target = null;
  }

  function rankingMode() {
    return expert ? 'expert' : 'normal';
  }

  function showRanking() {
    window.NTJArcadeScores?.mount(byId('ranking'), 'danmaku', rankingMode());
  }

  async function submitResult(cleared) {
    if (!window.NTJArcadeScores || score === 0) return;
    const finishedRun = runId;
    const status = byId('ranking-status');
    status.textContent = '正在保存成绩…';
    const result = await window.NTJArcadeScores.submit('danmaku', {
      mode: rankingMode(),
      score,
      detail: `${cleared ? '全符卡通过 · ' : ''}${lamps} 盏灯 · 擦弹 ${grazes} 次`,
    });
    if (finishedRun !== runId) return;
    status.textContent = result.message || (result.improved ? '已刷新榜上纪录。' : '已保留你的榜上最佳。');
  }

  function end(message, nextPhase, cleared = false) {
    phase = nextPhase;
    cancelAnimationFrame(frame);
    releaseInput();
    if (nextPhase === 'over' && score > best) {
      best = score;
      try { localStorage.setItem(scoreKey(), String(best)); } catch { /* Play works without storage. */ }
    }
    updateLedger();
    curtain.classList.remove('hidden');
    byId('result').textContent = message;
    const finished = nextPhase === 'over';
    byId('detail').textContent = finished ? `${score} 分 · 拾灯 ${lamps} 盏 · 擦弹 ${grazes} 次` : '离开时会自动暂停';
    byId('breakdown').classList.toggle('hidden', !finished);
    if (finished) {
      byId('lamp-points').textContent = lampPoints;
      byId('graze-points').textContent = grazes * 2;
      byId('clear-points').textContent = clearPoints;
      void submitResult(cleared);
    }
    start.textContent = phase === 'paused' ? '继续' : '再来一次';
    pause.disabled = true;
    mode.disabled = nextPhase === 'paused';
    start.focus({ preventScroll: true });
  }

  function planWave() {
    const pattern = Math.min(2, Math.floor(nextWave / 12));
    const shots = [];
    const launch = (x, y, angle, speed) => {
      shots.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color: colors[pattern] });
    };
    if (pattern === 0) {
      const x = 180 + Math.sin(wave * 1.33) * 104;
      for (let i = -2; i <= 2; i += 1) launch(x, 4, Math.PI / 2 + i * .24, 111);
    } else if (pattern === 1) {
      const side = wave % 2;
      const gap = (wave * 3) % 8;
      for (let i = 0; i < 9; i += 1) {
        if (i === gap || i === gap + 1) continue;
        launch(side ? width - 3 : 3, 33 + i * 43, side ? Math.PI : 0, 148);
      }
    } else {
      const x = 180 + Math.sin(wave * 1.46) * 92;
      const y = 98 + Math.cos(wave * 1.2) * 33;
      for (let i = 0; i < 12; i += 1) launch(x, y, i * Math.PI / 6 + wave * .22, 115);
    }
    if (expert && wave % 2 === 0) {
      // Aim once, when the warning appears. Moving during the warning opens a lane.
      const x = wave % 4 ? 4 : width - 4;
      const y = pattern === 1 ? 4 : 64;
      const aim = Math.atan2(player.y - y, player.x - x);
      for (let i = -1; i <= 1; i += 1) launch(x, y, aim + i * .19, 151);
    }
    return shots;
  }

  function updateWave() {
    if (!warning && elapsed >= nextWave - .42) warning = planWave();
    if (elapsed < nextWave) return;
    bullets.push(...warning);
    warning = null;
    wave += 1;
    const interval = elapsed < 12 ? 1.08 : elapsed < 24 ? 1.4 : 1.22;
    nextWave += interval * (expert ? .83 : 1);
  }

  function award(points) {
    score += points;
    notes.push({ x: player.x, y: player.y, label: `+${points}`, at: elapsed });
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
    updateWave();
    movePlayer(dt);
    for (const bullet of bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
    }
    bullets = bullets.filter(({ x, y }) => x > -12 && x < width + 12 && y > -12 && y < height + 12);
    notes = notes.filter((note) => elapsed - note.at < 1);
    let hit = false;
    if (elapsed >= invulnerableUntil) {
      for (const bullet of bullets) {
        const distance = Math.hypot(player.x - bullet.x, player.y - bullet.y);
        if (distance < 8) {
          hit = true;
          break;
        }
        if (distance < 21 && !bullet.grazed) {
          bullet.grazed = true;
          grazes += 1;
          guard = Math.min(8, guard + 1);
          award(2);
        }
      }
    }
    if (hit && guard === 8) {
      guard = 0;
      invulnerableUntil = elapsed + 1.1;
      bullets = bullets.filter(({ x, y }) => Math.hypot(player.x - x, player.y - y) > 38);
      hit = false;
    }
    if (Math.hypot(player.x - lantern.x, player.y - lantern.y) < 15) {
      lamps += 1;
      spellLamps += 1;
      chain = elapsed - lastLamp < 4 ? Math.min(4, chain + 1) : 1;
      lastLamp = elapsed;
      lampPoints += chain * 10;
      award(chain * 10);
      spawnLantern();
    }
    const boundary = elapsed >= (spell + 1) * 12;
    const missedQuota = expert && boundary && spellLamps < 2;
    if (boundary && !missedQuota && spell < 2) {
      if (expert) {
        clearPoints += 30;
        award(30);
      }
      spell += 1;
      spellLamps = 0;
    }
    draw();
    updateLedger();
    if (hit) {
      end('撞上弹幕', 'over');
    } else if (missedQuota) {
      end(`${patterns[spell]}未破，少了灯火`, 'over');
    } else if (elapsed >= duration) {
      clearPoints += 50;
      award(50);
      end('三道符卡全部通过', 'over', true);
    } else {
      frame = requestAnimationFrame(tick);
    }
  }

  start.addEventListener('click', () => {
    if (phase !== 'paused') {
      runId += 1;
      byId('ranking-status').textContent = '';
      score = 0;
      lampPoints = clearPoints = 0;
      lamps = 0;
      spellLamps = 0;
      spell = 0;
      grazes = 0;
      guard = 0;
      chain = 0;
      lastLamp = -Infinity;
      invulnerableUntil = 0;
      warning = null;
      notes = [];
      elapsed = 0;
      nextWave = .7;
      wave = 0;
      bullets = [];
      Object.assign(player, { x: 180, y: 324 });
      spawnLantern();
    }
    phase = 'playing';
    mode.disabled = true;
    curtain.classList.add('hidden');
    pause.disabled = false;
    canvas.focus({ preventScroll: true });
    last = performance.now();
    frame = requestAnimationFrame(tick);
  });

  mode.addEventListener('change', () => {
    runId += 1;
    byId('ranking-status').textContent = '';
    byId('breakdown').classList.add('hidden');
    expert = mode.value === 'expert';
    best = readBest();
    phase = 'ready';
    elapsed = score = spell = spellLamps = guard = 0;
    bullets = [];
    notes = [];
    warning = lantern = null;
    invulnerableUntil = 0;
    Object.assign(player, { x: 180, y: 324 });
    byId('result').textContent = expert ? '符卡试炼' : '月下拾灯';
    byId('detail').textContent = expert ? '每道符卡限时 12 秒，至少拾两盏灯。虚线瞄准出现后，记得换位。' : '穿过三道符卡，撑过 36 秒。';
    start.textContent = '开始';
    updateLedger();
    draw();
    showRanking();
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
  showRanking();
  sprite.addEventListener('load', () => { if (phase !== 'playing') draw(); });
})();
