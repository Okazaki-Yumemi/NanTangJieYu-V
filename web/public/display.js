'use strict';

/**
 * 大屏展示逻辑：只读轮询 /api/public/state，3 秒刷新。
 */

(function initDisplay() {
  const { api, escapeHtml, formatNumber, formatTime, renderCampusMap, polling } = NTJ;

  let mapRef = null;
  let lastRegionKey = '';
  let latestData = null;
  let rankPage = 0;
  let lastRankSignature = '';
  const RANK_PAGE_SIZE = 8;
  const RANK_ROTATE_MS = 5000;

  const elements = {
    status: document.getElementById('display-status'),
    progress: document.getElementById('display-progress'),
    vsPanel: document.getElementById('vs-panel'),
    top: document.getElementById('display-top'),
    map: document.getElementById('display-map'),
    prizes: document.getElementById('display-prizes'),
    regions: document.getElementById('display-regions'),
    feed: document.getElementById('display-feed'),
    fullscreen: document.getElementById('fullscreen-btn')
  };

  function teamById(teams, id) {
    return teams.find((team) => team.id === id) || { short_name: id, color: '#888', portrait_url: '' };
  }

  function render(data) {
    latestData = data;
    const label = NTJ.ACTIVITY_STATUS_LABELS[data.activity.status] || data.activity.status;
    elements.status.textContent = label;
    elements.status.className = `status-chip status-${data.activity.status}`;
    elements.progress.textContent =
      `区域 ${data.activity.cleared_region_count}/${data.activity.total_region_count} · 玩家 ${formatNumber(data.activity.player_count)}`;

    renderVs(data);
    renderTop(data);
    renderMap(data);
    renderPrizes(data);
    renderRegions(data);
    renderFeed(data);
  }

  // 排行榜每 5 秒翻页（与 3 秒数据轮询解耦）；翻页才播放入场动画
  setInterval(() => {
    rankPage += 1;
    if (latestData) {
      renderTop(latestData, { animate: true });
    }
  }, RANK_ROTATE_MS);

  function renderVs(data) {
    const total = data.teams.reduce((sum, team) => sum + team.total_contribution, 0);
    const ratio = total > 0 ? data.teams[0].total_contribution / total : 0.5;
    const [first, second] = data.teams;
    elements.vsPanel.innerHTML = `
      <div class="vs-row">
        <img class="vs-portrait" src="${escapeHtml(first.portrait_url)}" alt="" onerror="this.style.visibility='hidden'" />
        <div class="vs-team">
          <strong style="color: ${escapeHtml(first.color)}">${escapeHtml(first.short_name)}</strong>
          <span class="vs-captain">${escapeHtml(first.captain)}</span>
        </div>
        <div class="vs-score" style="color: ${escapeHtml(first.color)}">
          ${formatNumber(first.total_contribution)}
          <small>${formatNumber(first.member_count)} 名队员</small>
        </div>
      </div>
      <div class="vs-bar">
        <span style="width: ${(ratio * 100).toFixed(1)}%; background: ${escapeHtml(first.color)}"></span>
        <span style="width: ${((1 - ratio) * 100).toFixed(1)}%; background: ${escapeHtml(second.color)}"></span>
      </div>
      <div class="vs-meta">
        <span>${((ratio * 100) || 0).toFixed(1)}%</span>
        <span>总贡献 ${formatNumber(total)}</span>
        <span>${((1 - ratio) * 100 || 0).toFixed(1)}%</span>
      </div>
      <div class="vs-row right">
        <div class="vs-score" style="color: ${escapeHtml(second.color)}">
          ${formatNumber(second.total_contribution)}
          <small>${formatNumber(second.member_count)} 名队员</small>
        </div>
        <div class="vs-team">
          <strong style="color: ${escapeHtml(second.color)}">${escapeHtml(second.short_name)}</strong>
          <span class="vs-captain">${escapeHtml(second.captain)}</span>
        </div>
        <img class="vs-portrait" src="${escapeHtml(second.portrait_url)}" alt="" onerror="this.style.visibility='hidden'" />
      </div>
    `;
  }

  function renderTop(data, { animate = false } = {}) {
    const rows = data.top_players;
    const pageCount = Math.max(1, Math.ceil(rows.length / RANK_PAGE_SIZE));
    if (rankPage >= pageCount) {
      rankPage = 0;
    }
    const pageRows = rows.slice(rankPage * RANK_PAGE_SIZE, rankPage * RANK_PAGE_SIZE + RANK_PAGE_SIZE);

    // 内容签名：数据轮询（3s）与翻页定时器（5s）都会调用本函数。
    // 内容没变时跳过重渲染，避免同一页反复重播入场动画（“闪回滚两次”）。
    const signature = JSON.stringify([
      rankPage,
      pageCount,
      pageRows.map((row) => [row.user_id, row.total_contribution, row.display_name])
    ]);
    if (signature === lastRankSignature) {
      return;
    }
    lastRankSignature = signature;

    elements.top.innerHTML = pageRows
      .map((row, index) => {
        const rank = rankPage * RANK_PAGE_SIZE + index + 1;
        const medal = rank <= 3 ? ` rank-medal rank-${rank}` : '';
        return `
          <div class="board-row${medal}${animate ? ' animate-in' : ''}">
            <span class="board-rank">${rank}</span>
            <strong>${escapeHtml(row.display_name)}</strong>
            <span class="muted">${escapeHtml((teamById(data.teams, row.team)).short_name)}</span>
            <span class="board-score">${formatNumber(row.total_contribution)}</span>
          </div>
        `;
      })
      .join('') || '<p class="muted">暂无数据。</p>';
    const indicator = elements.top.nextElementSibling;
    if (indicator && indicator.classList.contains('rank-pages')) {
      indicator.textContent = `第 ${rankPage + 1} / ${pageCount} 页 · 共 ${rows.length} 名探索者`;
    }
  }

  function renderMap(data) {
    const regionKey = data.regions.map((region) => region.status).join(',');
    if (!mapRef || regionKey !== lastRegionKey) {
      lastRegionKey = regionKey;
    }
    if (!mapRef) {
      mapRef = renderCampusMap(elements.map, data.regions, {});
    } else {
      mapRef.update(data.regions, null);
    }
  }

  function renderPrizes(data) {
    const latest = document.getElementById('display-latest-draw');
    if (data.latest_draw) {
      latest.classList.remove('hidden');
      latest.innerHTML = `
        <span class="draw-label">刚刚抽出</span>
        <strong>${escapeHtml(data.latest_draw.prize_name)}</strong>
        <span>→</span>
        <strong style="color: ${escapeHtml((teamById(data.teams, data.latest_draw.winner_team)).color)}">
          ${escapeHtml(data.latest_draw.winner_display_name)}
        </strong>
      `;
    } else {
      latest.classList.add('hidden');
    }
    elements.prizes.innerHTML = data.prize_track
      .map((prize) => `
        <div class="display-prize${prize.available ? ' unlocked' : ' mystery'}">
          <img src="${escapeHtml(prize.image)}" alt="" onerror="this.style.display='none'" />
          <strong>${prize.available ? escapeHtml(prize.name) : '神秘奖品'}</strong>
          <span class="source">${escapeHtml(prize.source === 'base'
            ? '基础奖池'
            : (data.regions.find((region) => region.id === prize.source) || {}).name || '')}</span>
        </div>
      `)
      .join('');
  }

  function renderRegions(data) {
    elements.regions.innerHTML = [...data.regions]
      .sort((a, b) => a.order - b.order)
      .map((region) => {
        const statusLabel = region.closed ? '临时关闭' : NTJ.REGION_STATUS_LABELS[region.status];
        const season = NTJ.SEASON_STYLES[region.season] || {};
        const isCleared = region.status === 'cleared';
        const isLocked = region.status === 'locked';
        // 与玩家端同语义：异变条 = 剩余量，随调查推进清空；locked / cleared 不再展示易误读的数值
        const remainingPercent = isCleared || isLocked
          ? 0
          : Math.max(0, Math.min(100, ((region.anomaly_remaining / region.max_anomaly) * 100).toFixed(1)));
        const nums = isCleared ? '' : (isLocked ? '—' : `${formatNumber(region.anomaly_remaining)} / ${formatNumber(region.max_anomaly)}`);
        return `
          <div class="display-region${isCleared ? ' is-cleared' : ''}${isLocked ? ' is-locked' : ''}">
            <div class="region-line">
              <strong>${escapeHtml(region.name)}
                <span class="tag">${escapeHtml(season.label || '')}</span>
              </strong>
              <span class="nums">${nums}</span>
            </div>
            <div class="anomaly-bar"><span style="width: ${remainingPercent}%; background: linear-gradient(90deg, ${escapeHtml(season.color || '#d9b64a')}, rgba(255, 255, 255, 0.5))"></span></div>
            <div class="region-line" style="margin: 4px 0 0;">
              <span class="tag status-tag">${escapeHtml(statusLabel)}</span>
              ${isCleared ? '<span class="nums cleared-note">异变已清零</span>' : ''}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderFeed(data) {
    elements.feed.innerHTML = data.recent_contributions
      .map((entry) => `
        <div class="feed-row">
          <span class="feed-time">${formatTime(entry.created_at)}</span>
          <span class="feed-main">
            ${entry.who ? `<strong>${escapeHtml(entry.who)}</strong>` : ''}
            ${entry.region_name ? `在「${escapeHtml(entry.region_name)}」` : ''}
            ${escapeHtml(entry.action_name || '')}
          </span>
          <span class="feed-delta">
            ${entry.user_delta ? `<b class="up">${entry.user_delta > 0 ? '+' : ''}${formatNumber(entry.user_delta)}</b>` : ''}
            ${entry.anomaly_delta ? `<b class="down">异变 -${formatNumber(entry.anomaly_delta)}</b>` : ''}
          </span>
        </div>
      `)
      .join('') || '<p class="muted">等待第一份调查报告……</p>';
  }

  elements.fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => null);
    }
  });

  async function tick() {
    const data = await api('GET', '/api/public/state');
    render(data);
  }

  polling(tick, 3000);
})();
