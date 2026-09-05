# KNOWN_ISSUES — 确认缺陷与观察项

> 只有「复现过 / 代码证据确凿」的才进本文件。猜测放 BACKLOG 观察。
> 状态：OPEN / FIXED(<commit>) / WONTFIX(理由) / OBSERVATION(转正条件)

## RC Blocker（现场中断级）

（空）

## High

### RC-1 · FIXED · 会话失效后玩家端冻结在旧界面

- 证据：`web/public/common.js` `NTJ.polling` 捕获并吞掉所有错误；`web/public/app.js` 轮询与 interact 均不区分 `USER_NOT_FOUND`。服务端在会话无效时返回 401 `USER_NOT_FOUND`（`server/routes/player-routes.js` state/interact 两处）。
- 影响：会话被清（服务端修剪/被强制下线/多端冲突）后，玩家界面停留在旧数据，无提示、无回登录路径。
- 修复：app.js 新增 `handleAuthLost()`（停轮询、清数据、回登录视图、显示「登录状态已失效，请重新登录。」），轮询与互动的 401 分支接入；`renderRegionDetail` 补 null 数据守卫；bump app.js v9。
- 验证：浏览器端到端——管理员对在线玩家执行强制下线，≤1 个轮询周期内玩家页面自动回到登录视图并显示失效文案；npm test 85/85。

### RC-2 · FIXED · 会话活跃时间只在注册/登录时写入

- 证据：`server/domain/state.js:164` 修剪用 `last_seen_at`；但只有 register/login 走 `transactWithSession` 会刷新它。`POST /api/player/interact` 用裸 `store.transact`（player-routes.js:186）不刷新；admin-routes 同样只在登录时写 `last_seen_at`。
- 影响：TTL（玩家 12h / 管理 8h）实际从登录起算，长时间活动中后期活跃账号可能集体掉登录（管理端彩排早晨开机 + 晚场抽奖即触雷）。
- 修复：interact 事务内与 `adminTransact` 内分别刷新对应 session 的 `last_seen_at`（滑动窗口）。
- 验证：新增集成测试「interaction refreshes session activity…」（sleep 1.1s 后 interact，断言 last_seen_at 前移）；npm test 85/85。

## Medium

（空）

## Low

### RC-3 · OPEN · 门控顺序导致暂停期提示语义偏移

- 证据：`server/domain/interactions.js:39-48` 区域检查先于 `:66` 活动状态检查。
- 影响：活动暂停时点击未解锁区域，提示「尚未解锁」（真但不最相关）。
- 处理倾向：WONTFIX 倾向——两条信息都真实，玩家重试后自然看到正确提示；改动会动门控顺序，RC 阶段不值得。待观察。

### RC-4 · OPEN · 每次注册/登录写入一条死会话行

- 证据：domain 层 `players.createSession`（registerPlayer :179 / loginPlayer :206）创建并绑定 user_id 的会话；路由层 `transactWithSession`（player-routes.js:76-80）另建一条匿名会话再绑定 user 并种 Cookie。浏览器只会拿到路由那条；domain 那条无任何 Cookie 引用。rehearsal 实测：3 个用户 6 条会话（每人 2 条，同秒创建）。
- 影响：仅 state.json 每次注册/登录多一行（~100 字节）；TTL 修剪（12h）与 forceLogout（按 user_id 全删）都覆盖它，功能零影响。
- 处理倾向：WONTFIX 倾向——会话链路是 RC-1/RC-2 刚验证过的最敏感路径，冻结期做纯清理改动的回归风险大于收益；现场规模（≤数百人）存储增量可忽略。留待活动后清理。

## OBSERVATION（保留观察，未转正）

- IAB 浏览器标签页 3–10 分钟失联（三种页面均发生）：无崩溃转储可查，产品不可归因；真机 soak（RC 冻结必办）将给出真实设备结论
- display 动态流内滚动（3s 重置已修，卡内滚动可接受）
- 375px 地图 marker 间距（新增区域时再评估）
- 集成测试 flaky（出现过 1 次，复跑全过；复发才定位）
- 性能后备项：光晕 mix-blend-mode: screen、34 粒子（有卡顿反馈才动）
