(() => {
  'use strict';

  const el = (name) => document.getElementById(`drum-${name}`);
  const chart = el('chart');
  const start = el('start');
  const pause = el('pause');
  const mute = el('mute');
  const notesLayer = el('notes');
  const pads = { d: el('center'), k: el('rim') };
  const keyToDrum = { d: 'd', f: 'd', j: 'k', k: 'k' };
  const songs = [
    {
      file: 'four-seasons', bpm: 92, window: 180,
      bars: ['d...d.k.', 'd.k.d...', 'd.d.k.k.', 'd...k...', 'd.k.d.k.', 'd.d.k...', 'k.k.d.d.', 'd.k.d...'],
      onsets: [1610,1960,2500,2850,3190,3550,3910,4270,4620,4990,5340,5690,6210,6570,7100,7450,7810,8170,8610,9050,9500,9940,10300,10650,11270,11630,12070,12430,12780,13310,13850,14200,14730,15270,15620,15980,16330,16690,17040,17400,17750,18110,18460,18990,19530,19880,20410,20950,21300,21660,22190,22630,23080,23430,23790,24140,24680],
    },
    {
      file: 'hidden-star', bpm: 126, window: 150,
      bars: ['d.k.ddk.', 'k.d.kkd.', 'dkkdd.k.', 'dkd.k.d.', 'dkdkd.k.', 'kddkk.d.', 'ddk.kddk', 'dkdkddk.'],
      onsets: [1360,1780,2140,2700,3210,3570,4110,4640,5000,5560,6070,6420,6970,7320,7850,8390,8750,9280,9820,10350,10710,11240,11780,12140,12500,12860,13220,13570,14730,15360,15710,16070,16430,16790,17140,17680,18210,18570,18930,19290,19640,20000,20360,20690,21070,21430,21780,22140,22680,23030,23390,23730,24110,24640],
    },
  ];
  const lead = 1650;
  const delay = 2100;
  const bestKey = 'ntj-rhythm-best';
  let best = 0;
  try { best = Math.min(10000, Math.max(0, parseInt(localStorage.getItem(bestKey), 10) || 0)); } catch { /* Optional storage. */ }
  let audio;
  let track;
  let muted = false;
  let voices = new Set();
  let run;
  let phase = 'idle';
  let frame;
  let origin;
  let position = 0;
  let audioCursor = 0;

  function enableAudio() {
    if (muted) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio ||= new Audio();
      audio.resume().catch(() => {});
    } catch { /* The visual cues work without audio. */ }
  }

  function tone(at, pitch, duration, volume, type = 'sine', endPitch = pitch) {
    if (muted || audio?.state !== 'running') return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(pitch, at);
    oscillator.frequency.exponentialRampToValueAtTime(endPitch, at + duration);
    gain.gain.setValueAtTime(.001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .007);
    gain.gain.exponentialRampToValueAtTime(.001, at + duration);
    oscillator.connect(gain).connect(audio.destination);
    voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at);
    oscillator.stop(at + duration);
  }

  function stopAudio() {
    for (const voice of voices) voice.stop();
    voices.clear();
  }

  function queueMusic(time) {
    const melody = [293.66, 349.23, 440, 392, 349.23, 261.63, 293.66, 220];
    while (audioCursor < run.beats && delay + audioCursor * run.beat <= time + 85) {
      const offset = delay + audioCursor * run.beat - time;
      if (!muted && audio?.state === 'running' && offset > -55) {
        const at = audio.currentTime + Math.max(0, offset / 1000);
        tone(at, audioCursor % 4 === 0 ? 135 : 97, .065, .065, 'sine', 60);
        if (audioCursor % 2 === 0) tone(at, melody[(audioCursor / 2) % melody.length], .3, .045, 'triangle');
      }
      audioCursor += 1;
    }
  }

  function renderScore() {
    el('score').textContent = run ? Math.round(100 * run.points / run.notes.length) : 0;
    el('combo').textContent = run?.combo || 0;
    el('best').textContent = best;
  }

  function resolve(note, rating) {
    note.done = true;
    note.node?.remove();
    run[rating] += 1;
    if (rating === 'miss') {
      run.combo = 0;
    } else {
      run.combo += 1;
      run.maxCombo = Math.max(run.maxCombo, run.combo);
      run.points += rating === 'perfect' ? 100 : 60;
    }
    el('call').textContent = { perfect: '正中', good: '合拍', miss: '漏拍' }[rating];
    renderScore();
  }

  function hit(kind) {
    if (phase !== 'playing') return;
    const time = clock(performance.now());
    const pad = pads[kind];
    pad.classList.add('active');
    clearTimeout(pad.release);
    pad.release = setTimeout(() => pad.classList.remove('active'), 105);
    if (audio?.state === 'running') tone(audio.currentTime, kind === 'd' ? 153 : 580, .14, .13, kind === 'd' ? 'sine' : 'triangle', kind === 'd' ? 47 : 193);
    let note;
    let distance = run.window;
    for (const entry of run.notes) {
      const gap = Math.abs(entry.at - time);
      if (!entry.done && gap <= distance) {
        note = entry;
        distance = gap;
      }
    }
    if (!note || note.kind !== kind) {
      run.combo = 0;
      el('call').textContent = note ? '敲错了' : '等鼓点';
      renderScore();
      return;
    }
    resolve(note, distance <= run.window * .48 ? 'perfect' : 'good');
  }

  function clock(now) {
    return track ? track.currentTime * 1000 : now - origin;
  }

  function tick(now) {
    if (phase !== 'playing') return;
    if (track?.error || track?.ended) {
      track.pause();
      track = null;
      stopAudio();
      phase = 'finished';
      chart.disabled = false;
      pause.disabled = true;
      start.disabled = false;
      start.textContent = '重新开演';
      el('result').textContent = '本地音轨播放中断。';
      return;
    }
    position = clock(now);
    if (!track) queueMusic(position);
    for (const note of run.notes) {
      if (note.done) continue;
      const distance = note.at - position;
      if (distance < -run.window) {
        resolve(note, 'miss');
      } else if (distance <= lead) {
        if (!note.node) {
          note.node = document.createElement('i');
          note.node.className = `drum-note${note.kind === 'k' ? ' rim' : ''}`;
          notesLayer.append(note.node);
        }
        note.node.style.left = `${18 + distance / lead * 86}%`;
      }
    }
    el('progress').value = Math.min(1, position / run.end);
    if (position < run.end) frame = requestAnimationFrame(tick);
    else finish();
  }

  function finish() {
    phase = 'finished';
    stopAudio();
    track?.pause();
    track = null;
    chart.disabled = false;
    pause.disabled = true;
    start.disabled = false;
    start.textContent = '再敲一曲';
    const score = Math.round(100 * run.points / run.notes.length);
    if (score > best) {
      best = score;
      try { localStorage.setItem(bestKey, String(best)); } catch { /* Optional storage. */ }
    }
    const rank = score >= 9500 ? 'S' : score >= 8000 ? 'A' : score >= 6000 ? 'B' : 'C';
    el('result').textContent = `${rank} 评定 · 正中 ${run.perfect} · 合拍 ${run.good} · 漏拍 ${run.miss} · 最长 ${run.maxCombo} 连击`;
    renderScore();
  }

  async function startTrack(file) {
    const media = new Audio(`/assets/local-rhythm/${file}.mp3`);
    media.muted = muted;
    let timeout;
    try {
      await Promise.race([
        media.play(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Audio unavailable')), 3500); }),
      ]);
      return media;
    } catch {
      media.pause();
      media.removeAttribute('src');
      media.load();
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function begin() {
    const resume = phase === 'paused';
    phase = 'loading';
    chart.disabled = true;
    start.disabled = true;
    el('result').textContent = '正在准备音轨…';
    enableAudio();
    if (!resume) {
      const song = songs[Number(chart.value)];
      track = await startTrack(song.file);
      const beat = 60000 / song.bpm;
      const pattern = song.bars.join('');
      const notes = track
        ? song.onsets.map((at, i) => ({ at, kind: 'ddkdkddk'[i % 8] }))
        : Array.from(pattern, (kind, i) => ({ kind, at: delay + i * beat / 2 })).filter(({ kind }) => kind !== '.');
      const end = track ? 25500 : delay + pattern.length * beat / 2;
      run = { notes, beat, beats: pattern.length / 2, window: song.window, end, points: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0 };
      position = 0;
      audioCursor = 0;
      notesLayer.replaceChildren();
      el('call').textContent = '预备';
      renderScore();
    } else if (track) {
      try { await track.play(); } catch {
        phase = 'paused';
        start.disabled = false;
        el('result').textContent = '音轨未能继续播放，再按一次试试。';
        return;
      }
    }
    phase = 'playing';
    origin = performance.now() - position;
    chart.disabled = true;
    pause.disabled = false;
    start.disabled = true;
    el('result').textContent = track ? '本地曲目 · 前奏节选' : '练习音轨 · 合成伴奏';
    if (document.hidden) { pauseGame(); return; }
    frame = requestAnimationFrame(tick);
  }

  function pauseGame() {
    if (phase !== 'playing') return;
    position = clock(performance.now());
    phase = 'paused';
    cancelAnimationFrame(frame);
    stopAudio();
    track?.pause();
    audioCursor = Math.max(0, Math.ceil((position - delay) / run.beat));
    pause.disabled = true;
    start.disabled = false;
    start.textContent = '继续';
    el('result').textContent = '暂停了。';
  }

  mute.addEventListener('click', () => {
    muted = !muted;
    if (track) track.muted = muted;
    mute.textContent = muted ? '开声' : '静音';
    mute.setAttribute('aria-pressed', String(muted));
    if (muted) stopAudio();
    else enableAudio();
  });
  for (const [kind, pad] of Object.entries(pads)) {
    pad.addEventListener('pointerdown', (event) => { if (event.button === 0) hit(kind); });
    pad.addEventListener('click', (event) => { if (event.detail === 0) hit(kind); });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') pauseGame();
    const kind = keyToDrum[event.key.toLowerCase()];
    if (kind && phase === 'playing' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      hit(kind);
    }
  });
  start.addEventListener('click', begin);
  pause.addEventListener('click', pauseGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  renderScore();
})();
