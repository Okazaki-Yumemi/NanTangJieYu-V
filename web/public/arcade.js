(() => {
  'use strict';

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function record(game, label) {
    const node = document.getElementById(`arcade-${game}`);
    node.textContent = label;
    node.hidden = false;
  }

  function renderRecords() {
    const rhythm = read('ntj-rhythm-best');
    if (Number.isInteger(rhythm) && rhythm > 0) record('rhythm', `最高 ${rhythm} 分`);
    const puzzle = read('ntj-puzzle-bests-v1');
    if (puzzle) {
      const levels = ['spring', 'summer', 'autumn', 'winter', 'boundary', 'frost', 'storehouse', 'crossroads'];
      const cleared = levels.filter((id) => Number.isInteger(puzzle[id]) && puzzle[id] > 0).length;
      if (cleared) record('puzzle', `已解 ${cleared}/${levels.length} 关`);
    }
    const danmaku = read('ntj-firefly-score-v2');
    const expert = read('ntj-firefly-expert-v1');
    if (Number.isInteger(expert) && expert > 0) record('danmaku', `符卡试炼 ${expert} 分`);
    else if (Number.isInteger(danmaku) && danmaku > 0) record('danmaku', `巡夜最高 ${danmaku} 分`);
  }

  renderRecords();
  window.addEventListener('pageshow', renderRecords);
})();
