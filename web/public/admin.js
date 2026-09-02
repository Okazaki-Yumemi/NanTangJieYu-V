'use strict';

/**
 * 管理后台逻辑。所有危险操作带二次确认，全部操作由服务端鉴权并留痕。
 */

(function initAdmin() {
  const { api, escapeHtml, formatNumber, formatTime, toast } = NTJ;

  let admin = null;
  let activeTab = 'overview';
  let playerQuery = '';
  let codeQuery = { query: '', status: '', type: '' };

  const elements = {
    login: document.getElementById('admin-login'),
    shell: document.getElementById('admin-shell'),
    password: document.getElementById('admin-password'),
    loginError: document.getElementById('login-error'),
    loginBtn: document.getElementById('login-btn'),
    refreshBtn: document.getElementById('refresh-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    activityChip: document.getElementById('admin-activity-chip'),
    tabs: document.getElementById('admin-tabs'),
    panels: {
      overview: document.getElementById('tab-overview'),
      regions: document.getElementById('tab-regions'),
      players: document.getElementById('tab-players'),
      codes: document.getElementById('tab-codes'),
      lottery: document.getElementById('tab-lottery'),
      stage: document.getElementById('tab-stage'),
      logs: document.getElementById('tab-logs')
    }
  };

  // ---------- 通用 ----------

  async function refresh() {
    const res = await api('GET', '/api/admin/bootstrap');
    admin = res.admin;
    renderHeader();
    renderTab();
  }

  async function post(pathname, body, { confirmText } = {}) {
    if (confirmText && !window.confirm(confirmText)) {
      return null;
    }
    const res = await api('POST', pathname, body);
    if (res.admin) {
      admin = res.admin;
      renderHeader();
    }
    renderTab();
    return res;
  }

  function renderHeader() {
    const label = NTJ.ACTIVITY_STATUS_LABELS[admin.activity.status] || admin.activity.status;
    elements.activityChip.textContent = label;
    elements.activityChip.className = `status-chip status-${admin.activity.status}`;
  }

  function renderTab() {
    const renderers = {
      overview: renderOverview,
      regions: renderRegions,
      players: renderPlayers,
      codes: renderCodes,
      lottery: renderLottery,
      stage: renderStage,
      logs: renderLogs
    };
    (renderers[activeTab] || renderOverview)();
  }

  function switchTab(tab) {
    activeTab = tab;
    for (const button of elements.tabs.querySelectorAll('.tab-btn')) {
      button.classList.toggle('active', button.dataset.tab === tab);
    }
    for (const [name, panel] of Object.entries(elements.panels)) {
      panel.classList.toggle('hidden', name !== tab);
    }
    renderTab();
  }

  function teamName(teamId) {
    const team = admin.teams.find((item) => item.id === teamId);
    return team ? team.short_name : teamId || '';
  }

  // ---------- 活动状态 ----------

  function renderOverview() {
    const activity = admin.activity;
    const panel = elements.panels.overview;
    const started = activity.status === 'running';
    const paused = activity.status === 'paused';
    panel.innerHTML = `
      <div class="admin-card">
        <h2>活动控制</h2>
        <div class="btn-row">
          <button class="action-btn primary" data-activity="start" ${started || activity.status !== 'scheduled' ? 'disabled' : ''}>开始活动</button>
          <button class="action-btn warn" data-activity="pause" ${!started ? 'disabled' : ''}>暂停活动</button>
          <button class="action-btn primary" data-activity="resume" ${!paused ? 'disabled' : ''}>恢复活动</button>
          <button class="action-btn danger" data-activity="end" ${activity.status === 'ended' ? 'disabled' : ''}>结束活动</button>
          <span style="width: 1px; height: 22px; background: var(--line);"></span>
          <button class="action-btn" data-activity="open_registration" ${activity.registration_open ? 'disabled' : ''}>开放注册</button>
          <button class="action-btn" data-activity="close_registration" ${!activity.registration_open ? 'disabled' : ''}>关闭注册</button>
        </div>
        <p class="helper-text">互动仅在「进行中」状态可用；注册开关独立于活动状态。</p>
      </div>

      <div class="admin-card">
        <h2>概览</h2>
        <div class="stat-grid">
          <div class="stat-cell"><span>注册玩家</span><strong>${formatNumber(activity.player_count)}</strong></div>
          ${admin.teams.map((team) => `
            <div class="stat-cell">
              <span>${escapeHtml(team.short_name)}</span>
              <strong>${formatNumber(team.total_contribution)}</strong>
              <span>${formatNumber(team.member_count)} 人</span>
            </div>
          `).join('')}
          <div class="stat-cell"><span>区域进度</span><strong>${activity.cleared_region_count} / ${activity.total_region_count}</strong></div>
          <div class="stat-cell"><span>注册码余量</span><strong>${formatNumber(admin.codes_stats.unused)}</strong><span>未用 ${admin.codes_stats.total - admin.codes_stats.unused} / 共 ${admin.codes_stats.total}</span></div>
        </div>
      </div>

      <div class="admin-card">
        <h2>系统事件</h2>
        <div class="log-list">
          ${admin.system_events.map((event) => `
            <div class="log-row">
              <time>${formatTime(event.created_at)}</time>
              <span class="log-main">${escapeHtml(event.message)}</span>
            </div>
          `).join('') || '<p class="muted">暂无事件。</p>'}
        </div>
      </div>
    `;

    for (const button of panel.querySelectorAll('[data-activity]')) {
      button.addEventListener('click', async () => {
        const action = button.dataset.activity;
        const confirmText = action === 'end' ? '确定要结束活动吗？结束后玩家无法继续互动。' : null;
        try {
          const res = await post('/api/admin/activity', { action }, { confirmText });
          if (res) {
            toast(res.message, 'success');
          }
        } catch (error) {
          toast(error.message || '操作失败', 'error');
        }
      });
    }
  }

  // ---------- 区域 ----------

  function renderRegions() {
    const panel = elements.panels.regions;
    panel.innerHTML = `
      <div class="admin-card">
        <h2>区域管理</h2>
        <table class="admin-table">
          <thead>
            <tr>
              <th>区域</th><th>状态</th><th>异变值</th><th>调整</th><th>参与</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${admin.regions.map((region) => {
              const statusLabel = region.closed ? '已关闭' : NTJ.REGION_STATUS_LABELS[region.status];
              const tagClass = region.closed ? 'bad' : (region.status === 'cleared' ? 'ok' : (region.status === 'locked' ? '' : 'warn'));
              return `
                <tr data-region="${escapeHtml(region.id)}">
                  <td><strong>${escapeHtml(region.name)}</strong><br /><span class="tag">${escapeHtml(NTJ.SEASON_STYLES[region.season]?.label || '')}</span></td>
                  <td><span class="tag ${tagClass}">${escapeHtml(statusLabel)}</span></td>
                  <td class="num">${formatNumber(region.anomaly_remaining)} / ${formatNumber(region.max_anomaly)}<br /><span class="muted">${((region.anomaly_progress || 0) * 100).toFixed(1)}%</span></td>
                  <td><input class="anomaly-input" type="number" min="0" max="${region.max_anomaly}" value="${region.anomaly_remaining}" data-anomaly-input /></td>
                  <td class="num">${region.participant_count}</td>
                  <td>
                    <div class="btn-row">
                      <button class="action-btn" data-op="set_anomaly">设为输入值</button>
                      <button class="action-btn warn" data-op="force_unlock" ${region.status === 'locked' ? '' : 'disabled'}>强制解锁</button>
                      <button class="action-btn warn" data-op="force_clear" ${region.status === 'cleared' ? 'disabled' : ''}>强制 CLEAR</button>
                      ${region.closed
                        ? '<button class="action-btn" data-op="reopen">重新开放</button>'
                        : '<button class="action-btn danger" data-op="close">临时关闭</button>'}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    for (const row of panel.querySelectorAll('tr[data-region]')) {
      const regionId = row.dataset.region;
      for (const button of row.querySelectorAll('[data-op]')) {
        button.addEventListener('click', async () => {
          const op = button.dataset.op;
          let body = { region_id: regionId, op };
          if (op === 'set_anomaly') {
            const input = row.querySelector('[data-anomaly-input]');
            body.value = Number(input.value);
            if (!Number.isFinite(body.value)) {
              toast('请输入有效的异变值', 'warn');
              return;
            }
          }
          const confirmText = op === 'force_clear' ? '确定要强制 CLEAR 该区域吗？会解锁后续区域和奖品。' : null;
          try {
            const res = await post('/api/admin/region', body, { confirmText });
            if (res) {
              toast(res.message, 'success');
            }
          } catch (error) {
            toast(error.message || '操作失败', 'error');
          }
        });
      }
    }
  }

  // ---------- 玩家 ----------

  function renderPlayers() {
    const panel = elements.panels.players;
    const query = playerQuery.trim().toLowerCase();
    const players = admin.players.filter((player) => !query || (
      player.display_name.toLowerCase().includes(query) ||
      (player.code || '').toLowerCase().includes(query) ||
      player.id.toLowerCase().includes(query)
    ));

    panel.innerHTML = `
      <div class="admin-card">
        <h2>玩家列表（${players.length}）</h2>
        <div class="inline-form">
          <input id="player-search" class="wide" type="text" placeholder="按昵称 / 注册码 / ID 搜索" value="${escapeHtml(playerQuery)}" />
          <span class="muted small">点击「调整贡献」可加减贡献值，操作全部留痕。</span>
        </div>
        <table class="admin-table">
          <thead>
            <tr><th>昵称</th><th>阵营</th><th>贡献</th><th>权重</th><th>能量</th><th>注册码</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${players.slice(0, 200).map((player) => `
              <tr data-user="${escapeHtml(player.id)}">
                <td><strong>${escapeHtml(player.display_name)}</strong></td>
                <td>${escapeHtml(teamName(player.team))}</td>
                <td class="num">${formatNumber(player.total_contribution)}</td>
                <td class="num">${player.weight}</td>
                <td class="num">${player.energy}/${player.energy_cap}</td>
                <td class="muted">${escapeHtml(player.code)}<br /><span class="tag">${player.code_type === 'special' ? '特典' : '普通'}</span></td>
                <td>${player.banned ? '<span class="tag bad">封禁</span>' : '<span class="tag ok">正常</span>'}</td>
                <td>
                  <div class="btn-row">
                    <button class="action-btn" data-op="adjust">调整贡献</button>
                    <button class="action-btn" data-op="weight">调权重</button>
                    <button class="action-btn" data-op="energy">回能量</button>
                    <button class="action-btn" data-op="reset_password">改密码</button>
                    ${player.banned
                      ? '<button class="action-btn" data-op="unban">解封</button>'
                      : '<button class="action-btn danger" data-op="ban">封禁</button>'}
                  </div>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="8" class="muted">没有匹配的玩家。</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    const search = panel.querySelector('#player-search');
    search.addEventListener('input', () => {
      playerQuery = search.value;
      clearTimeout(search._timer);
      search._timer = setTimeout(renderPlayers, 250);
    });

    for (const row of panel.querySelectorAll('tr[data-user]')) {
      const userId = row.dataset.user;
      for (const button of row.querySelectorAll('[data-op]')) {
        button.addEventListener('click', async () => {
          const op = button.dataset.op;
          const name = row.querySelector('strong').textContent;
          let body = { user_id: userId, op };
          if (op === 'adjust') {
            const amount = window.prompt(`调整 ${name} 的贡献值（正数增加，负数扣减）：`);
            if (amount === null) {
              return;
            }
            const reason = window.prompt('调整原因（会写入流水，如「舞台补发」「数据修正」）：') || '管理员调整';
            body = { ...body, amount: Number(amount), reason };
          } else if (op === 'weight') {
            const value = window.prompt(`设置 ${name} 的抽奖权重调整量（在当前权重基础上 +/-）：`, '0');
            if (value === null) {
              return;
            }
            body = { ...body, value: Number(value) };
          } else if (op === 'reset_password') {
            const password = window.prompt(`为 ${name} 设置新密码：`);
            if (!password) {
              return;
            }
            body = { ...body, password };
          }
          try {
            const res = await post('/api/admin/player', body);
            if (res) {
              toast(res.message, 'success');
            }
          } catch (error) {
            toast(error.message || '操作失败', 'error');
          }
        });
      }
    }
  }

  // ---------- 注册码 ----------

  function renderCodes() {
    const panel = elements.panels.codes;
    panel.innerHTML = `
      <div class="admin-card">
        <h2>批量生成注册码</h2>
        <div class="inline-form">
          <input id="codes-count" class="narrow" type="number" min="1" max="5000" value="50" />
          <select id="codes-type">
            <option value="ordinary">普通票</option>
            <option value="special">特典票（初始权重 2）</option>
          </select>
          <input id="codes-note" class="wide" type="text" placeholder="备注（可选，如「预售批次」）" />
          <button id="codes-generate" class="action-btn primary">生成</button>
        </div>
        <div id="codes-generated" class="hidden">
          <p class="helper-text">本次生成的注册码（点链接可复制二维码地址，站点域名按现场公布地址替换）：</p>
          <div class="code-list" id="codes-list"></div>
          <div class="btn-row" style="margin-top: 8px;">
            <button id="codes-copy" class="action-btn">复制全部</button>
            <span class="muted small">二维码地址格式：https://你的域名/?code=注册码</span>
          </div>
        </div>
      </div>

      <div class="admin-card">
        <h2>注册码查询</h2>
        <div class="inline-form">
          <input id="codes-query" class="wide" type="text" placeholder="按码 / 绑定昵称搜索" value="${escapeHtml(codeQuery.query)}" />
          <select id="codes-status-filter">
            <option value="">全部状态</option>
            <option value="unused" ${codeQuery.status === 'unused' ? 'selected' : ''}>未使用</option>
            <option value="bound" ${codeQuery.status === 'bound' ? 'selected' : ''}>已绑定</option>
          </select>
          <button id="codes-search" class="action-btn">查询</button>
          <a class="action-btn" id="codes-export" href="/api/admin/codes/export">导出 CSV</a>
        </div>
        <div id="codes-result"></div>
      </div>
    `;

    let generatedCodes = [];

    panel.querySelector('#codes-generate').addEventListener('click', async () => {
      const count = Number(panel.querySelector('#codes-count').value);
      const type = panel.querySelector('#codes-type').value;
      const note = panel.querySelector('#codes-note').value;
      try {
        const res = await api('POST', '/api/admin/codes/generate', { count, type, note });
        generatedCodes = res.codes;
        const wrap = panel.querySelector('#codes-generated');
        wrap.classList.remove('hidden');
        panel.querySelector('#codes-list').textContent = generatedCodes.join('\n');
        toast(res.message, 'success');
        refresh();
      } catch (error) {
        toast(error.message || '生成失败', 'error');
      }
    });

    panel.querySelector('#codes-copy').addEventListener('click', async () => {
      const lines = generatedCodes.map((code) => `${window.location.origin}/?code=${code}`);
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        toast('已复制全部二维码地址', 'success');
      } catch {
        toast('复制失败，请手动选择文本', 'warn');
      }
    });

    async function runQuery() {
      codeQuery.query = panel.querySelector('#codes-query').value;
      codeQuery.status = panel.querySelector('#codes-status-filter').value;
      const params = new URLSearchParams({ query: codeQuery.query, status: codeQuery.status, limit: '200' });
      try {
        const res = await api('GET', `/api/admin/codes?${params}`);
        const target = panel.querySelector('#codes-result');
        target.innerHTML = `
          <p class="muted small">共 ${res.total} 条${res.total > res.codes.length ? '，仅显示前 ' + res.codes.length + ' 条' : ''}</p>
          <table class="admin-table">
            <thead><tr><th>注册码</th><th>票种</th><th>状态</th><th>绑定玩家</th><th>批次</th><th>操作</th></tr></thead>
            <tbody>
              ${res.codes.map((code) => `
                <tr>
                  <td style="font-family: monospace;">${escapeHtml(code.code)}</td>
                  <td>${code.type === 'special' ? '特典' : '普通'}</td>
                  <td>${code.disabled
                    ? '<span class="tag bad">已禁用</span>'
                    : (code.status === 'bound' ? '<span class="tag ok">已绑定</span>' : '<span class="tag">未使用</span>')}</td>
                  <td>${escapeHtml(code.bound_display_name || '—')}</td>
                  <td class="muted small">${escapeHtml(code.batch_id || '')}</td>
                  <td>
                    ${code.disabled
                      ? `<button class="action-btn" data-code="${escapeHtml(code.code)}" data-disable="false">解禁</button>`
                      : `<button class="action-btn danger" data-code="${escapeHtml(code.code)}" data-disable="true">禁用</button>`}
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="muted">没有匹配的注册码。</td></tr>'}
            </tbody>
          </table>
        `;
        for (const button of target.querySelectorAll('[data-code]')) {
          button.addEventListener('click', async () => {
            try {
              await api('POST', '/api/admin/codes/disable', {
                code: button.dataset.code,
                disabled: button.dataset.disable === 'true'
              });
              toast('操作完成', 'success');
              runQuery();
            } catch (error) {
              toast(error.message || '操作失败', 'error');
            }
          });
        }
      } catch (error) {
        toast(error.message || '查询失败', 'error');
      }
    }

    panel.querySelector('#codes-search').addEventListener('click', runQuery);
    panel.querySelector('#codes-query').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        runQuery();
      }
    });
    if (codeQuery.query || codeQuery.status) {
      runQuery();
    }
  }

  // ---------- 抽奖 ----------

  function renderLottery() {
    const panel = elements.panels.lottery;
    panel.innerHTML = `
      <div class="admin-card">
        <h2>奖池</h2>
        <p class="helper-text">终盘抽奖按玩家当前权重加权随机。已中奖玩家默认不再参与（可作废释放）。</p>
        <table class="admin-table">
          <thead><tr><th>奖品</th><th>来源</th><th>状态</th><th>已抽 / 总数</th><th>操作</th></tr></thead>
          <tbody>
            ${admin.prizes.map((prize) => `
              <tr>
                <td><strong>${escapeHtml(prize.name)}</strong><br /><span class="muted small">${escapeHtml(prize.description)}</span></td>
                <td>${prize.source === 'base' ? '基础奖池' : escapeHtml((admin.regions.find((region) => region.id === prize.source) || {}).name || prize.source)}</td>
                <td>${prize.available ? '<span class="tag ok">已解锁</span>' : '<span class="tag">神秘奖品</span>'}</td>
                <td class="num">${prize.drawn} / ${prize.count}</td>
                <td>
                  <button class="action-btn primary" data-draw="${escapeHtml(prize.id)}"
                    ${!prize.available || prize.remaining <= 0 ? 'disabled' : ''}>抽取</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="admin-card">
        <h2>权重预览（前 100）</h2>
        <table class="admin-table">
          <thead><tr><th>#</th><th>玩家</th><th>阵营</th><th>贡献</th><th>权重</th></tr></thead>
          <tbody>
            ${admin.weights_preview.map((row, index) => `
              <tr>
                <td class="num">${index + 1}</td>
                <td>${escapeHtml(row.display_name)}${row.banned ? ' <span class="tag bad">封禁</span>' : ''}</td>
                <td>${escapeHtml(teamName(row.team))}</td>
                <td class="num">${formatNumber(row.total_contribution)}</td>
                <td class="num">${row.weight}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="admin-card">
        <h2>抽奖记录</h2>
        <table class="admin-table">
          <thead><tr><th>时间</th><th>奖品</th><th>中奖者</th><th>权重快照</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${admin.draws.map((draw) => `
              <tr>
                <td class="muted">${formatTime(draw.drawn_at)}</td>
                <td>${escapeHtml(draw.prize_name)}</td>
                <td><strong>${escapeHtml(draw.winner_display_name)}</strong> <span class="muted">${escapeHtml(teamName(draw.winner_team))}</span></td>
                <td class="num">${draw.weight_snapshot} / 总 ${draw.total_weight_snapshot}</td>
                <td>${draw.status === 'claimed'
                  ? '<span class="tag ok">已领取</span>'
                  : (draw.status === 'void' ? '<span class="tag bad">已作废</span>' : '<span class="tag warn">待领取</span>')}</td>
                <td>
                  <div class="btn-row">
                    ${draw.status === 'pending' ? `<button class="action-btn" data-record="claim" data-draw-id="${escapeHtml(draw.id)}">标记领取</button>` : ''}
                    ${draw.status !== 'void' ? `<button class="action-btn danger" data-record="void" data-draw-id="${escapeHtml(draw.id)}">作废重抽</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="6" class="muted">还没有抽奖记录。</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    for (const button of panel.querySelectorAll('[data-draw]')) {
      button.addEventListener('click', async () => {
        try {
          const res = await post('/api/admin/lottery/draw', { prize_id: button.dataset.draw }, {
            confirmText: '确认执行抽奖？'
          });
          if (res) {
            toast(`${res.message}（权重 ${res.draw.weight_snapshot} / 总 ${res.draw.total_weight_snapshot}）`, 'success');
          }
        } catch (error) {
          toast(error.message || '抽奖失败', 'error');
        }
      });
    }

    for (const button of panel.querySelectorAll('[data-record]')) {
      button.addEventListener('click', async () => {
        const drawId = button.dataset.drawId;
        let body = { draw_id: drawId, op: button.dataset.record };
        if (body.op === 'void') {
          const reason = window.prompt('作废原因（会写入日志）：') || '管理员作废';
          if (!window.confirm('确认作废该中奖记录？作废后该玩家可重新参与抽奖。')) {
            return;
          }
          body = { ...body, reason };
        }
        try {
          const res = await post('/api/admin/lottery/record', body);
          if (res) {
            toast(res.message, 'success');
          }
        } catch (error) {
          toast(error.message || '操作失败', 'error');
        }
      });
    }
  }

  // ---------- 节目事件 ----------

  function renderStage() {
    const panel = elements.panels.stage;
    panel.innerHTML = `
      <div class="admin-card">
        <h2>现场节目联动</h2>
        <p class="helper-text">事件清单来自 shared/seeds/stage-events.json，修改配置并重启即可更新。</p>
        <table class="admin-table">
          <thead><tr><th>事件</th><th>效果</th><th>操作</th></tr></thead>
          <tbody>
            ${admin.stage_events.map((event) => `
              <tr>
                <td><strong>${escapeHtml(event.name)}</strong></td>
                <td class="muted">${escapeHtml(event.description)}</td>
                <td><button class="action-btn primary" data-event="${escapeHtml(event.id)}">触发</button></td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="muted">没有配置节目事件。</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    for (const button of panel.querySelectorAll('[data-event]')) {
      button.addEventListener('click', async () => {
        try {
          const res = await post('/api/admin/stage', { event_id: button.dataset.event });
          if (res) {
            toast(res.message, 'success');
          }
        } catch (error) {
          toast(error.message || '触发失败', 'error');
        }
      });
    }
  }

  // ---------- 日志 ----------

  function renderLogs() {
    const panel = elements.panels.logs;
    panel.innerHTML = `
      <div class="admin-card">
        <h2>管理操作日志（最近 40 条）</h2>
        <div class="log-list">
          ${admin.recent_admin_logs.map((log) => `
            <div class="log-row">
              <time>${formatTime(log.created_at)}</time>
              <span class="log-main">
                <span class="tag">${escapeHtml(log.action)}</span>
                ${escapeHtml(typeof log.detail === 'object' ? JSON.stringify(log.detail) : String(log.detail))}
              </span>
            </div>
          `).join('') || '<p class="muted">暂无日志。</p>'}
        </div>
      </div>
      <div class="admin-card">
        <h2>贡献流水（最近 50 条）</h2>
        <p class="helper-text">完整流水可在服务器 data/ledger.jsonl 查看，或用 data:export 导出。</p>
        <div class="log-list">
          ${admin.recent_contributions.map((entry) => `
            <div class="log-row">
              <time>${formatTime(entry.created_at)}</time>
              <span class="log-main">
                <strong>${escapeHtml(entry.who || '—')}</strong>
                ${entry.region_name ? `在「${escapeHtml(entry.region_name)}」` : ''}
                ${escapeHtml(entry.action_name || '')}
                ${entry.user_delta ? `<b class="${entry.user_delta > 0 ? 'up' : 'down'}"> ${entry.user_delta > 0 ? '+' : ''}${entry.user_delta}</b>` : ''}
                ${entry.anomaly_delta ? `<b class="down"> 异变 -${entry.anomaly_delta}</b>` : ''}
              </span>
              <span class="tag">${escapeHtml(entry.kind)}</span>
            </div>
          `).join('') || '<p class="muted">暂无流水。</p>'}
        </div>
      </div>
    `;
  }

  // ---------- 启动 ----------

  elements.loginBtn.addEventListener('click', async () => {
    clearLoginError();
    try {
      await api('POST', '/api/admin/login', { password: elements.password.value });
      elements.login.classList.add('hidden');
      elements.shell.classList.remove('hidden');
      await refresh();
    } catch (error) {
      showError(error.message || '登录失败');
    }
  });

  elements.password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      elements.loginBtn.click();
    }
  });

  elements.logoutBtn.addEventListener('click', async () => {
    await api('POST', '/api/admin/logout').catch(() => null);
    window.location.reload();
  });

  elements.refreshBtn.addEventListener('click', async () => {
    try {
      await refresh();
      toast('已刷新', 'success');
    } catch (error) {
      toast(error.message || '刷新失败', 'error');
    }
  });

  elements.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab-btn');
    if (button) {
      switchTab(button.dataset.tab);
    }
  });

  function showError(message) {
    elements.loginError.textContent = message;
    elements.loginError.classList.remove('hidden');
  }

  function clearLoginError() {
    elements.loginError.classList.add('hidden');
  }

  // 自动尝试已有会话
  (async () => {
    try {
      await refresh();
      elements.login.classList.add('hidden');
      elements.shell.classList.remove('hidden');
    } catch {
      elements.login.classList.remove('hidden');
      elements.password.focus();
    }
  })();
})();
