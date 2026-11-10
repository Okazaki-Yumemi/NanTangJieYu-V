(() => {
  'use strict';

  const views = new Map();
  let poll = null;
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = '/arcade-scores.css?v=1';
  document.head.append(sheet);

  async function request(path, body, signal) {
    const options = body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : { cache: 'no-store' };
    const response = await fetch(path, { ...options, signal });
    const payload = await response.json();
    return { ...payload, ok: response.ok };
  }

  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value) element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function formatScore(game, score) {
    if (game === 'puzzle') return `${100000 - score} 步`;
    if (game === 'dye') return `${100 - score} 步`;
    return `${new Intl.NumberFormat('zh-CN').format(score)} 分`;
  }

  async function load(container, view) {
    view.controller?.abort();
    const controller = new AbortController();
    view.controller = controller;
    const isCurrent = () => views.get(container) === view && view.controller === controller;
    try {
      const query = new URLSearchParams({ game: view.game, mode: view.mode });
      const result = await request(`/api/arcade/leaderboard?${query}`, undefined, controller.signal);
      if (!isCurrent()) return;
      view.list.replaceChildren();
      if (!result.ok) {
        view.status.textContent = result.message || '暂时无法读取排行榜。';
        return;
      }
      view.status.textContent = result.rows.length ? '' : '这张榜还没有成绩。';
      const fragment = document.createDocumentFragment();
      for (const row of result.rows) {
        const item = node('li');
        const rank = node('span', String(row.rank), 'arcade-score-rank');
        rank.setAttribute('aria-hidden', 'true');
        item.append(rank, node('span', row.display_name), node('strong', formatScore(view.game, row.score)));
        fragment.append(item);
      }
      view.list.append(fragment);
    } catch {
      if (!isCurrent() || controller.signal.aborted) return;
      view.list.replaceChildren();
      view.status.textContent = '暂时无法读取排行榜。';
    }
  }

  async function mount(target, game, mode) {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return;
    views.get(container)?.controller?.abort();
    const view = { game, mode };
    views.set(container, view);
    const title = node('h2', '在线排行');
    const rule = node('p');
    const login = node('a', '登录校园账号');
    login.href = '/#login-name';
    rule.append(login, '后，自动记录本榜的最佳成绩。');
    const list = node('ol', '', 'arcade-score-rows');
    const status = node('p', '正在读取成绩…');
    status.setAttribute('role', 'status');
    container.classList.add('arcade-scoreboard');
    container.replaceChildren(title, rule, status, list);
    view.list = list;
    view.status = status;
    await load(container, view);
  }

  async function submit(game, { mode, score }) {
    try {
      const result = await request('/api/arcade/score', { game, mode, score });
      for (const [container, view] of views) {
        if (view.game === game && view.mode === mode) void load(container, view);
      }
      return result;
    } catch {
      return { ok: false, message: '本局成绩未能上传。' };
    }
  }

  function refreshViews() {
    if (document.hidden) return;
    for (const [container, view] of views) {
      if (!container.isConnected) {
        view.controller?.abort();
        views.delete(container);
      } else {
        void load(container, view);
      }
    }
  }

  function startPolling() {
    if (poll === null) poll = setInterval(refreshViews, 15000);
  }

  document.addEventListener('visibilitychange', refreshViews);
  window.addEventListener('pageshow', event => {
    startPolling();
    if (event.persisted) refreshViews();
  });
  window.addEventListener('pagehide', () => {
    clearInterval(poll);
    poll = null;
    for (const view of views.values()) view.controller?.abort();
  });
  startPolling();
  window.NTJArcadeScores = { mount, submit };
})();
