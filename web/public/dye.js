(() => {
  'use strict';

  const size = 6;
  const colors = ['桃', '竹', '靛', '栗', '藤'];
  const board = document.getElementById('dye-board');
  const status = document.getElementById('dye-status');
  const palette = [...document.querySelectorAll('.dye-palette button')];
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
  let moves;

  function connected(values) {
    const wet = new Set([0]);
    for (const i of wet) {
      for (const next of neighbors[i]) if (values[next] === values[0]) wet.add(next);
    }
    return wet;
  }

  // Establish a playable move budget using a greedy solution, with two spare dyes.
  function budget(values) {
    let copy = values.slice();
    let wet = connected(copy);
    let steps = 0;
    while (wet.size < copy.length) {
      const options = colors.map((_, color) => copy.map((value, i) => wet.has(i) ? color : value));
      const counts = options.map((option) => connected(option).size);
      copy = options[counts.indexOf(Math.max(...counts))];
      wet = connected(copy);
      steps += 1;
    }
    return steps + 2;
  }

  function render() {
    const wet = connected(cloth);
    const won = wet.size === cloth.length;
    cells.forEach((cell, i) => {
      cell.dataset.dye = cloth[i];
      cell.textContent = colors[cloth[i]];
      cell.toggleAttribute('data-wet', wet.has(i));
    });
    const rows = Array.from({ length: size }, (_, row) => cloth.slice(row * size, (row + 1) * size).map((color) => colors[color]).join(' '));
    board.setAttribute('aria-label', `染布棋盘。${rows.join('；')}`);
    const left = limit - moves;
    status.textContent = won ? `染好了！用了 ${moves} 次染料。` : left ? `余 ${left} 次 · 已染 ${wet.size}/${cloth.length} 格` : '染料用完了，再试一次。';
    palette.forEach((button, color) => {
      button.disabled = won || !left;
      button.setAttribute('aria-pressed', String(color === cloth[0]));
    });
  }

  function retry() {
    cloth = original.slice();
    moves = 0;
    render();
  }

  function newCloth() {
    do {
      original = cells.map(() => Math.floor(Math.random() * colors.length));
    } while (connected(original).size === cells.length);
    limit = budget(original);
    retry();
  }

  palette.forEach((button, color) => button.addEventListener('click', () => {
    if (color === cloth[0]) return;
    const wet = connected(cloth);
    for (const i of wet) cloth[i] = color;
    moves += 1;
    render();
  }));
  document.getElementById('dye-retry').addEventListener('click', retry);
  document.getElementById('dye-new').addEventListener('click', newCloth);
  newCloth();
})();
