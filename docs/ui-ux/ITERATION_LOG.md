
## Iteration 5 — 玩家端行动分组与窄屏细节（2026-09-05）

- goal：区域详情 10+ 按钮同权重压垮首屏决策；375px 页头折行
- changed：app.js 新增 splitActions（常用 = 调查异常点/集中调查/未锁定的阵营协助，其余入「更多行动 (N)」折叠区，appState.moreActionsOpen 跨重渲染保持，aria-expanded/controls）；player.css 折叠开关样式（count pill + CSS 三角箭头旋转）；修复 display:flex 覆盖 [hidden] 致折叠初始即展开的 bug（.action-list.is-more[hidden]{display:none}）；styles.css .status-chip 加 nowrap（375px「进行中」折两行）；.brand-eyebrow ≤430px 字距 0.22em→0.08em（消除「…活/动」孤字换行）；版本 bump styles v8（三端）/player v8/app v5
- validation：375×812 DOM 断言（primary=3、more 隐藏/展开/收起循环、chip 25px、eyebrow 单行）+ 展开态截图；390×844 / 430×932 无横向滚动；大屏回归 bodyScrollH=1080；npm test 84/84
- commit：5ec8d48（自本轮起 commit 后 push origin main，用户要求）
- next：Iter6 admin prompt/confirm 模态化 + 英文 eyebrow 取舍
h+overflow hidden；grid 行 minmax(0,1fr)；奖池 4 列网格 + 卡内滚动（pool-card）；地图卡 500px；排行榜 flex-start + 页码固定；区域列表 locked 不显示数值「—」、cleared 金卡「异变已清零」、条=剩余且季节色；修复大屏 anomaly-bar 0 高历史 bug（组件样式从 player.css 上移 styles.css）；提示文案改「调查请用手机扫码参与」
- validation：1920×1080 DOM 断言（bodyScrollH=1080、页码可见、溢出量化）+ 截图 + npm test 84/84（一次 flaky 复跑通过）
- commit：aa33e4e
- next：Iter3 文案 pass（seeds 三处 + admin 术语 + 确认框后果）

## Iteration 3 — 文案 pass 第一批（2026-09-05）

- goal：消除文案与数值矛盾、中英夹生；危险确认写明后果
- changed：interactions.json 三处（妹红「力量+1异变-0」改写实、早苗去 Performing、文「采访自由」）；admin「强制 CLEAR」→「强制解决」+ 两个危险确认写明「将把「XX」标记为已解决，注入奖品并解锁下一区域……写入管理日志」；玩家端登录失败兜底补上下文；版本号 bump
- validation：interactions.json JSON 校验 + 服务重启加载 + 管理端 DOM 断言 + npm test 84/84
- commit：027e0f3
- next：Iter4 管理端视觉层级（danger/primary 区分、表格密度）

## Iteration 4 — 管理端视觉层级（2026-09-05）

- goal：primary/danger 操作一眼可分；表格密度；键盘可达
- changed：admin primary 改实底渐变（与玩家端主按钮同语言）、danger 加重描边+字重、表内按钮致密化、action/mini/tab 补 focus-visible
- validation：1366×768 截图 + DOM（表格 21 行无横向溢出、行高 57px）+ npm test 84/84
- commit：8b78366
- next：Iter5 玩家端 action 分组 + 375px marker 细节 + 430×932 复验

## Iteration 4.1 — 大屏区域卡收尾（2026-09-05）

- changed：右列弹性比 2:1、区域卡内边距/间隙收紧（发现 CSS 版本号未 bump 导致缓存假象，v=9）
- validation：DOM 断言 regions overflow 73→0，六卡完整可见；1920×1080 截图
- commit：238738c
- next：Iter5
