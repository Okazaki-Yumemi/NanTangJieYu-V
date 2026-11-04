'use strict';

(function initLotteryStage() {
  const dialog = document.getElementById('draw-show');
  const title = dialog.querySelector('.draw-show-prize-name');
  const image = dialog.querySelector('.draw-show-prize-art img');
  const viewport = dialog.querySelector('.draw-show-window');
  const reel = dialog.querySelector('.draw-show-reel');
  const status = dialog.querySelector('.draw-show-phase-text');
  const announcement = dialog.querySelector('.draw-show-announcement');
  const ticket = dialog.querySelector('.draw-show-winner');
  const winnerName = dialog.querySelector('.draw-show-winner-name');
  const winnerTeam = dialog.querySelector('.draw-show-winner-team');
  const doors = dialog.querySelector('.draw-show-doors');
  const sparks = dialog.querySelector('.draw-show-sparks');
  const skip = dialog.querySelector('.draw-show-skip');
  const close = dialog.querySelector('.draw-show-close');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const colors = ['#ff86b1', '#ffcf70', '#a6f0c3', '#9fe8ff', '#d9b3ff'];
  let round = null;

  function setPhase(phase, text) {
    dialog.dataset.phase = phase;
    status.textContent = text;
  }

  function open(prize) {
    if (!dialog.showModal || dialog.open) return false;
    reel.replaceChildren();
    reel.style.transform = '';
    sparks.replaceChildren();
    ticket.hidden = true;
    ticket.setAttribute('aria-hidden', 'true');
    delete dialog.dataset.opened;
    announcement.textContent = '';
    skip.hidden = true;
    title.textContent = prize.name;
    image.hidden = !prize.image;
    if (prize.image) image.src = prize.image;
    else image.removeAttribute('src');
    setPhase('arming', '正在抽取');
    dialog.showModal();
    round = { result: null, animation: null };
    return true;
  }

  function makeCard(candidate) {
    const card = document.createElement('div');
    card.className = 'draw-show-card';
    const name = document.createElement('strong');
    const team = document.createElement('small');
    name.textContent = candidate.displayName;
    team.textContent = candidate.team;
    if (candidate.color) card.style.setProperty('--card-ink', candidate.color);
    card.append(name, team);
    return card;
  }

  function makeSparks() {
    const fragment = document.createDocumentFragment();
    const count = viewport.clientWidth < 560 ? 42 : 64;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996;
      const distance = 0.28 + (i % 9) * 0.087;
      const spark = document.createElement('i');
      const kind = i % 7 === 0 ? 'star' : i % 4 === 0 ? 'streamer' : 'foil';
      spark.dataset.kind = kind;
      spark.style.setProperty('--x', `${Math.cos(angle) * distance * 52}vw`);
      spark.style.setProperty('--y', `${Math.sin(angle) * distance * 45 + 4}vh`);
      spark.style.setProperty('--r', `${(i % 2 ? 1 : -1) * (230 + i % 8 * 58)}deg`);
      spark.style.setProperty('--size', `${5 + i % 7 * 1.5}px`);
      spark.style.setProperty('--delay', `${i % 8 * 33}ms`);
      spark.style.setProperty('--flight', `${1450 + i % 7 * 120}ms`);
      spark.style.setProperty('--ink', kind === 'star' ? '#ffe6a4' : colors[i % colors.length]);
      fragment.append(spark);
    }
    sparks.replaceChildren(fragment);
  }

  function reveal() {
    if (!round?.result || !dialog.open || dialog.dataset.phase === 'revealed') return;
    round.animation?.cancel();
    if (!reduced.matches) makeSparks();
    ticket.hidden = false;
    ticket.removeAttribute('aria-hidden');
    skip.hidden = true;
    setPhase('revealed', '结果已揭晓');
    announcement.textContent = `，中奖玩家：${round.result.displayName}`;
    close.focus();
  }

  function isPlaying(current) {
    return round === current && dialog.open && dialog.dataset.phase !== 'revealed';
  }

  async function roll(current, others) {
    // 滚动卡片用于演出，中奖者始终取已经落盘的服务端结果。
    const first = Math.floor(Math.random() * others.length);
    const cards = Array.from({ length: 36 }, (_, index) => makeCard(others[(first + index) % others.length]));
    const winnerIndex = 30;
    cards[winnerIndex] = makeCard(current.result);
    reel.append(...cards);
    const centered = index => viewport.clientWidth / 2 -
      (cards[index].offsetLeft - cards[0].offsetLeft + cards[index].offsetWidth / 2);
    const start = centered(3);
    const braking = centered(winnerIndex - 4);
    reel.style.transform = `translateX(${start}px)`;
    setPhase('rolling', '名单滚动中');

    async function move(from, to, duration, easing) {
      const animation = reel.animate([
        { transform: `translateX(${from}px)` },
        { transform: `translateX(${to}px)` }
      ], { duration, easing, fill: 'forwards' });
      current.animation = animation;
      await animation.finished.catch(() => {});
      if (!isPlaying(current)) return false;
      reel.style.transform = `translateX(${to}px)`;
      animation.cancel();
      return true;
    }

    if (!await move(start, braking, 2130, 'cubic-bezier(0.48, 0.06, 0.29, 0.98)')) return;
    setPhase('locking', '即将揭晓');
    const target = centered(winnerIndex);
    if (!await move(braking, target, 1070, 'cubic-bezier(0.12, 0.68, 0.18, 1)')) return;
    cards[winnerIndex].dataset.winner = '';
    await move(target, target, 190, 'linear');
  }

  async function play(winner, candidates = []) {
    if (!dialog.open || !round) return;
    const current = round;
    current.result = winner;
    title.textContent = winner.prizeName;
    winnerName.textContent = winner.displayName;
    winnerTeam.textContent = winner.team;
    try {
      if (reduced.matches) return;
      skip.hidden = false;
      const others = candidates.filter(candidate => candidate.displayName !== winner.displayName);
      if (reel.animate && others.length) await roll(current, others);
      if (!isPlaying(current)) return;
      ticket.hidden = false;
      setPhase('opening', '后户开启');
      const motions = doors.getAnimations?.({ subtree: true }) || [];
      const finiteMotions = motions.filter(animation =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime)
      );
      await Promise.allSettled(finiteMotions.map(animation => animation.finished));
      if (isPlaying(current)) dialog.dataset.opened = '';
    } finally {
      if (round === current) reveal();
    }
  }

  function fail(message) {
    if (dialog.open) setPhase('error', message);
  }

  image.addEventListener('error', () => { image.hidden = true; });
  close.addEventListener('click', () => dialog.close());
  skip.addEventListener('click', reveal);
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    round?.animation?.cancel();
    round = null;
  });
  reduced.addEventListener('change', event => { if (event.matches) reveal(); });

  NTJ.drawShow = { open, play, fail, isOpen: () => dialog.open };
})();
