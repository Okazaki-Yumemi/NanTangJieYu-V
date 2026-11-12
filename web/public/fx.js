(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = value => `${value < 0 ? '−' : ''}¥${(Math.abs(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signedMoney = value => `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`;
  const price = value => value.toFixed(4);
  const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
  let data = null, online = false, busy = false, pending = null;
  let timer = null, readController = null, generation = 0, active = true;
  let workTimer = null, serverOffset = 0;
  const newsLabels = { rumor: '小道消息', surge: '市场异动', quake: '金融地震' };
  const impact = bps => `${bps >= 0 ? '+' : '−'}${(Math.abs(bps) / 100).toFixed(2)}%`;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function tone(element, amount) {
    element.classList.toggle('positive', amount > 0);
    element.classList.toggle('negative', amount < 0);
  }
  function message(text, error = false) {
    $('fx-message').textContent = text;
    $('fx-message').classList.toggle('negative', error);
  }
  async function request(path, body, controller = new AbortController()) {
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/fx/${path}`, {
        method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      // 5xx 的保存结果可能不确定，保留原请求编号供重试。
      if (response.status >= 500) throw new Error(result.message || '交易所暂时不可用');
      return result;
    } finally { clearTimeout(timeout); }
  }
  function updateControls() {
    const locked = !online || busy || Boolean(pending);
    const tradable = Boolean(data?.can_trade && data.account);
    for (const element of $('fx-order').elements) element.disabled = locked || !tradable;
    for (const button of $('fx-positions').querySelectorAll('button')) button.disabled = locked || !tradable;
    for (const button of $('fx-account-action').querySelectorAll('button')) button.disabled = locked || !data?.can_trade;
    const account = data?.account;
    $('fx-borrow').disabled = locked || !tradable || !account.needs_rescue || Boolean(account.debt);
    $('fx-repay').disabled = locked || !tradable || !account.debt || account.cash <= 0;
    $('fx-work').disabled = locked || !tradable || !account.needs_rescue || Boolean(account.job);
    $('fx-claim-work').disabled = locked || !tradable || !account.job || Date.now() + serverOffset < account.job.ready_at;
    $('fx-retry').hidden = !pending;
    $('fx-retry').disabled = busy;
  }
  function updateWork() {
    const account = data?.account;
    const job = account?.job;
    const remaining = job ? Math.max(0, job.ready_at - (Date.now() + serverOffset)) : 0;
    $('fx-work').hidden = Boolean(job);
    $('fx-claim-work').hidden = !job || remaining > 0;
    $('fx-work-progress').hidden = !job;
    if (job) {
      const seconds = Math.ceil(remaining / 1000);
      $('fx-work-status').textContent = seconds > 0
        ? `拧螺丝中，还剩 ${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒。`
        : '活干完了，工钱等你来领。';
      $('fx-work-progress').max = data.rules.work_ms / 1000;
      $('fx-work-progress').value = Math.max(0, (data.rules.work_ms - remaining) / 1000);
    } else $('fx-work-status').textContent = !account ? '开户后，没钱时可以来接活。' : account.needs_rescue ? '没钱炒汇，就先拧会儿螺丝。' : '还没到进厂的时候，手里有钱就先用着。';
    $('fx-repay').textContent = account?.debt ? `还 ${money(Math.min(account.cash, account.debt))}` : '暂无欠款';
    updateControls();
  }
  function preview() {
    if (!data) return;
    const margin = Math.round(Number($('fx-margin').value) * 100);
    const leverage = Number($('fx-leverage').value);
    const valid = Number.isSafeInteger(margin) && margin > 0;
    $('fx-notional').textContent = valid ? money(margin * leverage) : '—';
    $('fx-fee').textContent = valid ? money(Math.ceil(margin * leverage * data.rules.fee_rate)) : '—';
    $('fx-risk').textContent = `${Math.max(0, (1 - data.rules.maintenance_rate) / leverage * 100 - data.rules.half_spread * 200).toFixed(2)}%`;
  }
  function drawChart() {
    if (!data?.market) return;
    const canvas = $('fx-chart');
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const history = data.market.history;
    const values = history.map(point => point.price);
    const min = Math.min(...values), max = Math.max(...values);
    const padding = Math.max((max - min) * .18, data.market.price * .002);
    const low = min - padding, high = max + padding;
    const left = 6, right = rect.width - 61, top = 15, bottom = rect.height - 28;
    const x = index => left + (right - left) * index / Math.max(1, values.length - 1);
    const y = value => bottom - (value - low) / (high - low) * (bottom - top);
    ctx.font = '10px Segoe UI, sans-serif'; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const value = low + (high - low) * i / 4, height = y(value);
      ctx.strokeStyle = '#d7dce0'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(left, height); ctx.lineTo(right, height); ctx.stroke();
      ctx.fillStyle = '#697580'; ctx.fillText(value.toFixed(2), right + 9, height + 3);
    }
    ctx.setLineDash([]);
    ctx.beginPath(); values.forEach((value, i) => i ? ctx.lineTo(x(i), y(value)) : ctx.moveTo(x(i), y(value)));
    ctx.strokeStyle = '#405e99'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(x(values.length - 1), y(values.at(-1)), 2.5, 0, Math.PI * 2); ctx.fillStyle = '#405e99'; ctx.fill();
    for (const news of data.market.news_history || []) {
      const index = history.findIndex(point => point.at === news.at);
      if (index < 0) continue;
      ctx.fillStyle = news.change_bps >= 0 ? '#23764f' : '#ae343b';
      ctx.beginPath(); ctx.arc(x(index), y(values[index]), news.tier === 'quake' ? 5 : 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = '#748073'; ctx.fillText(time(history[0].at), left, rect.height - 7);
    if (values.length > 1) { ctx.textAlign = 'right'; ctx.fillText(time(history.at(-1).at), right, rect.height - 7); }
    canvas.setAttribute('aria-label', `河童货币兑人里元走势，最近 ${values.length} 拍，最低 ${price(min)}，最高 ${price(max)}，最新 ${price(data.market.price)}`);
    $('fx-chart-empty').hidden = values.length > 1;
    $('fx-chart-empty').textContent = '开市第一拍，等待下一笔报价…';
  }
  function renderNews(market) {
    const news = market.news;
    const effect = market.event_effect;
    $('fx-news-type').textContent = newsLabels[news.tier] || '文文快讯';
    $('fx-news').textContent = news.headline ? `${news.headline}：${news.text}` : news.text;
    $('fx-news-impact').textContent = Number.isFinite(news.change_bps) ? `${time(news.at)} · 事件当拍 ${impact(news.change_bps)} · 文文日报（虚构）` : '';
    tone($('fx-news-impact'), news.change_bps || 0);
    $('fx-ticker').dataset.tier = effect?.tier || 'quiet';
    const status = $('fx-market-event');
    status.textContent = effect
      ? `${newsLabels[effect.tier]}余震 · 后续约 ${effect.remaining_ticks * data.rules.tick_ms / 1000} 秒波动放大，方向不定。`
      : '当前正常波动。图上圆点 = 新闻事件，绿色上涨，红色下跌。';
    status.dataset.active = String(Boolean(effect));
    const history = market.news_history || [];
    $('fx-news-count').textContent = history.length;
    const list = $('fx-news-history');
    const key = history.map(item => item.id).join(',');
    if (list.dataset.entries === key) return;
    list.dataset.entries = key;
    list.replaceChildren(...history.map(item => {
      const row = node('li');
      const header = node('div', undefined, 'news-heading');
      header.append(node('span', `${time(item.at)} · ${newsLabels[item.tier] || '快讯'}`));
      const change = node('b', impact(item.change_bps)); tone(change, item.change_bps); header.append(change);
      row.append(header, node('strong', item.headline), node('p', item.text));
      return row;
    }));
    if (!history.length) list.append(node('li', '还没有突发新闻。', 'empty'));
  }
  function renderPositions(account) {
    const container = $('fx-positions');
    const positions = account?.positions || [];
    $('fx-position-count').textContent = `${positions.length} / ${data.rules.max_positions}`;
    // 原地更新行情数值，避免轮询替换用户正在点按或聚焦的平仓按钮。
    for (const child of [...container.children]) {
      if (!positions.some(position => position.id === child.dataset.id)) child.remove();
    }
    for (const position of positions) {
      let item = [...container.children].find(child => child.dataset.id === position.id);
      if (!item) {
        item = node('article', undefined, 'position'); item.dataset.id = position.id;
        const content = node('div');
        const heading = node('div', undefined, 'position-heading');
        heading.append(node('span', position.side === 'long' ? '做多' : '做空', `side ${position.side === 'short' ? 'short-tag' : ''}`), node('strong', `河童货币 · ${position.leverage}×`));
        const details = node('div', undefined, 'position-details');
        details.append(node('span', `开仓 ${price(position.entry_price)}`), node('span', `保证金 ${money(position.margin)}`));
        content.append(heading, details);
        const result = node('div', undefined, 'position-result'); result.append(node('strong', '', 'position-pnl'));
        const close = node('button', '平仓'); close.type = 'button';
        close.setAttribute('aria-label', `平仓：${position.side === 'long' ? '做多' : '做空'} ${position.leverage} 倍，开仓价 ${price(position.entry_price)}`);
        close.addEventListener('click', () => submit('close', { position_id: position.id }));
        result.append(close); item.append(content, result); container.append(item);
      }
      const pnl = item.querySelector('.position-pnl'); pnl.textContent = signedMoney(position.pnl); tone(pnl, position.pnl);
    }
    if (!positions.length) container.replaceChildren(node('p', '还没有持仓。先看看市场往哪边走。', 'empty'));
    const history = account?.history || [];
    $('fx-history-count').textContent = history.length;
    $('fx-history').replaceChildren(...history.map(entry => {
      const item = node('div', undefined, 'history-row');
      const info = node('div', `${entry.side === 'long' ? '做多' : '做空'} ${entry.leverage}× · ${entry.reason === 'liquidation' ? '触发强平' : '手动平仓'}`);
      info.append(node('small', `${time(entry.closed_at)} · ${price(entry.entry_price)} → ${price(entry.exit_price)}`));
      const pnl = node('strong', signedMoney(entry.net_pnl)); tone(pnl, entry.net_pnl); item.append(info, pnl); return item;
    }));
    if (!history.length) $('fx-history').append(node('p', '还没有结算记录。', 'empty'));
  }
  function render(next) {
    const previous = data;
    const reconnected = Boolean(previous && !online);
    data = next; online = true;
    serverOffset = data.server_time - Date.now();
    const { market, account } = data;
    $('fx-connection').textContent = '● 已同步'; $('fx-connection').classList.remove('offline');
    $('fx-price').textContent = price(market.price);
    const change = (market.price / market.previous - 1) * 100;
    $('fx-change').textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% / 本拍`; tone($('fx-change'), change);
    $('fx-bid').textContent = price(market.bid); $('fx-ask').textContent = price(market.ask);
    renderNews(market); $('fx-updated').textContent = `${time(market.updated_at)} · 每 2 秒一拍`;
    $('fx-equity').textContent = account ? money(account.equity) : '—';
    $('fx-cash').textContent = account ? money(account.cash) : '—';
    $('fx-margin-used').textContent = account ? money(account.used_margin) : '—';
    $('fx-debt').textContent = account ? money(account.debt) : '—';
    $('fx-pnl').textContent = account ? signedMoney(account.floating_pnl) : '—'; tone($('fx-pnl'), account?.floating_pnl || 0);
    $('fx-rank').textContent = data.my_rank ? `全服第 ${data.my_rank} 名 / ${data.total_players} 人` : '单位：人里元 ¥';
    const action = $('fx-account-action');
    const accountMode = !data.authenticated ? 'login' : !data.can_trade ? 'banned' : !account ? 'join' : 'ready';
    if (action.dataset.mode !== accountMode) {
      action.dataset.mode = accountMode; action.replaceChildren();
      if (accountMode === 'login') { const link = node('a', '登录校园账号', 'button'); link.href = '/#login-name'; action.append(link); }
      else if (accountMode === 'join') {
        const button = node('button', '开户 · 领取 ¥10,000');
        button.type = 'button'; button.addEventListener('click', () => submit(accountMode)); action.append(button);
      } else action.append(node('span', accountMode === 'banned' ? '账户不可交易' : '模拟账户', 'account-label'));
    }
    renderPositions(account);
    $('fx-player-count').textContent = `${data.total_players} 位交易者`;
    $('fx-leaderboard').replaceChildren(...data.rows.map(row => {
      const item = node('li', undefined, row.is_me ? 'is-me' : '');
      item.append(node('span', String(row.rank).padStart(2, '0'), 'rank'), node('span', `${row.display_name}${row.is_me ? ' · 我' : ''}`, 'name'), node('strong', money(row.equity)));
      return item;
    }));
    if (!data.rows.length) $('fx-leaderboard').append(node('li', '暂时还没有人开户。', 'empty'));
    if (!previous && !pending) message(!data.authenticated ? '登录后领取模拟资金，开始交易。' : !data.can_trade ? '这个账号不能参与交易。' : account ? '账户已同步，可以继续交易。' : '先领取初始资金，再开第一笔交易。');
    else if (reconnected && !pending && !busy) message('连接已恢复，行情和账户已同步。');
    const liquidation = account?.history.find(entry => entry.reason === 'liquidation');
    if (liquidation && previous?.account && !previous.account.history.some(entry => entry.id === liquidation.id) && !pending) message('有持仓触发强平，请查看最近结算。', true);
    preview(); drawChart(); updateWork();
  }
  function schedule() {
    clearTimeout(timer);
    if (active && !document.hidden) timer = setTimeout(poll, 2000);
  }
  async function poll() {
    if (!active || document.hidden || busy) return schedule();
    readController?.abort();
    const controller = new AbortController(); readController = controller;
    const current = ++generation;
    try {
      const result = await request('state', undefined, controller);
      if (current !== generation || !active) return;
      if (result.error) throw new Error(result.message);
      render(result);
    } catch {
      if (current !== generation || !active) return;
      online = false; $('fx-connection').textContent = '连接中断'; $('fx-connection').classList.add('offline');
      message(pending ? '上一笔交易结果尚未确认，请恢复连接后重试确认。' : '行情同步失败，交易已暂停；正在重新连接。', true); updateControls();
    } finally { if (current === generation) schedule(); }
  }
  async function submit(action, fields = {}) {
    if (busy || !online || !data || pending) return;
    pending = { action, body: {
      request_id: `fx_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
      expected_revision: data.account?.revision || 0, ...fields,
      ...(action === 'open' ? { quote_seq: data.market.seq } : {}),
    } };
    await sendPending();
  }
  async function sendPending() {
    if (!pending || busy) return;
    busy = true; ++generation; readController?.abort(); clearTimeout(timer); updateControls();
    message('正在确认成交…');
    try {
      const result = await request(pending.action, pending.body);
      const action = pending.action; pending = null;
      if (result.market) render(result);
      if (result.error) message(result.message, true);
      else message(result.repeated ? '已确认上一笔操作，没有重复记账。' : ({ join: '已领取 ¥10,000 模拟资金。', open: '已成交。', close: '已平仓，资金到账。', borrow: '到账 ¥3,000。无息借款，记得还。', repay: '还款已入账。', work: '已接活，15 分钟后回来领工钱。', 'claim-work': '辛苦了，¥1,500 工钱已到账。' })[action]);
    } catch {
      online = false; $('fx-connection').textContent = '结果待确认'; $('fx-connection').classList.add('offline');
      message('连接中断，成交结果尚未确认。点击下方按钮确认，不会重复扣款。', true);
    } finally { busy = false; updateControls(); schedule(); }
  }
  $('fx-order').addEventListener('submit', event => {
    event.preventDefault();
    const side = event.submitter?.value;
    if (!['long', 'short'].includes(side)) return;
    const margin = Math.round(Number($('fx-margin').value) * 100);
    const leverage = Number($('fx-leverage').value);
    if (!data || !Number.isSafeInteger(margin) || margin < data.rules.min_margin || margin > data.rules.max_margin) return message('保证金至少为 ¥100，请输入有效金额。', true);
    if (margin + Math.ceil(margin * leverage * data.rules.fee_rate) > data.account.cash) return message('余额不足，请减少保证金或使用「最大」。', true);
    void submit('open', { side, margin, leverage });
  });
  $('fx-margin').addEventListener('input', preview);
  $('fx-leverage').addEventListener('change', preview);
  $('fx-max').addEventListener('click', () => {
    if (!data?.account) return;
    const factor = Number($('fx-leverage').value) * data.rules.fee_rate;
    let margin = Math.min(data.rules.max_margin, Math.floor(data.account.cash / (1 + factor)));
    while (margin + Math.ceil(margin * factor) > data.account.cash) margin--;
    $('fx-margin').value = (margin / 100).toFixed(2); preview();
  });
  $('fx-retry').addEventListener('click', sendPending);
  for (const action of ['borrow', 'repay', 'work', 'claim-work']) {
    $(`fx-${action}`).addEventListener('click', () => submit(action));
  }
  window.addEventListener('resize', drawChart);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { ++generation; readController?.abort(); clearTimeout(timer); clearInterval(workTimer); workTimer = null; }
    else { startWorkTimer(); void poll(); }
  });
  function startWorkTimer() { if (workTimer === null) workTimer = setInterval(updateWork, 1000); }
  window.addEventListener('pagehide', () => { active = false; ++generation; readController?.abort(); clearTimeout(timer); clearInterval(workTimer); workTimer = null; });
  window.addEventListener('pageshow', event => { if (event.persisted) { active = true; startWorkTimer(); void poll(); } });
  document.querySelector('.manual-link').addEventListener('click', () => { $('fx-rules').open = true; });
  updateControls(); startWorkTimer(); void poll();
})();
