
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

## Iteration 6 — 管理端模态化（2026-09-05）

- goal：原生 window.confirm/prompt 在现场易误触、不可样式化、无焦点管理；顺带覆盖危险操作确认缺口
- changed：admin.js 新增 openAdminModal（confirm/prompt/select；Esc/遮罩取消、Enter 提交、Tab 焦点圈、焦点归还触发元素、danger 红确认）；post() confirm 参数改为配置对象；活动/区域两处危险确认、玩家管理 8 种操作、抽奖执行与作废全部迁移；换阵营 free-text 改下拉；调贡献/调权重补 Number.isFinite 校验（空串原会静默提交 0）；封禁补确认；修复换阵营处理器引用未定义 player 的历史 bug；admin.css 模态样式（backdrop blur、0.2s 入场、prefers-reduced-motion 关闭动画）；bump admin v13
- validation：1366×768 DOM 断言（模态开/关、Esc、Tab 圈序、焦点归还、danger class、select 选项与预选、空值校验 toast、Enter 提交改名成功 + toast）+ 模态截图；npm test 84/84
- commit：0748fb4
- next：Iter7 copy pass 第二批（display 空态、admin 文案全扫、角色语气校对）

## Iteration 7 — 文案 pass 第二批（2026-09-05）

- goal：display 空态、admin 全量文案、角色语气校对
- changed：admin.js 移除 5 处英文 eyebrow（Prize Catalog/Prize Pool/Weight Preview/Draw History/Weighted Lottery·现场抽取），保留抽奖台 QUICK PICK 仪式牌与 PLAYER DROP 彩蛋（用户有意设计）；「还没有抽奖记录」→「暂无抽奖记录」统一管理端空态语感；display.js 空态（「暂无数据。」「等待第一份调查报告……」）与 seeds 语气（阵营 slogan、互动描述、cleared_story 线索链）复扫判定达标不动
- validation：抽奖页 DOM 断言（eyebrows=[]、五个 h2 中文、QuickPick 保留）+ 截图；npm test 84/84
- commit：e668dc1
- next：Iter8 候选（开始/结束活动区分、冷却折行）或演示前数据清理

## 性能专项 — 卡顿治理（2026-09-05）

- 背景：用户反馈页面卡顿；环境限制无法测 FPS（IAB 对 rAF 全节流），改为确定性成本分析
- 定位：①5 个 62vmax 背景光晕各带 filter: blur(70px) + mix-blend-mode 无限漂移，玻璃卡 backdrop-filter 在其上每帧重糊 ②玩家 6s/大屏 3s 全量 innerHTML 重渲染（动画重启、图片重建、大屏动态流滚动每 3s 被重置）③地图 pointermove 高频样式写入
- changed：styles.css 光晕去 blur 滤镜（渐变已软过渡）、--glass-blur 16→12px；app.js 轮询 JSON 载荷守卫 + renderRegionDetail 内 1Hz 冷却原位 tick（actionMetaText/refreshCooldownsInPlace 抽取复用，不重建按钮避免吞点击）；display.js 同款载荷守卫；map.js 视差写入合并 rAF；bump styles v9 / app v6 / display.js v5 / map v4
- validation：computed style 断言（blob filter none、glass 12px）；大屏 feed 探针 7.2s（跨 2 个轮询周期）节点未重建、scrollTop 40 保持；玩家 me-card 探针跨轮询周期存活；湖底打捞冷却 57→55→31 秒原位递减；390px 截图视觉无损；bodyScrollH=1080 回归；npm test 84/84
- commit：4482376
- next：如仍有卡顿，候选 = 光晕 mix-blend-mode、粒子数量；Iter8 功能项照旧
