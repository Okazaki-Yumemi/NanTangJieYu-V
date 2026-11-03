(() => {
  'use strict';

  const views = new Map();
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = '/arcade-scores.css?v=1';
  document.head.append(sheet);

  async function request(path, body) {
    const options = body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : { cache: 'no-store' };
    const response = await fetch(path, options);
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

  async function mount(target, game, mode) {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return;
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

    try {
      const query = new URLSearchParams({ game, mode });
      const result = await request(`/api/arcade/leaderboard?${query}`);
      if (views.get(container) !== view) return;
      if (!result.ok) {
        status.textContent = result.message || '暂时无法读取排行榜。';
        return;
      }
      status.textContent = result.rows.length ? '' : '这张榜还没有成绩。';
      for (const row of result.rows) {
        const item = node('li');
        const rank = node('span', String(row.rank), 'arcade-score-rank');
        rank.setAttribute('aria-hidden', 'true');
        item.append(rank, node('span', row.display_name), node('strong', formatScore(game, row.score)));
        list.append(item);
      }
    } catch {
      if (views.get(container) === view) status.textContent = '暂时无法读取排行榜。';
    }
  }

  async function submit(game, { mode, score }) {
    try {
      const result = await request('/api/arcade/score', { game, mode, score });
      if (result.ok && result.improved) {
        for (const [container, view] of views) {
          if (view.game === game && view.mode === mode) void mount(container, game, mode);
        }
      }
      return result;
    } catch {
      return { ok: false, message: '本局成绩未能上传。' };
    }
  }

  window.NTJArcadeScores = { mount, submit };
})();
