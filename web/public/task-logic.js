'use strict';

/* 固定游戏坐标，擦拭判定与屏幕尺寸、指针事件频率无关。 */
(function exposeTaskMath(root) {
  function createWipeMask(width = 640, height = 400, cols = 32, rows = 20) {
    const cleared = new Uint8Array(cols * rows);
    let count = 0;
    return {
      stroke(from, to, radius) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length2 = dx * dx + dy * dy;
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const index = row * cols + col;
            if (cleared[index]) continue;
            const x = (col + .5) * width / cols;
            const y = (row + .5) * height / rows;
            const t = length2 ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / length2)) : 0;
            if ((x - from.x - t * dx) ** 2 + (y - from.y - t * dy) ** 2 <= radius ** 2) {
              cleared[index] = 1;
              count += 1;
            }
          }
        }
        return count / cleared.length;
      }
    };
  }
  function createMemorySequence(pattern) {
    if (pattern.length !== 3 || pattern.some(value => !Number.isInteger(value) || value < 0 || value > 8)) {
      throw new Error('闪光序列必须包含三个有效位置');
    }
    let round = 2;
    let index = 0;
    let done = false;
    return {
      accept(value) {
        if (done) return { matched: true, complete: true, advance: false, round };
        if (value !== pattern[index]) { index = 0; return { matched: false, complete: false, advance: false, round }; }
        index += 1;
        if (index < round) return { matched: true, complete: false, advance: false, round };
        index = 0;
        if (round === 3) { done = true; return { matched: true, complete: true, advance: false, round }; }
        round = 3;
        return { matched: true, complete: false, advance: true, round };
      }
    };
  }
  const api = { createWipeMask, createMemorySequence };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NTJ.taskMath = api;
})(typeof window === 'undefined' ? globalThis : window);
