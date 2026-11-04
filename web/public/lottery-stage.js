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
  const sparks = dialog.querySelector('.draw-show-sparks');
  const skip = dialog.querySelector('.draw-show-skip');
  const close = dialog.querySelector('.draw-show-close');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const colors = ['#f181a4', '#f6c975', '#8ed9b8', '#8fccec', '#c6a5f5'];
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
    for (let i = 0; i < 30; i++) {
      const angle = i * (Math.PI * 2 / 30);
      const distance = 0.5 + (i % 4) * 0.16;
      const spark = document.createElement('i');
      spark.style.setProperty('--x', `${Math.cos(angle) * distance * 40}vw`);
      spark.style.setProperty('--y', `${Math.sin(angle) * distance * 31}vh`);
      spark.style.setProperty('--r', `${i * 53}deg`);
      spark.style.setProperty('--delay', `${i % 5 * 28}ms`);
      spark.style.setProperty('--ink', colors[i % colors.length]);
      fragment.append(spark);
    }
    sparks.replaceChildren(fragment);
  }

  function reveal() {
    if (!round?.result || !dialog.open || dialog.dataset.phase === 'revealed') return;
    round.animation?.cancel();
    const { displayName, team } = round.result;
    winnerName.textContent = displayName;
    winnerTeam.textContent = team;
    if (!reduced.matches) makeSparks();
    ticket.hidden = false;
    skip.hidden = true;
    setPhase('revealed', '结果已揭晓');
    announcement.textContent = `，中奖玩家：${displayName}`;
    close.focus();
  }

  async function play(winner, candidates = []) {
    if (!dialog.open || !round) return;
    const current = round;
    current.result = winner;
    title.textContent = winner.prizeName;
    try {
      // 这里只编排滚动卡片。中奖者始终来自已经落盘的服务端结果。
      const others = candidates.filter(candidate => candidate.displayName !== winner.displayName);
      if (reduced.matches || !reel.animate || !others.length) return;
      const first = Math.floor(Math.random() * others.length);
      const nextCard = index => others[(first + index) % others.length];
      const cards = Array.from({ length: 36 }, (_, index) => makeCard(nextCard(index)));
      const winnerIndex = 30;
      cards[winnerIndex] = makeCard(winner);
      reel.append(...cards);
      const centered = index => viewport.clientWidth / 2 -
        (cards[index].offsetLeft - cards[0].offsetLeft + cards[index].offsetWidth / 2);
      const start = centered(3);
      const braking = centered(winnerIndex - 4);
      reel.style.transform = `translateX(${start}px)`;
      skip.hidden = false;
      setPhase('rolling', '名单滚动中');

      async function move(from, to, duration, easing) {
        const animation = reel.animate([
          { transform: `translateX(${from}px)` },
          { transform: `translateX(${to}px)` }
        ], { duration, easing, fill: 'forwards' });
        current.animation = animation;
        await animation.finished.catch(() => {});
        if (round !== current || !dialog.open || dialog.dataset.phase === 'revealed') return false;
        reel.style.transform = `translateX(${to}px)`;
        animation.cancel();
        return true;
      }

      if (!await move(start, braking, 2280, 'cubic-bezier(0.48, 0.06, 0.29, 0.98)')) return;
      setPhase('locking', '即将揭晓');
      const target = centered(winnerIndex);
      if (!await move(braking, target, 1120, 'cubic-bezier(0.12, 0.68, 0.18, 1)')) return;
      cards[winnerIndex].dataset.winner = '';
      await move(target, target, 250, 'linear');
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
