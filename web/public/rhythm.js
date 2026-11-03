(() => {
  'use strict';

  const el = (name) => document.getElementById(`drum-${name}`);
  const chart = el('chart');
  const difficulty = el('level');
  const source = el('source');
  const volumeControl = el('volume');
  const start = el('start');
  const pause = el('pause');
  const mute = el('mute');
  const notesLayer = el('notes');
  const pads = { d: el('center'), k: el('rim') };
  const keyToDrum = { d: 'd', f: 'd', j: 'k', k: 'k' };
  const songs = [
    {
      file: 'four-seasons', bpm: 92,
      phrases: ['ddkdkddk', 'kkdkkddk', 'ddkkdkkd', 'dkdkddkk', 'kdkddkdk', 'dddkddkk', 'kkdkddkk', 'dkdkkddk'],
      bars: ['d...d.k.', 'd.k.d...', 'd.d.k.k.', 'd...k...', 'd.k.d.k.', 'd.d.k...', 'k.k.d.d.', 'd.k.d...'],
    },
    {
      file: 'hidden-star', bpm: 126,
      phrases: ['dkdkkddd', 'kddkdkdk', 'ddkkdkdd', 'kkddkdkd', 'dkddkddk', 'kkdkdddk', 'dkdkkddk'],
      bars: ['d.k.ddk.', 'k.d.kkd.', 'dkkdd.k.', 'dkd.k.d.', 'dkdkd.k.', 'kddkk.d.', 'ddk.kddk', 'dkdkddk.'],
    },
  ];
  const levels = {
    normal: { window: 155, perfect: 68, lead: 1650, salience: 3, spacing: 420, description: '主拍 · 单击' },
    hard: { window: 108, perfect: 43, lead: 1330, salience: 2, spacing: 270, description: '切分 · 单击' },
    expert: { window: 75, perfect: 29, lead: 1060, salience: 1, spacing: 190, description: '交替 · 双击' },
    master: { window: 63, perfect: 25, lead: 970, salience: 0, spacing: 148, description: '密集连打 · 双击' },
    lunatic: { window: 49, perfect: 19, lead: 880, salience: 0, spacing: 105, description: '全量起音 · 连续双击' },
  };
  const delay = 2100;
  const recordedRoundMs = 180000;
  const bestKey = 'ntj-rhythm-best';
  const bestModesKey = 'ntj-rhythm-bests-v2';
  let bestByMode = {};
  let volume = 0.35;
  try {
    bestByMode = JSON.parse(localStorage.getItem(bestModesKey)) || {};
    const stored = localStorage.getItem('ntj-rhythm-volume');
    if (stored !== null && Number.isFinite(Number(stored))) volume = Math.max(0, Math.min(1, Number(stored)));
  } catch { /* Optional storage. */ }
  let audio;
  let master;
  let track;
  let loadingTrack;
  const routedTracks = new WeakMap();
  let muted = false;
  let voices = new Set();
  let run;
  let phase = 'idle';
  let frame;
  let origin;
  let position = 0;
  let audioCursor = 0;

  function modeId(song = songs[Number(chart.value)], level = difficulty.value, audioSource = source.value) {
    const board = audioSource === 'original' ? 'original-3m' : audioSource;
    return `${song.file}-${level}-${board}`;
  }

  function formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function compileRecorded(song, level) {
    const settings = levels[level];
    const recording = window.NTJRhythmTracks[song.file];
    const end = Math.min(recordedRoundMs, recording.duration);
    const phrase = song.phrases.join('');
    const notes = [];
    let last = -Infinity;
    for (const [i, [at, salience, bass]] of recording.hits.entries()) {
      if (at + settings.window > end) break;
      if (at - last < settings.spacing || salience < settings.salience && at - last < 1400) continue;
      const section = Math.floor(at / 14000);
      const kind = bass ? 'd' : phrase[(i + section * 5) % phrase.length];
      const chord = salience === 3 && (
        level === 'expert' && i % 13 === 0 ||
        level === 'master' && i % 6 === 0 ||
        level === 'lunatic' && (bass || i % 3 === 0)
      );
      notes.push({ at, kind, chord });
      if (chord) notes.push({ at, kind: kind === 'd' ? 'k' : 'd', chord: true });
      last = at;
    }
    return { ...settings, notes, end };
  }

  function compileChart(song, level, recorded) {
    if (recorded) return compileRecorded(song, level);
    const beat = 60000 / song.bpm;
    const pattern = song.bars.join('');
    const base = Array.from(pattern, (kind, i) => ({ kind, at: delay + i * beat / 2 })).filter(({ kind }) => kind !== '.');
    const notes = [];
    for (const [i, note] of base.entries()) {
      const accent = i % 8 === 6;
      if (level === 'normal' && i % 2 !== 0 && !accent) continue;
      const chord = ['expert', 'master', 'lunatic'].includes(level) && (accent || level === 'lunatic' && i % 3 === 0);
      notes.push({ ...note, chord });
      if (chord) notes.push({ at: note.at, kind: note.kind === 'd' ? 'k' : 'd', chord: true });
      const next = base[i + 1];
      if (!['expert', 'master', 'lunatic'].includes(level) || !next || level === 'expert' && ![1, 2, 3, 6].includes(i % 8)) continue;
      const gap = next.at - note.at;
      // The recorded phrases follow the audible onset grid. Fill selected gaps with
      // drum answers on that grid, leaving the ends of phrases open to breathe.
      const fillable = gap >= 225 && gap <= beat * 1.51;
      if (fillable) {
        const subdivisions = level === 'lunatic' && gap >= 340 ? 3 : 2;
        for (let part = 1; part < subdivisions; part += 1) {
          const kind = part % 2 ? (note.kind === 'd' ? 'k' : 'd') : note.kind;
          notes.push({ at: note.at + Math.round(gap * part / subdivisions), kind });
        }
      }
    }
    return { notes, beat, beats: pattern.length / 2, end: delay + pattern.length * beat / 2, ...levels[level] };
  }

  function showChartInfo() {
    const song = songs[Number(chart.value)];
    const level = difficulty.value;
    const { notes, description, end } = compileChart(song, level, source.value === 'original');
    el('chart-info').textContent = `${formatTime(end)} · ${notes.length} 击 · ${description}`;
    el('best').textContent = bestByMode[modeId()] || 0;
    window.NTJArcadeScores?.mount(el('leaderboard'), 'rhythm', modeId());
  }

  function onSelectionChange() {
    run = null;
    el('progress').value = 0;
    start.textContent = '开演';
    el('call').textContent = '起鼓';
    delete el('call').dataset.rating;
    el('result').textContent = '选好曲目，按开演。';
    showChartInfo();
    renderScore();
  }

  function enableSelection(enabled) {
    chart.disabled = !enabled;
    difficulty.disabled = !enabled;
    source.disabled = !enabled;
  }

  function enableAudio() {
    if (muted) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio ||= new Audio();
      if (!master) {
        master = audio.createGain();
        master.connect(audio.destination);
      }
      master.gain.value = volume;
      audio.resume().catch(() => {});
    } catch { /* The visual cues work without audio. */ }
  }

  function setTrackVolume(media) {
    if (audio && master && !routedTracks.has(media)) {
      try {
        const input = audio.createMediaElementSource(media);
        input.connect(master);
        routedTracks.set(media, input);
      } catch { /* Older browsers can still use the media volume property. */ }
    }
    media.muted = muted;
    media.volume = routedTracks.has(media) ? 1 : volume;
  }

  function stopTrack(media) {
    if (!media) return;
    media.pause();
    routedTracks.get(media)?.disconnect();
    media.removeAttribute('src');
    media.load();
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
    oscillator.connect(gain).connect(master);
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
    el('score').textContent = run ? pointsForRun() : 0;
    el('combo').textContent = run?.combo || 0;
    el('best').textContent = bestByMode[modeId()] || 0;
  }

  function pointsForRun() {
    return Math.round((90 * run.points + 1000 * run.maxCombo) / run.notes.length);
  }

  function showJudgment(kind, rating, timing) {
    const call = el('call');
    const trackView = el('track');
    const label = { perfect: '正中', good: '合拍', miss: '漏拍', empty: '空击' }[rating];
    call.textContent = timing ? `${label} · ${timing}` : label;
    call.dataset.rating = rating;
    const pad = pads[kind];
    const lane = kind === 'd' ? 'centerJudgment' : 'rimJudgment';
    trackView.dataset[lane] = rating;
    clearTimeout(pad.judgmentTimer);
    pad.judgmentTimer = setTimeout(() => { delete trackView.dataset[lane]; }, 170);
    if (rating === 'miss') return;
    pad.dataset.judgment = rating;
    clearTimeout(pad.release);
    pad.release = setTimeout(() => { delete pad.dataset.judgment; }, 145);
  }

  function resolve(note, rating, timing) {
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
    showJudgment(note.kind, rating, timing);
    renderScore();
  }

  function hit(kind) {
    if (phase !== 'playing') return;
    const time = clock(performance.now());
    if (audio?.state === 'running') tone(audio.currentTime, kind === 'd' ? 153 : 580, .14, .13, kind === 'd' ? 'sine' : 'triangle', kind === 'd' ? 47 : 193);
    let note;
    let distance = run.window;
    for (let index = run.firstPending; index < run.notes.length; index += 1) {
      const entry = run.notes[index];
      if (entry.at > time + run.window) break;
      const gap = Math.abs(entry.at - time);
      if (!entry.done && entry.kind === kind && gap <= distance) {
        note = entry;
        distance = gap;
      }
    }
    if (!note) {
      run.combo = 0;
      showJudgment(kind, 'empty');
      renderScore();
      return;
    }
    const rating = distance <= run.perfectWindow ? 'perfect' : 'good';
    resolve(note, rating, rating === 'good' ? (time < note.at ? '偏早' : '偏晚') : '');
  }

  function clock(now) {
    return track ? track.currentTime * 1000 : now - origin;
  }

  function tick(now) {
    if (phase !== 'playing') return;
    if (track?.ended && track.currentTime >= run.end / 1000 - .75) {
      finish();
      return;
    }
    if (track?.error || track?.ended) {
      stopTrack(track);
      track = null;
      stopAudio();
      phase = 'finished';
      enableSelection(true);
      pause.disabled = true;
      start.disabled = false;
      start.textContent = '重新开演';
      el('result').textContent = '本地音轨播放中断。';
      return;
    }
    position = clock(now);
    if (!track) queueMusic(position);
    for (let index = run.firstPending; index < run.notes.length; index += 1) {
      const note = run.notes[index];
      if (note.at > position + run.lead) break;
      if (note.done) continue;
      const distance = note.at - position;
      if (distance < -run.window) {
        resolve(note, 'miss');
      } else if (distance <= run.lead) {
        if (!note.node) {
          note.node = document.createElement('i');
          note.node.className = `drum-note${note.kind === 'k' ? ' rim' : ''}${note.chord ? ' chord' : ''}`;
          notesLayer.append(note.node);
        }
        note.node.style.left = `${18 + distance / run.lead * 86}%`;
      }
    }
    while (run.notes[run.firstPending]?.done) run.firstPending += 1;
    el('progress').value = Math.min(1, position / run.end);
    if (position < run.end) frame = requestAnimationFrame(tick);
    else finish();
  }

  function finish() {
    while (run.firstPending < run.notes.length) {
      const note = run.notes[run.firstPending++];
      if (!note.done) resolve(note, 'miss');
    }
    phase = 'finished';
    stopAudio();
    stopTrack(track);
    track = null;
    enableSelection(true);
    pause.disabled = true;
    start.disabled = false;
    start.textContent = '再敲一曲';
    const score = pointsForRun();
    if (score > (bestByMode[run.mode] || 0)) {
      bestByMode[run.mode] = score;
      try {
        localStorage.setItem(bestModesKey, JSON.stringify(bestByMode));
        const previous = Number(localStorage.getItem(bestKey)) || 0;
        if (score > previous) localStorage.setItem(bestKey, String(score));
      } catch { /* Optional storage. */ }
    }
    const rank = score >= 9500 ? 'S' : score >= 8000 ? 'A' : score >= 6000 ? 'B' : 'C';
    const accuracy = (run.points / run.notes.length).toFixed(1);
    el('result').textContent = `${rank} 评定 · 准确率 ${accuracy}% · 正中 ${run.perfect} · 合拍 ${run.good} · 漏拍 ${run.miss} · 最长 ${run.maxCombo} 连击`;
    if (score > 0) window.NTJArcadeScores?.submit('rhythm', { mode: run.mode, score });
    renderScore();
  }

  async function startTrack(file) {
    const media = new Audio(`/assets/local-rhythm/${file}.mp3`);
    loadingTrack = media;
    setTrackVolume(media);
    let timeout;
    try {
      await Promise.race([
        media.play(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Audio unavailable')), 3500); }),
      ]);
      setTrackVolume(media);
      return media;
    } catch {
      stopTrack(media);
      return null;
    } finally {
      loadingTrack = null;
      clearTimeout(timeout);
    }
  }

  async function begin() {
    const resume = phase === 'paused';
    phase = 'loading';
    enableSelection(false);
    start.disabled = true;
    el('result').textContent = '正在准备音轨…';
    enableAudio();
    if (!resume) {
      const song = songs[Number(chart.value)];
      track = source.value === 'original' ? await startTrack(song.file) : null;
      if (!track) source.value = 'practice';
      const { perfect: perfectWindow, ...compiled } = compileChart(song, difficulty.value, Boolean(track));
      run = { ...compiled, perfectWindow, mode: modeId(), firstPending: 0, points: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0 };
      showChartInfo();
      position = 0;
      audioCursor = 0;
      notesLayer.replaceChildren();
      el('call').textContent = '预备';
      delete el('call').dataset.rating;
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
    enableSelection(false);
    pause.disabled = false;
    start.disabled = true;
    el('result').textContent = track ? '原曲 · 3 分钟演奏' : '短谱练习 · 合成伴奏';
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
    mute.textContent = muted ? '开声' : '静音';
    mute.setAttribute('aria-pressed', String(muted));
    if (muted) stopAudio();
    else enableAudio();
    if (track || loadingTrack) setTrackVolume(track || loadingTrack);
  });
  volumeControl.value = Math.round(volume * 100);
  el('volume-value').textContent = `${volumeControl.value}%`;
  volumeControl.addEventListener('input', () => {
    volume = Number(volumeControl.value) / 100;
    el('volume-value').textContent = `${volumeControl.value}%`;
    if (master) master.gain.value = volume;
    if (track || loadingTrack) setTrackVolume(track || loadingTrack);
    try { localStorage.setItem('ntj-rhythm-volume', String(volume)); } catch { /* Optional storage. */ }
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
  chart.addEventListener('change', onSelectionChange);
  difficulty.addEventListener('change', onSelectionChange);
  source.addEventListener('change', onSelectionChange);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  showChartInfo();
  renderScore();
})();
