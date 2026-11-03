(() => {
  'use strict';

  // # wall, . seal, $ box, @ player
  const levels = [
    { id: 'spring', tab: '春', title: '春 · 花径', palette: ['#c6ba91', '#bcb18c', '#57705a'],
      rows: ['#######', '#     #', '# @$. #', '#     #', '#######'] },
    { id: 'summer', tab: '夏', title: '夏 · 水廊', palette: ['#adbcad', '#a0b0a3', '#456870'],
      rows: ['#######', '#    .#', '#  $  #', '# #   #', '# @   #', '#######'] },
    { id: 'autumn', tab: '秋', title: '秋 · 回廊', palette: ['#d7b186', '#c9a47d', '#865c48'],
      rows: ['########', '#  . . #', '# #$#  #', '#      #', '#  $   #', '# @    #', '########'] },
    { id: 'winter', tab: '冬', title: '冬 · 雪仓', palette: ['#b8bfd1', '#acb5c8', '#5a5878'],
      rows: ['########', '#   .  #', '#  ##  #', '# $  $ #', '# . #  #', '# @    #', '########'] },
    { id: 'boundary', tab: '界', title: '界 · 后门', palette: ['#c6adba', '#bba0ae', '#665068'],
      rows: ['########', '# ..   #', '#  #   #', '# $ $$ #', '#   #. #', '# @    #', '########'] },
  ];
  const directions = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] };
  const byId = (id) => document.getElementById(`crate-${id}`);
  const board = byId('board');
  const tabs = byId('tabs');
  const message = byId('message');
  const undo = byId('undo');
  const next = byId('next');
  const storageKey = 'ntj-puzzle-bests-v1';
  const bests = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const { id } of levels) {
      if (Number.isSafeInteger(saved?.[id]) && saved[id] > 0) bests[id] = saved[id];
    }
  } catch { /* Local records are optional. */ }

  let levelIndex;
  let cols;
  let walls;
  let goals;
  let boxes;
  let player;
  let history;
  let cells;
  let won;

  function render() {
    for (const [index, cell] of cells.entries()) {
      cell.classList.toggle('wall', walls.has(index));
      cell.classList.toggle('goal', goals.has(index));
      cell.classList.toggle('box', boxes.has(index));
      cell.classList.toggle('player', index === player);
    }
    const level = levels[levelIndex];
    const placed = [...boxes].filter((position) => goals.has(position)).length;
    board.setAttribute('aria-label', `${level.title}棋盘，已归位 ${placed} / ${goals.size}，当前 ${history.length} 步`);
    byId('moves').textContent = history.length;
    byId('best').textContent = bests[level.id] ?? '—';
    undo.disabled = history.length === 0;
    next.hidden = !won || levelIndex === levels.length - 1;
    message.textContent = won ? `全部归位，${history.length} 步过关！` : `已归位 ${placed} / ${goals.size}`;
  }

  function loadLevel(index) {
    levelIndex = index;
    const level = levels[index];
    cols = level.rows[0].length;
    walls = new Set();
    goals = new Set();
    boxes = new Set();
    history = [];
    won = false;
    cells = Array.from(level.rows.join(''), (tile, position) => {
      if (tile === '#') walls.add(position);
      if (tile === '.') goals.add(position);
      if (tile === '$') boxes.add(position);
      if (tile === '@') player = position;
      const cell = document.createElement('span');
      cell.className = 'crate-cell';
      cell.setAttribute('aria-hidden', 'true');
      return cell;
    });
    board.style.setProperty('--cols', cols);
    ['--floor', '--floor-alt', '--wall'].forEach((key, i) => board.style.setProperty(key, level.palette[i]));
    board.replaceChildren(...cells);
    byId('title').textContent = level.title;
    [...tabs.children].forEach((tab, i) => tab.setAttribute('aria-pressed', i === index));
    render();
  }

  function move(direction) {
    if (won) return;
    const [dx, dy] = directions[direction];
    const step = dx + dy * cols;
    const destination = player + step;
    if (walls.has(destination)) return;
    const pushed = boxes.has(destination);
    const beyond = destination + step;
    if (pushed && (walls.has(beyond) || boxes.has(beyond))) return;
    history.push({ player, from: pushed ? destination : null, to: beyond });
    if (pushed) {
      boxes.delete(destination);
      boxes.add(beyond);
    }
    player = destination;
    won = [...boxes].every((position) => goals.has(position));
    if (won) {
      const { id } = levels[levelIndex];
      if (!bests[id] || history.length < bests[id]) {
        bests[id] = history.length;
        try { localStorage.setItem(storageKey, JSON.stringify(bests)); } catch { /* Keep the in-memory result. */ }
      }
    }
    render();
  }

  function undoMove() {
    const previous = history.pop();
    if (!previous) return;
    player = previous.player;
    if (previous.from !== null) {
      boxes.delete(previous.to);
      boxes.add(previous.from);
    }
    won = false;
    render();
  }

  for (const [index, level] of levels.entries()) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = level.tab;
    tab.setAttribute('aria-label', level.title);
    tab.addEventListener('click', () => {
      if (index !== levelIndex) loadLevel(index);
    });
    tabs.append(tab);
  }
  undo.addEventListener('click', undoMove);
  byId('reset').addEventListener('click', () => loadLevel(levelIndex));
  next.addEventListener('click', () => {
    loadLevel(levelIndex + 1);
    board.focus({ preventScroll: true });
  });
  for (const button of byId('pad').querySelectorAll('button')) {
    button.addEventListener('click', () => move(button.dataset.dir));
  }
  const arrowKeys = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (Object.hasOwn(arrowKeys, event.key)) {
      event.preventDefault();
      move(arrowKeys[event.key]);
    } else if (event.key.toLowerCase() === 'z') {
      undoMove();
    }
  });

  let swipe;
  board.addEventListener('pointerdown', (event) => {
    if (swipe || event.button !== 0) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    board.setPointerCapture(event.pointerId);
  });
  board.addEventListener('pointerup', (event) => {
    if (swipe?.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  board.addEventListener('lostpointercapture', (event) => {
    if (swipe?.id === event.pointerId) swipe = null;
  });
  loadLevel(0);
})();
