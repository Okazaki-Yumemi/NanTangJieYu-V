'use strict';

for (const button of document.querySelectorAll('.task-practice-list [data-task]')) {
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
