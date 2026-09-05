'use strict';

/**
 * 玩家端应用逻辑。所有数值以服务端返回为准，前端只做展示与意图提交。
 */

(function initApp() {
  const { api, escapeHtml, formatNumber, formatDuration, formatTime, toast, polling } = NTJ;

  const appState = {
    data: null,
    selectedRegionId: null,
    mapRef: null,
    pendingInteract: false,
    modalOpen: false,
    poller: null
  };

  const elements = {
    registerView: document.getElementById('register-view'),
    homeView: document.getElementById('home-view'),
    registerCode: document.getElementById('register-code'),
    codeHint: document.getElementById('code-hint'),
    teamPicks: document.getElementById('team-picks'),
    registerName: document.getElementById('register-name'),
    registerPassword: document.getElementById('register-password'),
    registerPasswordConfirm: document.getElementById('register-password-confirm'),
    registerError: document.getElementById('register-error'),
    registerBtn: document.getElementById('register-btn'),
    loginName: document.getElementById('login-name'),
    loginPassword: document.getElementById('login-password'),
    loginError: document.getElementById('login-error'),
    loginBtn: document.getElementById('login-btn'),
    statusChip: document.getElementById('activity-status-chip'),
    teamBattle: document.getElementById('team-battle'),
    meCard: document.getElementById('me-card'),
    campusMap: document.getElementById('campus-map'),
    mapProgress: document.getElementById('map-progress'),
    regionDetail: document.getElementById('region-detail'),
    prizeTrack: document.getElementById('prize-track'),
    leaderboardList: document.getElementById('leaderboard-list'),
    meRank: document.getElementById('me-rank'),
    myLogs: document.getElementById('my-logs'),
    recentFeed: document.getElementById('recent-feed'),
    logoutBtn: document.getElementById('logout-btn'),
    resultModal: document.getElementById('result-modal'),
    resultEyebrow: document.getElementById('result-eyebrow'),
    resultCharacterBox: document.getElementById('result-character-box'),
    resultCharacterImg: document.getElementById('result-character-img'),
    resultCharacterName: document.getElementById('result-character-name'),
    resultTitle: document.getElementById('result-title'),
    resultText: document.getElementById('result-text'),
    resultContribution: document.getElementById('result-contribution'),
    resultAnomaly: document.getElementById('result-anomaly'),
    resultEnergy: document.getElementById('result-energy'),
    closeResult: document.getElementById('close-result'),
    clearedModal: document.getElementById('cleared-modal'),
    clearedTitle: document.getElementById('cleared-title'),
    clearedStory: document.getElementById('cleared-story'),
    clearedPrize: document.getElementById('cleared-prize'),
    closeCleared: document.getElementById('close-cleared')
  };

  // ---------- 注册 / 登录 ----------

  function showError(el, message) {
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function clearError(el) {
    el.textContent = '';
    el.classList.add('hidden');
  }

  let pickedTeam = '';

  function renderTeamPicks(teams, counts) {
    elements.teamPicks.innerHTML = teams
      .map((team) => {
        const count = counts && counts[team.id] !== undefined ? counts[team.id] : team.member_count;
        return `
          <button type="button" class="team-pick${pickedTeam === team.id ? ' picked' : ''}" data-team="${escapeHtml(team.id)}"
            style="--team-color: ${escapeHtml(team.color)}; --team-soft: ${escapeHtml(team.color_soft)}">
            <span class="team-pick-portrait">
              <img src="${escapeHtml(team.portrait_url)}" alt="${escapeHtml(team.captain)}"
                onerror="this.style.display='none'" />
            </span>
            <strong>${escapeHtml(team.short_name)}</strong>
            <span class="muted">${escapeHtml(team.captain)} 队 · ${formatNumber(count)} 人</span>
          </button>
        `;
      })
      .join('');

    for (const button of elements.teamPicks.querySelectorAll('.team-pick')) {
      button.addEventListener('click', () => {
        pickedTeam = button.dataset.team;
        for (const item of elements.teamPicks.querySelectorAll('.team-pick')) {
          item.classList.toggle('picked', item === button);
        }
      });
    }
  }

  async function showRegister(prefillCode) {
    elements.registerView.classList.remove('hidden');
    elements.homeView.classList.add('hidden');
    if (prefillCode) {
      elements.registerCode.value = prefillCode;
      elements.codeHint.classList.remove('hidden');
    }
    try {
      const res = await api('GET', '/api/public/state');
      renderTeamPicks(res.teams, Object.fromEntries(res.teams.map((team) => [team.id, team.member_count])));
    } catch {
      renderTeamPicks([
        { id: 'reimu', short_name: '灵梦队', captain: '博丽灵梦', color: '#e0344c', color_soft: '#fdeef0', portrait_url: '/assets/characters/reimu.png' },
        { id: 'marisa', short_name: '魔理沙队', captain: '雾雨魔理沙', color: '#f0a800', color_soft: '#fff7e0', portrait_url: '/assets/characters/marisa.png' }
      ], null);
    }
  }

  async function register() {
    clearError(elements.registerError);
    const code = elements.registerCode.value.trim().toUpperCase();
    const displayName = elements.registerName.value.trim();
    const password = elements.registerPassword.value;
    const confirm = elements.registerPasswordConfirm.value;
    if (!code) {
      return showError(elements.registerError, '请输入注册码。');
    }
    if (!pickedTeam) {
      return showError(elements.registerError, '请选择一个阵营。');
    }
    if (!displayName) {
      return showError(elements.registerError, '请输入昵称。');
    }
    if (!password || password !== confirm) {
      return showError(elements.registerError, '两次输入的密码不一致。');
    }
    elements.registerBtn.disabled = true;
    try {
      const res = await api('POST', '/api/player/register', {
        code,
        display_name: displayName,
        password,
        team: pickedTeam
      });
      toast('注册成功，欢迎加入调查！', 'success');
      enterHome(res.state);
    } catch (error) {
      showError(elements.registerError, error.message || '注册失败，请重试。');
    } finally {
      elements.registerBtn.disabled = false;
    }
  }

  async function login() {
    clearError(elements.loginError);
    try {
      const res = await api('POST', '/api/player/login', {
        display_name: elements.loginName.value.trim(),
        password: elements.loginPassword.value
      });
      toast('登录成功，欢迎回来！', 'success');
      enterHome(res.state);
    } catch (error) {
      showError(elements.loginError, error.message || '登录失败。');
    }
  }

  // ---------- 主视图渲染 ----------

  function enterHome(data) {
    elements.registerView.classList.add('hidden');
    elements.homeView.classList.remove('hidden');
    appState.data = data;
    if (!appState.selectedRegionId) {
      const firstOpen = data.regions.find((region) => region.status === 'available' || region.status === 'investigating');
      appState.selectedRegionId = firstOpen ? firstOpen.id : data.regions[0].id;
    }
    renderHome();
    if (!appState.poller) {
      appState.poller = polling(async () => {
        if (appState.modalOpen) {
          return;
        }
        const res = await api('GET', '/api/player/state');
        appState.data = res.state;
        renderHome();
      }, 6000);
    }
  }

  function renderHome() {
    const data = appState.data;
    if (!data) {
      return;
    }
    renderHeader(data.activity);
    renderTeamBattle(data.teams);
    renderMeCard(data.me);
    renderMap(data);
    renderRegionDetail();
    renderPrizeTrack(data);
    renderLeaderboard(data);
    renderFeeds(data);
  }

  function renderHeader(activity) {
    const label = NTJ.ACTIVITY_STATUS_LABELS[activity.status] || activity.status;
    elements.statusChip.textContent = label;
    elements.statusChip.className = `status-chip status-${activity.status}`;
  }

  function renderTeamBattle(teams) {
    const total = teams.reduce((sum, team) => sum + team.total_contribution, 0);
    const ratio = total > 0 ? teams[0].total_contribution / total : 0.5;
    const [first, second] = teams;
    elements.teamBattle.innerHTML = `
      <div class="battle-side" style="--team-color: ${escapeHtml(first.color)}">
        <img class="battle-portrait" src="${escapeHtml(first.portrait_url)}" alt=""
          onerror="this.style.display='none'" />
        <div class="battle-info">
          <strong>${escapeHtml(first.short_name)}</strong>
          <span>${formatNumber(first.total_contribution)}</span>
        </div>
      </div>
      <div class="battle-bar-wrap">
        <div class="battle-bar">
          <span class="battle-fill" style="width: ${(ratio * 100).toFixed(1)}%; background: ${escapeHtml(first.color)}"></span>
        </div>
        <div class="battle-counts muted">
          <span>${formatNumber(first.member_count)} 人</span>
          <span>VS</span>
          <span>${formatNumber(second.member_count)} 人</span>
        </div>
        <div class="battle-bar">
          <span class="battle-fill" style="width: ${((1 - ratio) * 100).toFixed(1)}%; background: ${escapeHtml(second.color)}"></span>
        </div>
      </div>
      <div class="battle-side right" style="--team-color: ${escapeHtml(second.color)}">
        <div class="battle-info">
          <strong>${escapeHtml(second.short_name)}</strong>
          <span>${formatNumber(second.total_contribution)}</span>
        </div>
        <img class="battle-portrait" src="${escapeHtml(second.portrait_url)}" alt=""
          onerror="this.style.display='none'" />
      </div>
    `;
  }

  function renderMeCard(me) {
    if (!me) {
      elements.meCard.innerHTML = '';
      return;
    }
    const team = (appState.data.teams.find((item) => item.id === me.team)) || { short_name: me.team, color: '#888' };
    const energyDots = Array.from({ length: me.energy_cap }, (_, index) =>
      `<i class="energy-dot${index < me.energy ? ' on' : ''}"></i>`
    ).join('');
    const nextEnergy = me.next_energy_in_sec > 0
      ? `<span class="muted small">${formatDuration(me.next_energy_in_sec)}后 +1</span>`
      : '<span class="muted small">已满</span>';

    elements.meCard.innerHTML = `
      <div class="me-row">
        <div class="me-identity">
          <strong class="me-name">${escapeHtml(me.display_name)}</strong>
          <span class="team-badge" style="--team-color: ${escapeHtml(team.color)}; --team-soft: ${escapeHtml(team.color_soft)}">
            ${escapeHtml(team.short_name)}
          </span>
          ${me.banned ? '<span class="team-badge banned">已封禁</span>' : ''}
        </div>
        <div class="me-title muted">${escapeHtml(me.title || '')}</div>
      </div>
      <div class="me-stats">
        <div><span>总贡献</span><strong>${formatNumber(me.total_contribution)}</strong></div>
        <div><span>当前排名</span><strong>${me.rank ? `#${me.rank}` : '—'}</strong></div>
        <div><span>抽奖权重</span><strong>${me.weight !== null ? me.weight : '—'}</strong></div>
        <div><span>能量</span><strong class="energy-wrap">${energyDots}${nextEnergy}</strong></div>
      </div>
    `;
  }

  function renderMap(data) {
    if (!appState.mapRef) {
      appState.mapRef = NTJ.renderCampusMap(elements.campusMap, data.regions, {
        selectedId: appState.selectedRegionId,
        onSelect(regionId) {
          appState.selectedRegionId = regionId;
          appState.mapRef.update(appState.data.regions, regionId);
          renderRegionDetail();
          const detail = document.getElementById('region-detail');
          if (detail) {
            detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
    } else {
      appState.mapRef.update(data.regions, appState.selectedRegionId);
    }
    const cleared = data.regions.filter((region) => region.status === 'cleared').length;
    elements.mapProgress.textContent = `${cleared} / ${data.regions.length} 区域已解决`;
  }

  function regionActions(region) {
    const me = appState.data.me;
    const cooldowns = (me && me.cooldowns) || {};
    const now = Math.floor(Date.now() / 1000);
    return appState.data.interactions
      .filter((interaction) => !interaction.regions || interaction.regions.includes(region.id))
      .map((interaction) => {
        const restrictionTeam = interaction.team_restriction
          ? appState.data.teams.find((item) => item.id === interaction.team_restriction)
          : null;
        const teamBlocked = Boolean(interaction.team_restriction && me && interaction.team_restriction !== me.team);
        return {
          ...interaction,
          restriction_team_name: restrictionTeam ? restrictionTeam.short_name : '',
          team_blocked: teamBlocked,
          unavailable: teamBlocked
            ? `仅限${restrictionTeam ? restrictionTeam.short_name : '指定阵营'}`
            : '',
          cooldown_left: interaction.cooldown_sec > 0
            ? Math.max(0, interaction.cooldown_sec - (now - (cooldowns[interaction.id] || 0)))
            : 0
        };
      });
  }

  function renderRegionDetail() {
    const data = appState.data;
    const region = data.regions.find((item) => item.id === appState.selectedRegionId);
    if (!region) {
      elements.regionDetail.innerHTML = '';
      return;
    }

    const season = NTJ.SEASON_STYLES[region.season] || { label: '', color: '#888', soft: '#eee' };
    const statusLabel = region.closed ? '临时关闭' : NTJ.REGION_STATUS_LABELS[region.status];
    const story = region.status === 'cleared' ? region.cleared_story : region.description;
    const isCleared = region.status === 'cleared';
    // 异变条 = 剩余量：从满条开始，随调查推进逐渐清空，与「剩余异变」数字同向。
    const remainingPercent = isCleared
      ? 0
      : Math.max(0, Math.min(100, ((region.anomaly_remaining / region.max_anomaly) * 100).toFixed(1)));

    let unlockHint = '';
    if (region.status === 'locked') {
      const depNames = region.unlock_after
        .map((id) => (data.regions.find((item) => item.id === id) || {}).name || id)
        .join('、');
      unlockHint = `<p class="helper-text">需要先解决「${escapeHtml(depNames)}」的异变。</p>`;
    }

    let actionsHtml = '';
    if (region.status === 'available' || region.status === 'investigating') {
      if (region.closed) {
        actionsHtml = '<p class="helper-text">该区域暂时关闭，请留意现场广播。</p>';
      } else if (!data.activity || data.activity.status !== 'running' || !data.activity.interaction_open) {
        actionsHtml = '<p class="helper-text">当前活动未在进行中，请等待工作人员开放互动。</p>';
      } else {
        const actions = regionActions(region);
        actionsHtml = `
          <div class="action-list">
            ${actions.map((action) => {
              const disabled = action.unavailable || action.cooldown_left > 0 || appState.pendingInteract;
              const hint = action.contribution_hint;
              const tag = action.team_restriction
                ? `<em class="action-tag${action.team_blocked ? ' blocked' : ''}">${escapeHtml(action.team_blocked ? action.unavailable : `${action.restriction_team_name}限定`)}</em>`
                : '';
              return `
                <button type="button" class="action-btn${action.team_blocked ? ' is-team-locked' : ''}" data-action="${escapeHtml(action.id)}"
                  ${disabled ? 'disabled' : ''}>
                  <span class="action-name">${escapeHtml(action.name)}${tag}</span>
                  <span class="action-desc">${escapeHtml(action.description)}</span>
                  <span class="action-meta muted">
                    ⚡${action.energy_cost} · 贡献 ${hint.contribution[0]}~${hint.contribution[1]} · 削减异变 ${hint.anomaly[0]}~${hint.anomaly[1]}
                    ${action.cooldown_left > 0 ? ` · 冷却中 ${formatDuration(action.cooldown_left)}` : ''}
                    ${action.cooldown_sec > 0 && action.cooldown_left <= 0 ? ` · 冷却 ${formatDuration(action.cooldown_sec)}` : ''}
                  </span>
                </button>
              `;
            }).join('')}
          </div>
        `;
      }
    }

    elements.regionDetail.innerHTML = `
      <div class="region-detail" style="--season-color: ${escapeHtml(season.color)}; --season-soft: ${escapeHtml(season.soft)}">
        <div class="region-head">
          <div>
            <h3>${escapeHtml(region.name)} <span class="season-chip">${escapeHtml(season.label)}</span></h3>
            <p class="muted small">${escapeHtml(region.title || '')} · ${statusLabel} · ${formatNumber(region.participant_count)} 人参与</p>
          </div>
          <div class="region-anomaly${isCleared ? ' is-cleared' : ''}">
            ${isCleared
              ? '<strong>已解决</strong><span class="muted small">异变已清零</span>'
              : `<strong>${formatNumber(region.anomaly_remaining)}</strong><span class="muted small">剩余异变 / 共 ${formatNumber(region.max_anomaly)}</span>`}
          </div>
        </div>
        ${isCleared ? '' : `
        <div class="anomaly-bar" role="progressbar" aria-label="剩余异变"
          aria-valuemin="0" aria-valuemax="${region.max_anomaly}" aria-valuenow="${region.anomaly_remaining}">
          <span style="width: ${remainingPercent}%"></span>
        </div>
        `}
        <p class="region-story">${escapeHtml(story || '')}</p>
        ${unlockHint}
        ${actionsHtml}
        <div class="region-board">
          <p class="board-title muted">本区域贡献榜</p>
          ${(data.region_leaderboards[region.id] || []).map((row) => `
            <div class="board-row${appState.data.me && row.user_id === appState.data.me.id ? ' is-me' : ''}">
              <span class="board-rank">${row.rank}</span>
              <strong>${escapeHtml(row.display_name)}</strong>
              <span class="muted">${escapeHtml((data.teams.find((t) => t.id === row.team) || {}).short_name || '')}</span>
              <span class="board-score">${formatNumber(row.contribution)}</span>
            </div>
          `).join('') || '<p class="muted small">还没有人在这里留下足迹。</p>'}
        </div>
      </div>
    `;

    for (const button of elements.regionDetail.querySelectorAll('.action-btn:not([disabled])')) {
      button.addEventListener('click', () => {
        interact(region.id, button.dataset.action);
      });
    }
  }

  function renderPrizeTrack(data) {
    const latestBox = document.getElementById('latest-draw');
    if (data.latest_draw) {
      latestBox.classList.remove('hidden');
      latestBox.innerHTML = `
        <span class="draw-label">刚刚抽出</span>
        <strong>${escapeHtml(data.latest_draw.prize_name)}</strong>
        <span>→</span>
        <strong>${escapeHtml(data.latest_draw.winner_display_name)}</strong>
        <span class="muted small">${formatTime(data.latest_draw.drawn_at)}</span>
      `;
    } else {
      latestBox.classList.add('hidden');
    }

    const regionName = (sourceId) => {
      if (sourceId === 'base') {
        return '基础奖池';
      }
      const region = data.regions.find((item) => item.id === sourceId);
      return region ? region.name : sourceId;
    };
    elements.prizeTrack.innerHTML = data.prizes
      .map((prize) => `
        <div class="prize-card${prize.available ? ' unlocked' : ' mystery'}">
          <span class="prize-image">
            <img src="${escapeHtml(prize.image)}" alt="" loading="lazy"
              onerror="this.style.display='none'" />
          </span>
          <strong>${prize.available ? escapeHtml(prize.name) : '神秘奖品'}</strong>
          <span class="muted small">${escapeHtml(regionName(prize.source))}</span>
          <span class="prize-state">${prize.available ? '已进入奖池' : '未解锁'}</span>
        </div>
      `)
      .join('');

    const broadcast = document.getElementById('broadcast');
    if (data.system_events && data.system_events.length > 0) {
      broadcast.classList.remove('hidden');
      broadcast.innerHTML = data.system_events
        .map((event) => `
          <div class="broadcast-row">
            <span class="tag">播报</span>
            <span>${escapeHtml(event.message)}</span>
            <span class="muted small">${formatTime(event.created_at)}</span>
          </div>
        `)
        .join('');
    } else {
      broadcast.classList.add('hidden');
    }
  }

  function renderLeaderboard(data) {
    const top = data.leaderboard.slice(0, 20);
    elements.leaderboardList.innerHTML = top
      .map((row) => `
        <div class="board-row${data.me && row.user_id === data.me.id ? ' is-me' : ''}">
          <span class="board-rank">${row.rank}</span>
          <strong>${escapeHtml(row.display_name)}</strong>
          <span class="muted">${escapeHtml((data.teams.find((team) => team.id === row.team) || {}).short_name || '')}</span>
          <span class="board-score">${formatNumber(row.total_contribution)}</span>
        </div>
      `)
      .join('') || '<p class="muted small">还没有贡献记录。</p>';

    elements.meRank.textContent = data.me && data.me.rank ? `我的排名 #${data.me.rank}` : '';
  }

  function renderFeedRow(entry) {
    const delta = entry.user_delta ? `${entry.user_delta > 0 ? '+' : ''}${formatNumber(entry.user_delta)}` : '';
    const anomaly = entry.anomaly_delta ? `异变 -${formatNumber(entry.anomaly_delta)}` : '';
    return `
      <div class="feed-row">
        <span class="feed-time muted">${formatTime(entry.created_at)}</span>
        <span class="feed-main">
          ${entry.who ? `<strong>${escapeHtml(entry.who)}</strong>` : ''}
          ${entry.region_name ? `在「${escapeHtml(entry.region_name)}」` : ''}
          ${escapeHtml(entry.action_name || '')}
        </span>
        <span class="feed-delta">
          ${delta ? `<b class="up">${delta}</b>` : ''} ${anomaly ? `<b class="down">${anomaly}</b>` : ''}
        </span>
      </div>
    `;
  }

  function renderFeeds(data) {
    elements.myLogs.innerHTML = data.my_logs.map(renderFeedRow).join('')
      || '<p class="muted small">还没有行动记录，去地图上选择一个区域开始调查吧！</p>';
    elements.recentFeed.innerHTML = data.recent_contributions.map(renderFeedRow).join('')
      || '<p class="muted small">全场还没有动静。</p>';
  }

  // ---------- 互动 ----------

  async function interact(regionId, actionId) {
    if (appState.pendingInteract) {
      return;
    }
    appState.pendingInteract = true;
    renderRegionDetail();
    try {
      const res = await api('POST', '/api/player/interact', {
        region_id: regionId,
        action_id: actionId,
        client_request_id: NTJ.newRequestId()
      });
      appState.data = res.state;
      renderHome();
      showResult(res.action_result);
    } catch (error) {
      if (error.error === 'COOLDOWN_ACTIVE' && error.retry_in_sec) {
        toast(`冷却中，还需 ${formatDuration(error.retry_in_sec)}`, 'warn');
      } else if (error.error === 'ENERGY_NOT_ENOUGH') {
        toast('能量不足，休息一下再出发。', 'warn');
      } else {
        toast(error.message || '操作失败，请重试。', 'error');
      }
      const res = await api('GET', '/api/player/state').catch(() => null);
      if (res) {
        appState.data = res.state;
        renderHome();
      }
    } finally {
      appState.pendingInteract = false;
      renderRegionDetail();
    }
  }

  function showResult(actionResult) {
    appState.modalOpen = true;
    appState.pendingClearedRegion = actionResult.region_just_cleared ? actionResult.region_id : null;
    elements.resultEyebrow.textContent = `「${actionResult.region_name}」· ${actionResult.interaction_name}`;
    if (actionResult.character && actionResult.character.id) {
      elements.resultCharacterBox.classList.remove('hidden');
      elements.resultCharacterImg.src = NTJ.characterImage(actionResult.character.id);
      elements.resultCharacterImg.onerror = () => elements.resultCharacterBox.classList.add('hidden');
      elements.resultCharacterName.textContent = actionResult.character.name || '';
    } else {
      elements.resultCharacterBox.classList.add('hidden');
    }
    elements.resultTitle.textContent = actionResult.contribution_gain > 0 ? '调查有收获！' : '略有遗憾……';
    elements.resultText.textContent = actionResult.text;
    elements.resultContribution.textContent = `贡献 +${formatNumber(actionResult.contribution_gain)}`;
    elements.resultAnomaly.textContent = `异变 -${formatNumber(actionResult.anomaly_reduction)}`;
    elements.resultEnergy.textContent = `能量 ${actionResult.energy_after}`;
    elements.resultModal.classList.remove('hidden');
  }

  function showClearedModal(regionId) {
    const region = appState.data.regions.find((item) => item.id === regionId);
    const prizeNames = (appState.data.prizes || [])
      .filter((prize) => prize.source === regionId)
      .map((prize) => prize.name);
    elements.clearedTitle.textContent = `「${region ? region.name : ''}」异变解决！`;
    elements.clearedStory.textContent = region ? region.cleared_story : '';
    let note = prizeNames.length
      ? `终盘奖池解锁：${prizeNames.join('、')}。`
      : '终盘奖池加入新奖品。';
    const nextRegion = appState.data.regions.find(
      (item) => item.unlock_after.includes(regionId) && item.status === 'available'
    );
    if (nextRegion) {
      note += `下一区域「${nextRegion.name}」已开放！`;
    }
    elements.clearedPrize.textContent = note;
    elements.clearedModal.classList.remove('hidden');
  }

  function closeResult() {
    elements.resultModal.classList.add('hidden');
    appState.modalOpen = false;
    if (appState.pendingClearedRegion) {
      const regionId = appState.pendingClearedRegion;
      appState.pendingClearedRegion = null;
      appState.selectedRegionId = regionId;
      appState.mapRef.update(appState.data.regions, regionId);
      renderRegionDetail();
      showClearedModal(regionId);
      appState.modalOpen = true;
    }
  }

  function closeCleared() {
    elements.clearedModal.classList.add('hidden');
    appState.modalOpen = false;
  }

  // ---------- 事件绑定与启动 ----------

  elements.registerBtn.addEventListener('click', register);
  elements.loginBtn.addEventListener('click', login);
  elements.logoutBtn.addEventListener('click', async () => {
    await api('POST', '/api/player/logout').catch(() => null);
    if (appState.poller) {
      appState.poller.stop();
      appState.poller = null;
    }
    appState.selectedRegionId = null;
    pickedTeam = '';
    showRegister('');
  });
  elements.closeResult.addEventListener('click', closeResult);
  elements.closeCleared.addEventListener('click', closeCleared);
  for (const modal of [elements.resultModal, elements.clearedModal]) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.classList.add('hidden');
        appState.modalOpen = false;
      }
    });
  }

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    const prefillCode = (params.get('code') || params.get('token') || '').trim();
    try {
      const res = await api('GET', '/api/player/state');
      enterHome(res.state);
    } catch {
      await showRegister(prefillCode);
    }
  }

  boot();
})();
