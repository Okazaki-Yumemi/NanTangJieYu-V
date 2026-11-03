(() => {
  'use strict';

  const size = 6;
  const colors = ['桃', '竹', '靛', '栗', '藤'];
  const board = document.getElementById('dye-board');
  const status = document.getElementById('dye-status');
  const scoreNote = document.getElementById('dye-score-note');
  const mode = document.getElementById('dye-mode');
  const rules = document.getElementById('dye-rules');
  const sequence = document.getElementById('dye-sequence');
  const undo = document.getElementById('dye-undo');
  const newButton = document.getElementById('dye-new');
  const palette = [...document.querySelectorAll('.dye-palette button')];
  // Each recipe is a shortest solution, verified by exhaustive breadth-first search.
  const designs = [
    ['123101134201243141322310320400413110', '34203104'],
    ['133422020011420314432332300244334231', '023023124'],
    ['221210104320314214201244344011340130', '123201034'],
    ['411114242221441000130311023444444210', '121034012'],
    ['141401321220223424031111441202413041', '323120314'],
    ['441413134203322411003320410222431312', '130342013'],
    ['412301020434040022322401041204401334', '0202123014'],
    ['424230441434103103242303312424221232', '143021324'],
    ['044214322044403303241421204341021201', '3203434120'],
    ['304013042101131023411244033431022034', '01401020314'],
    ['424211300303303310042141023214402003', '3023120134'],
    ['234442444404234042304134201401321330', '41230142'],
  ];
  const dailyKey = 'ntj-dye-daily-v1';
  const cells = Array.from({ length: size * size }, () => {
    const cell = document.createElement('span');
    cell.className = 'dye-cell';
    cell.setAttribute('aria-hidden', 'true');
    board.append(cell);
    return cell;
  });
  const neighbors = cells.map((_, i) => [
    i >= size ? i - size : -1,
    i % size ? i - 1 : -1,
    i % size < size - 1 ? i + 1 : -1,
    i < size * (size - 1) ? i + size : -1,
  ].filter((next) => next >= 0));
  let original;
  let cloth;
  let limit;
  let history;
  let supplies;
  let dailyDate;
  let practiceIndex = -1;
  let previousWet;
  let resultVersion = 0;

  async function submitDaily() {
    if (!window.NTJArcadeScores) return;
    const version = ++resultVersion;
    scoreNote.hidden = false;
    scoreNote.textContent = '正在登记今日成绩…';
    const result = await window.NTJArcadeScores.submit('dye', { mode: dailyDate, score: 100 - history.length });
    if (version !== resultVersion) return;
    scoreNote.textContent = result.ok
      ? (result.improved ? '今日成绩已上榜。' : '榜上已有你的今日成绩。')
      : (result.message || '这次成绩未能登记。');
  }

  function connected(values) {
    const wet = new Set([0]);
    for (const i of wet) {
      for (const next of neighbors[i]) if (values[next] === values[0]) wet.add(next);
    }
    return wet;
  }

  function isDaily() {
    return mode.value === 'daily';
  }

  function isStamped() {
    try { return localStorage.getItem(dailyKey) === dailyDate; }
    catch { return false; }
  }

  function renderSequence() {
    const stamps = history.map(({ color }) => {
      const stamp = document.createElement('span');
      stamp.dataset.dye = color;
      stamp.textContent = colors[color];
      return stamp;
    });
    sequence.replaceChildren(...stamps);
  }

  function render() {
    const wet = connected(cloth);
    const won = wet.size === cloth.length;
    cells.forEach((cell, i) => {
      cell.dataset.dye = cloth[i];
      cell.textContent = colors[cloth[i]];
      cell.toggleAttribute('data-wet', wet.has(i));
      cell.toggleAttribute('data-fresh', Boolean(previousWet && wet.has(i) && !previousWet.has(i)));
    });
    previousWet = wet;
    const rows = Array.from({ length: size }, (_, row) => cloth.slice(row * size, (row + 1) * size).map((color) => colors[color]).join(' '));
    board.setAttribute('aria-label', `染布棋盘。${rows.join('；')}`);
    const left = limit - history.length;
    if (won) {
      if (isDaily()) {
        try { localStorage.setItem(dailyKey, dailyDate); }
        catch { /* Private browsing can prevent storage. */ }
      }
      status.textContent = `整块布染好了，共用 ${history.length} 勺染料。`;
    } else {
      status.textContent = left ? `余 ${left} 次 · 已染 ${wet.size}/${cloth.length} 格` : '染料用完了，试试换一条路线。';
    }
    rules.textContent = isDaily()
      ? `${dailyDate} · ${limit} 次染料，各色分开计量${won || isStamped() ? ' · 今日已完成' : ''}`
      : `最少 ${limit - 2} 步，给你两次余量。可撤销，不限单色用量。`;
    renderSequence();
    palette.forEach((button, color) => {
      const available = supplies[color] - history.filter((move) => move.color === color).length;
      button.disabled = won || !left || (isDaily() && !available);
      button.setAttribute('aria-pressed', String(color === cloth[0]));
      button.replaceChildren(document.createTextNode(colors[color]));
      if (isDaily()) {
        const count = document.createElement('small');
        count.textContent = `余 ${available}`;
        button.append(count);
      }
      button.setAttribute('aria-label', isDaily() ? `选${colors[color]}染，剩余 ${available} 次` : `选${colors[color]}染`);
    });
    undo.hidden = isDaily();
    undo.disabled = !history.length || won;
    newButton.hidden = isDaily();
  }

  function retry() {
    resultVersion += 1;
    scoreNote.hidden = true;
    cloth = original.slice();
    history = [];
    previousWet = null;
    render();
  }

  function newCloth() {
    // Use the event's Shanghai calendar so devices share the same board for the day.
    const eventTime = Date.now() + 8 * 60 * 60 * 1000;
    const day = Math.floor(eventTime / 86400000);
    dailyDate = new Date(eventTime).toISOString().slice(0, 10);
    if (!isDaily()) {
      practiceIndex = practiceIndex < 0
        ? Math.floor(Math.random() * designs.length)
        : (practiceIndex + 1 + Math.floor(Math.random() * (designs.length - 1))) % designs.length;
    }
    const index = isDaily() ? day % designs.length : practiceIndex;
    const [pattern, recipe] = designs[index];
    const variation = isDaily() ? Math.floor(day / designs.length) : Math.floor(Math.random() * 10);
    const recolor = (color) => (Number(color) + variation) % colors.length;
    original = cells.map((_, i) => {
      const source = variation % 2 ? i % size * size + Math.floor(i / size) : i;
      return recolor(pattern[source]);
    });
    supplies = colors.map((_, index) => [...recipe].filter((color) => recolor(color) === index).length);
    limit = recipe.length + (isDaily() ? 0 : 2);
    retry();
    window.NTJArcadeScores?.mount(document.getElementById('dye-leaderboard'), 'dye', dailyDate);
  }

  palette.forEach((button, color) => button.addEventListener('click', () => {
    if (color === cloth[0]) return;
    const wet = connected(cloth);
    history.push({ cloth: cloth.slice(), color });
    for (const i of wet) cloth[i] = color;
    render();
    if (isDaily() && connected(cloth).size === cloth.length) submitDaily();
  }));
  document.getElementById('dye-retry').addEventListener('click', retry);
  newButton.addEventListener('click', newCloth);
  undo.addEventListener('click', () => {
    if (isDaily() || !history.length) return;
    cloth = history.pop().cloth;
    render();
  });
  mode.addEventListener('change', newCloth);
  newCloth();
})();
