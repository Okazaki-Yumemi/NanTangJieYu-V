(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = value => `${value < 0 ? '−' : ''}¥${(Math.abs(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signedMoney = value => `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`;
  let selectedPair = 'kappa_human';
  const pairInfo = (id = selectedPair) => data?.pairs.find(pair => pair.id === id);
  const price = (value, id = selectedPair) => value.toFixed(pairInfo(id)?.precision || 4);
  const currencyName = id => data?.pairs.find(pair => pair.base === id)?.base_name || '河童货币';
  const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
  let data = null, online = false, busy = false, pending = null;
  let timer = null, readController = null, generation = 0, active = true;
  let workTimer = null, serverOffset = 0;
  const newsLabels = { rumor: '小道消息', surge: '市场异动', quake: '金融地震' };
  const impact = bps => Number.isFinite(bps) ? `${bps >= 0 ? '+' : '−'}${(Math.abs(bps) / 100).toFixed(2)}%` : '—';

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
  async function request(path, body, controller = new AbortController(), pairId = selectedPair) {
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/fx/${path}?pair=${encodeURIComponent(pairId)}`, {
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
    const locked = !online || busy || Boolean(pending) || data?.market.pair_id !== selectedPair;
    for (const button of $('fx-pairs').querySelectorAll('button')) button.disabled = busy || Boolean(pending);
    const tradable = Boolean(data?.can_trade && data.account);
    for (const element of $('fx-order').elements) element.disabled = locked || !tradable;
    for (const button of $('fx-positions').querySelectorAll('button')) button.disabled = locked || !tradable;
    for (const button of $('fx-account-action').querySelectorAll('button')) button.disabled = locked || !data?.can_trade;
    const account = data?.account;
    $('fx-borrow').disabled = locked || !tradable || !account.needs_rescue || Boolean(account.debt);
    $('fx-repay').disabled = locked || !tradable || !account.debt || account.cash <= 0;
    $('fx-work').disabled = locked || !tradable || Boolean(account.job);
    $('fx-work-minutes').disabled = locked || !tradable || Boolean(account?.job);
    $('fx-credit-amount').disabled = locked || !tradable || Boolean(account?.credit);
    $('fx-borrow-credit').disabled = locked || !tradable || Boolean(account?.credit);
    $('fx-claim-work').disabled = locked || !tradable || !account.job || Date.now() + serverOffset < account.job.ready_at;
    $('fx-retry').hidden = !pending;
    $('fx-retry').disabled = busy;
    $('fx-title').disabled = locked || !tradable;
    $('fx-set-title').disabled = locked || !tradable;
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
      const duration = job.ready_at - job.started_at;
      $('fx-work-progress').max = duration / 1000;
      $('fx-claim-work').textContent = `下工，领取 ${money(job.pay)}`;
      $('fx-work-progress').value = Math.max(0, (duration - remaining) / 1000);
    } else $('fx-work-status').textContent = !account ? '开户后可以来接活。' : '随时可以接活，同时只能做一份。';
    $('fx-repay').textContent = account?.debt ? `还 ${money(Math.min(account.cash, account.debt))}` : '暂无欠款';
    $('fx-credit-status').textContent = account?.credit ? `本金 ${money(account.credit.principal)} · 已计利息 ${money(account.credit.interest)} · 每小时约 ${money(Math.round(account.credit.principal * data.rules.credit_hourly_rate))}` : '暂无有息贷款';
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
  let chartPeriod = 30, chartPointer = null;
  function drawChart() {
    if (!data?.market || data.market.pair_id !== selectedPair) return;
    const bar = FXChart.draw($('fx-chart'), data.market, chartPeriod, chartPointer);
    $('fx-chart-empty').hidden = Boolean(bar);
    if (bar) $('fx-ohlc').textContent = `${time(bar.at)}  开 ${price(bar.open)}  高 ${price(bar.high)}  低 ${price(bar.low)}  收 ${price(bar.close)}${bar.current ? ' · 形成中' : ''}`;
  }
  function pairLabels(pair) {
    $('market-title').replaceChildren(document.createTextNode(`${pair.base_name} `), node('span', `/ ${pair.quote_name}`));
    $('fx-market-unit').textContent = `1 ${pair.base_name}值多少${pair.quote_name}`;
    $('fx-order-pair').textContent = pair.name;
    $('fx-pair-description').textContent = pair.description;
    for (const button of $('fx-pairs').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.pair === selectedPair));
  }
  function renderPairs() {
    const board = $('fx-pairs');
    for (const pair of data.pairs) {
      let button = [...board.children].find(item => item.dataset.pair === pair.id);
      if (!button) {
        button = node('button', undefined, 'pair-quote'); button.type = 'button'; button.dataset.pair = pair.id;
        button.append(node('span', pair.name), node('strong'), node('small'));
        button.addEventListener('click', () => {
          if (busy || pending || selectedPair === pair.id) return;
          selectedPair = pair.id; online = false; chartPointer = null;
          ++generation; readController?.abort(); clearTimeout(timer);
          pairLabels(pair);
          for (const id of ['fx-price', 'fx-bid', 'fx-ask']) $(id).textContent = '—';
          $('fx-change').textContent = '正在切换'; tone($('fx-change'), 0);
          $('fx-ohlc').textContent = '正在读取行情…';
          $('fx-news-impact').textContent = '';
          $('fx-market-event').textContent = '正在同步本品种的新闻影响…';
          $('fx-chart').getContext('2d')?.clearRect(0, 0, $('fx-chart').width, $('fx-chart').height);
          $('fx-chart-empty').textContent = `正在读取${pair.name}…`; $('fx-chart-empty').hidden = false;
          $('fx-connection').textContent = '同步中';
          updateControls(); void poll();
        });
        board.append(button);
      }
      button.querySelector('strong').textContent = price(pair.price, pair.id);
      const change = (pair.price / pair.previous - 1) * 10000;
      const label = button.querySelector('small'); label.textContent = `${impact(change)} / 本拍`; tone(label, change);
    }
    pairLabels(pairInfo());
  }
  function renderNews(market) {
    const news = market.news;
    const effect = market.event_effect;
    $('fx-news-type').textContent = newsLabels[news.tier] || '文文快讯';
    $('fx-news').textContent = news.headline ? `${news.headline}：${news.text}` : news.text;
    $('fx-news-impact').textContent = Number.isFinite(news.change_bps) ? `${time(news.at)} · 主涉${currencyName(news.currency)} · 本品种当拍 ${impact(news.change_bps)} · ${news.source || '文文日报'}（虚构）` : '';
    tone($('fx-news-impact'), news.change_bps || 0);
    $('fx-ticker').dataset.tier = effect?.tier || 'quiet';
    const status = $('fx-market-event');
    status.textContent = effect
      ? `${currencyName(effect.currency)} · ${newsLabels[effect.tier]}余震，后续约 ${effect.remaining_ticks * data.rules.tick_ms / 1000} 秒波动放大，其他货币受较弱影响。`
      : '当前正常波动。图上圆点 = 新闻事件，绿色上涨，红色下跌。';
    status.dataset.active = String(Boolean(effect));
    const history = market.news_history || [];
    $('fx-news-count').textContent = history.length;
    const list = $('fx-news-history');
    const key = `${selectedPair}:${history.map(item => item.id).join(',')}`;
    if (list.dataset.entries === key) return;
    list.dataset.entries = key;
    list.replaceChildren(...history.map(item => {
      const row = node('li');
      const header = node('div', undefined, 'news-heading');
      header.append(node('span', `${time(item.at)} · ${currencyName(item.currency)} · ${newsLabels[item.tier] || '快讯'}`));
      const change = node('b', impact(item.change_bps)); tone(change, item.change_bps); header.append(change);
      row.append(header, node('strong', item.headline), node('p', item.text));
      return row;
    }));
    if (!history.length) list.append(node('li', '还没有突发新闻。', 'empty'));
  }
  function renderProfile(account, previous) {
    const profile = account?.profile, stats = profile?.stats;
    const catalog = data.achievements || [];
    const unlocked = profile?.unlocked || {};
    $('fx-achievement-count').textContent = `成就 ${Object.keys(unlocked).length} / ${catalog.length}`;
    const selector = $('fx-title'), key = JSON.stringify([Object.keys(unlocked), profile?.title_id]);
    if (selector.dataset.entries !== key) {
      selector.dataset.entries = key;
      const none = node('option', '未挂名交易员'); none.value = '';
      selector.replaceChildren(none, ...catalog.filter(item => Object.hasOwn(unlocked, item.id)).map(item => {
        const option = node('option', item.title); option.value = item.id; return option;
      }));
      selector.value = profile?.title_id || '';
    }
    $('fx-career').replaceChildren(...(stats ? [
      ['累计结算盈亏', signedMoney(stats.realized_pnl)], ['盈利 / 亏损', `${stats.wins} / ${stats.losses} 笔`],
      ['最高净资产', money(stats.peak_equity)], ['打工所得', money(stats.work_earned)],
      ['累计开仓', `${stats.opened} 笔`], ['持仓经历新闻', `${stats.news_count || 0} / ${data.news_total}`],
    ].map(([label, value]) => { const item = node('div'); item.append(node('span', label), node('strong', value)); return item; }) : []));
    $('fx-achievements').replaceChildren(...catalog.map(item => {
      const earned = Object.hasOwn(unlocked, item.id);
      const card = node('article', undefined, `achievement ${earned ? 'earned' : ''}`);
      card.append(node('strong', `${earned ? '✓ ' : ''}${item.title}`), node('p', item.description));
      const value = Math.min(item.target, Math.max(0, stats?.[item.stat] || 0));
      const progress = node('progress'); progress.max = item.target; progress.value = value;
      progress.setAttribute('aria-label', `${item.title}进度`);
      const label = earned ? `已达成 · ${new Date(unlocked[item.id]).toLocaleDateString('zh-CN')}` : item.stat === 'peak_equity' ? `${money(value)} / ${money(item.target)}` : `${value} / ${item.target}`;
      card.append(progress, node('small', label)); return card;
    }));
    if (previous?.profile) {
      const fresh = catalog.filter(item => Object.hasOwn(unlocked, item.id) && !Object.hasOwn(previous.profile.unlocked, item.id));
      if (fresh.length) $('fx-achievement-message').textContent = `新成就：${fresh.map(item => item.title).join('、')}。可在下方挂牌。`;
    }
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
      const pair = pairInfo(position.pair_id);
      let item = [...container.children].find(child => child.dataset.id === position.id);
      if (!item) {
        item = node('article', undefined, 'position'); item.dataset.id = position.id;
        const content = node('div');
        const heading = node('div', undefined, 'position-heading');
        heading.append(node('span', position.side === 'long' ? '做多' : '做空', `side ${position.side === 'short' ? 'short-tag' : ''}`), node('strong', `${pair.name} · ${position.leverage}×`));
        const details = node('div', undefined, 'position-details');
        details.append(node('span', `开仓 ${price(position.entry_price, position.pair_id)}`), node('span', `保证金 ${money(position.margin)}`), node('span', '', 'position-exit'));
        content.append(heading, details);
        const result = node('div', undefined, 'position-result'); result.append(node('strong', '', 'position-pnl'));
        const close = node('button', '平仓'); close.type = 'button';
        close.setAttribute('aria-label', `平仓：${pair.name} ${position.side === 'long' ? '做多' : '做空'} ${position.leverage} 倍，开仓价 ${price(position.entry_price, position.pair_id)}`);
        close.addEventListener('click', () => submit('close', { position_id: position.id, pair_id: position.pair_id }));
        result.append(close); item.append(content, result); container.append(item);
      }
      const pnl = item.querySelector('.position-pnl'); pnl.textContent = signedMoney(position.pnl); tone(pnl, position.pnl);
      item.querySelector('.position-exit').textContent = `平仓报价 ${price(position.exit_price, position.pair_id)} ${pair.quote_name}`;
    }
    if (!positions.length) container.replaceChildren(node('p', '还没有持仓。先看看市场往哪边走。', 'empty'));
    const history = account?.history || [];
    $('fx-history-count').textContent = history.length;
    $('fx-history').replaceChildren(...history.map(entry => {
      const item = node('div', undefined, 'history-row');
      const info = node('div', `${pairInfo(entry.pair_id).name} · ${entry.side === 'long' ? '做多' : '做空'} ${entry.leverage}× · ${entry.reason === 'liquidation' ? '触发强平' : '手动平仓'}`);
      info.append(node('small', `${time(entry.closed_at)} · ${price(entry.entry_price, entry.pair_id)} → ${price(entry.exit_price, entry.pair_id)}`));
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
    renderPairs();
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
    renderProfile(account, previous?.account);
    $('fx-player-count').textContent = `${data.total_players} 位交易者`;
    $('fx-leaderboard').replaceChildren(...data.rows.map(row => {
      const item = node('li', undefined, row.is_me ? 'is-me' : '');
      const name = node('span', `${row.display_name}${row.is_me ? ' · 我' : ''}`, 'name');
      name.append(node('small', row.title || '未挂名交易员', 'board-title'));
      item.append(node('span', String(row.rank).padStart(2, '0'), 'rank'), name, node('strong', money(row.equity)));
      return item;
    }));
    if (!data.rows.length) $('fx-leaderboard').append(node('li', '暂时还没有人开户。', 'empty'));
    if (!previous && !pending) message(!data.authenticated ? '登录后领取模拟资金，开始交易。' : !data.can_trade ? '这个账号不能参与交易。' : account ? '账户已同步，可以继续交易。' : '先领取初始资金，再开第一笔交易。');
    else if (reconnected && !pending && !busy) message(previous.market.pair_id !== selectedPair ? `已切换至${pairInfo().name}，持仓仍显示全部品种。` : '连接已恢复，行情和账户已同步。');
    const liquidation = account?.history.find(entry => entry.reason === 'liquidation');
    if (liquidation && previous?.account && !previous.account.history.some(entry => entry.id === liquidation.id) && !pending) message('有持仓触发强平，请查看最近结算。', true);
    preview(); drawChart(); updateWork();
  }
  function schedule() {
    clearTimeout(timer);
    // 靠近下一拍开头同步，避免请求耗时让轮询相位逐渐落后。
    const nextTick = data?.market.updated_at + (data?.rules.tick_ms || 2000);
    const delay = online && Number.isFinite(nextTick)
      ? Math.max(200, Math.min(2000, nextTick - (Date.now() + serverOffset) + 100)) : 2000;
    if (active && !document.hidden) timer = setTimeout(poll, delay);
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
    if (busy || !online || !data || pending || data.market.pair_id !== selectedPair) return;
    pending = { action, pair: selectedPair, body: {
      request_id: `fx_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
      expected_revision: data.account?.revision || 0, pair_id: selectedPair, ...fields,
      ...(['open', 'close'].includes(action) ? { quote_seq: data.market.seq } : {}),
    } };
    await sendPending();
  }
  async function sendPending() {
    if (!pending || busy) return;
    busy = true; ++generation; readController?.abort(); clearTimeout(timer); updateControls();
    message('正在确认成交…');
    try {
      const result = await request(pending.action, pending.body, undefined, pending.pair);
      const action = pending.action; pending = null;
      if (result.market) render(result);
      if (result.error) message(result.message, true);
      else if (result.receipt) {
        const r = result.receipt, pairId = r.pair_id || 'kappa_human';
        message(`${result.repeated ? '原成交已确认，无重复记账。' : '已成交。'}${pairInfo(pairId).name} · ${r.action === 'open' ? `开仓价 ${price(r.price, pairId)}，保证金 ${money(r.margin)}，手续费 ${money(r.fee)}，共扣 ${money(r.amount)}` : `平仓价 ${price(r.price, pairId)}，返还保证金及盈亏 ${money(r.amount)}`}`);
      } else message(result.repeated ? '已确认上一笔操作，没有重复记账。' : ({ join: '已领取 ¥10,000 模拟资金。', open: '已成交。', close: '已平仓，资金到账。', borrow: '到账 ¥5,000。无息借款，记得还。', 'borrow-credit': '有息贷款已到账，每小时单利 0.5%。', repay: '还款已入账。', 'set-title': '称号已挂牌，富豪榜同步展示。', work: '已接活，做满所选时长后回来领工钱。', 'claim-work': '工钱已到账。' })[action]);
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
  $('fx-set-title').addEventListener('click', () => submit('set-title', { title: $('fx-title').value || null }));
  for (const action of ['borrow', 'repay', 'claim-work']) {
    $(`fx-${action}`).addEventListener('click', () => submit(action));
  }
  $('fx-work').addEventListener('click', () => submit('work', { minutes: Number($('fx-work-minutes').value) }));
  $('fx-borrow-credit').addEventListener('click', () => {
    const amount = Math.round(Number($('fx-credit-amount').value) * 100);
    if (!Number.isSafeInteger(amount) || amount < data.rules.credit_min || amount > data.rules.credit_limit) return message('请输入 100～50,000 人里元。', true);
    void submit('borrow-credit', { amount });
  });
  for (const button of document.querySelectorAll('[data-period]')) button.addEventListener('click', () => {
    chartPeriod = Number(button.dataset.period); chartPointer = null;
    for (const other of document.querySelectorAll('[data-period]')) other.setAttribute('aria-pressed', String(other === button));
    drawChart();
  });
  $('fx-chart').addEventListener('pointermove', event => { chartPointer = event.clientX - $('fx-chart').getBoundingClientRect().left; drawChart(); });
  $('fx-chart').addEventListener('pointerleave', () => { chartPointer = null; drawChart(); });
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
