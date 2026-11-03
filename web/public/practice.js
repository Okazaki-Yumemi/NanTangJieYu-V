'use strict';

for (const button of document.querySelectorAll('.task-practice-list [data-task]')) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  icon.setAttribute('viewBox', '0 0 48 48');
  icon.setAttribute('aria-hidden', 'true');
  symbol.setAttribute('href', `/assets/task-tools.svg#${button.dataset.task}`);
  icon.append(symbol);
  button.prepend(icon);
  button.addEventListener('click', async () => {
    const result = document.getElementById('practice-result');
    try {
      const completed = await NTJ.tasks.run({ type: button.dataset.task, name: '任务试玩', practice: true });
      result.textContent = completed ? '任务完成。可以再试一次，或者换一种任务。' : '已取消，可以重新开始。';
    } catch {
      result.textContent = '任务未能打开，请刷新页面重试。';
    }
  });
}
