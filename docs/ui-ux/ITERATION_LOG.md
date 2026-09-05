# Iteration Log

## Iteration 0 — Baseline（2026-09-05）

- goal：建立基线与状态文件
- changed：无代码；docs/ui-ux/ 五件套建立
- validation：npm test 84/84；玩家 390×844 / 大屏 1920×1080 / 管理 1366×768 截图走查
- commit：随 Iter1 提交（5946f98）
- next：Iter1 玩家端异变语义与区域状态视觉

## Iteration 1 — 玩家端异变语义与区域状态视觉（2026-09-05）

- goal：数字与进度条同向、状态视觉化、禁用原因明确
- changed：common.js formatDuration（X 分钟）；app.js 剩余异变条 + cleared 徽标 + 按钮补「削减异变 X~Y」+ 阵营限定具名（仅限魔理沙队）；player.css 图例改 orb 小样；styles.css cleared 金色 orb/地面碟 + section-head 换行
- validation：390×844 浏览器走查（可调查/调查中/已解决三态 DOM 断言）+ npm test 84/84
- commit：5946f98
- next：大屏溢出与语义

## Iteration 2 — 大屏版式与区域语义（2026-09-05）

- goal：1080 一屏锁定；排行榜/奖池/区域列表不裁切；区域数值语义与玩家端一致
- changed：display-body 桌面端 height:100vh+overflow hidden；grid 行 minmax(0,1fr)；奖池 4 列网格 + 卡内滚动（pool-card）；地图卡 500px；排行榜 flex-start + 页码固定；区域列表 locked 不显示数值「—」、cleared 金卡「异变已清零」、条=剩余且季节色；修复大屏 anomaly-bar 0 高历史 bug（组件样式从 player.css 上移 styles.css）；提示文案改「调查请用手机扫码参与」
- validation：1920×1080 DOM 断言（bodyScrollH=1080、页码可见、溢出量化）+ 截图 + npm test 84/84（一次 flaky 复跑通过）
- commit：aa33e4e
- next：Iter3 文案 pass（seeds 三处 + admin 术语 + 确认框后果）

## Iteration 3 — 文案 pass 第一批（2026-09-05）

- goal：消除文案与数值矛盾、中英夹生；危险确认写明后果
- changed：interactions.json 三处（妹红「力量+1异变-0」改写实、早苗去 Performing、文「采访自由」）；admin「强制 CLEAR」→「强制解决」+ 两个危险确认写明「将把「XX」标记为已解决，注入奖品并解锁下一区域……写入管理日志」；玩家端登录失败兜底补上下文；版本号 bump
- validation：interactions.json JSON 校验 + 服务重启加载 + 管理端 DOM 断言 + npm test 84/84
- commit：见 git log（copy(player/admin) ）
- next：Iter4 管理端视觉层级（danger/primary 区分、表格密度）
