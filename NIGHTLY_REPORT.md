# Nightly Development Report

## Current status

东方南堂界遇 V 线上系统已可完整运行：玩家扫码注册 → 选阵营 → 在交大校园地图上逐区域调查异变 → 贡献/抽奖权重累计 → 管理端管理全程并执行终盘抽奖 → 大屏实时展示，77 项单元+集成测试全部通过，浏览器真实走查完成。

## Implemented tonight

- **状态存储**：零依赖 JSON 状态库，原子写盘（临时文件 + rename + fsync）、主备双文件自动恢复、双损坏拒启、危险操作前独立快照、事务串行化、内存只读缓存。
- **配置化活动规则**：`shared/seeds/` 8 个种子文件（活动/队伍/区域/互动/奖品/抽奖规则/节目事件/称号），启动时交叉引用校验 fail-fast；运行时状态与规则分离，改配置不丢数据。
- **注册码体系**：批量生成（普通/特典）、一次性绑定、禁用/解禁、查询、CSV 导出、CLI 工具；二维码 URL `?code=` 自动填入。
- **玩家系统**：scrypt 密码、昵称唯一、阵营人数差限制、会话 Cookie（生产自动 Secure）、能量上限+定时恢复。
- **区域状态机**：locked/available/investigating/cleared 状态由配置+运行时推导；解锁链（思源门→…→行政楼线性推进）；异变值结算与 CLEAR（含强制 CLEAR/改值/临时关闭/强制解锁）。
- **统一互动系统**：ActionConfig 驱动（能耗/冷却/阵营限制/区域限制/时间窗/多结果权重随机），贡献与异变结算三层记账（个人/个人×区域/队伍），`client_request_id` 幂等 + 进程内限流。
- **贡献流水**：state 内有界短窗 + `ledger.jsonl` 全量追加审计；管理员调整、节目事件同样入账；导出脚本可全量查账。
- **抽奖**：LotteryWeightCalculator 独立纯模块（票种基础权重 + 贡献阶梯 + CLEAR 区域排名加成 + 管理员调整，全部 lottery.json 配置）；奖池按区域解锁；按奖品加权抽取、权重快照、防重复中奖、标记领取、作废重抽。
- **节目事件**：队伍贡献（按人均摊/纯池）、削减异变、提前解锁区域，配置预设 + 一键触发 + 留痕。
- **玩家端**：交大校园风格 SVG 地图（可点击地图块、四季配色、推进路线、状态环、图例）、区域详情面板（剧情/异变条/互动按钮/区域榜）、结果弹窗带东方角色立绘、终盘奖池进度条（未解锁显示神秘奖品）、排行榜/动态/能量/权重，375–430px 移动端适配。
- **管理后台**：活动状态机、区域管理、玩家管理（调整贡献/权重/封禁/改密/回能量）、注册码管理、抽奖管理、节目事件、操作日志与流水查看，全部危险操作二次确认。
- **大屏**：16:9 暗色投影页，VS 对比条、校园地图、奖池解锁进度、区域状态、动态流，3 秒轮询只读。
- **运维脚本**：`seed:dev`（20 测试玩家+模拟数据）、`codes:generate`（批量码+CSV）、`data:export`（赛后全量导出）。
- **美术资源**：21 张东方角色立绘（来自 thpdp.ver.moe 幻想人形演舞立绘索引）接入互动结果弹窗与队伍卡；区域/奖品占位 SVG 集中管理可整替。

## Architecture changes

（新项目，从零建立）参考 Yangzhou-THO 复用了状态存储设计、scrypt 认证、注册码流程与加权随机工具；与其差异：

- 单体 1500 行 server.js → `domain/`（11 个领域模块）+ `routes/`（3 组路由）分层。
- 配置与状态混存 → seeds（规则）与 state.json（运行时）彻底分离。
- 无上限 actionLogs → 有界短窗 + JSONL 追加审计，state 体积可控（写放大从 O(全部历史) 降为 O(有界)）。
- 抽奖从「无奖池权重抽人」扩展为「奖品池 + 区域解锁 + 权重快照 + 领取/作废生命周期」。
- 区域/异变/解锁链为新增领域模型，状态推导而非冗余存储。

## Database changes

- 无 SQL 数据库；沿用单实例 JSON 方案（150 人规模、可靠性优先）。
- `data/state.json` schema v1：activity / teams / regions / codes / users / sessions / admin_sessions / contribution_log（有界）/ request_locks（幂等）/ lottery.draws / admin_logs / system_events，`normalizeState` 负责迁移与修剪。
- `data/ledger.jsonl` 追加式全量审计（事务提交后写入，尾部损坏容错）。
- 种子即「迁移源」：区域增删、规则调整在重启时自动对齐运行时数据。

## Important fixes

- seed 文件名 kebab-case → camelCase 键映射不一致导致启动校验失败（已修）。
- 管理入口路径映射后又被自身守卫拦截返回 404（已修）。
- 大屏地图不可见：`.campus-map` 尺寸样式误放 player.css，大屏未加载（已修，移入共享 styles.css）。
- 互动响应字段 `state_view`/`state` 命名不一致（已统一为 `state`）。
- 互动流水未写入 ledger.jsonl（已修）。
- 限流在测试环境中误伤连续请求 → 测试夹具可关限流，生产默认 400ms。
- 玩家端在活动未开始时仍显示可点互动按钮 → 改为提示文案。

## Tests

- lint: 未引入 ESLint（零依赖原则；以 `node --test` + code review 保障，后续可选补）
- typecheck: 不适用（纯 JS 项目，无 TS）
- unit tests: 57 passed
- integration tests: 20 passed（真实启动 HTTP 服务走完整活动旅程，含重启持久化验证）
- build: 不适用（无构建步骤；`npm start` 直接运行）
- 浏览器真实走查：注册校验/注册/地图点选/互动结算/结果弹窗/管理端全页签/强制CLEAR确认框/抽奖+权重快照(4/总4)/领奖/大屏渲染 均通过

## Git

```
e02b382 chore: scaffold project layout, package.json and env example
5a83215 feat: core constants, crypto random helpers, scrypt auth and env config
5a32154 feat: atomic json state store with backup recovery, snapshots and read cache
3a9c083 feat: seed configs for activity, teams, regions, interactions, prizes, lottery and stage events
138b438 fix: normalize kebab-case seed file names to camelCase keys
fef75a6 feat: domain layer with region anomaly state machine, contribution ledger, idempotent interactions, lottery weights and stage events
b705dad feat: http server with player, admin and public api routes plus integration tests
1cf84af feat: player web app with clickable SJTU campus map, interactions and prize track
c343699 feat: admin console and display big screen with prize track
8f9ac33 feat: add touhou character portraits for interaction results and team cards
fe1782f feat: ops scripts for dev seed data, code generation and event data export
f89447c fix: share campus map styles with display page and polish walkthrough findings
<HEAD>  docs: complete README with config guide, ops commands and deployment
```

## Known issues

- Windows 本地运行时目录 fsync 会打 EPERM 警告（已捕获降级为日志，文件 fsync 仍生效；Linux 部署无此问题）。
- 大屏地图点击无响应为设计如此（页面有提示「请使用手机参与」）。
- 摩多罗隐岐奈立绘缺失：thpdp 站无该角色，剧情文案不依赖其立绘，后续可自行补充 `assets/characters/okina.png`。
- 无 SSE/WebSocket，实时性依赖轮询（玩家 6s / 大屏 3s），对现场规模足够。

## Not finished

- ESLint / CI 未配置（零依赖原则下优先级低，可后续补 `node --test` CI）。
- 称号系统仅保留阈值阶梯展示，无完整称号玩法（按需求预留）。
- 玩家「个人中心」的兑换码/物料核销等未涉及。
- 正式数值（各区域异变值、奖励区间、权重阶梯）为占位设计，需策划在 seeds 中定稿。
- 校园地图为示意图，待正式美术替换。

## Recommended next steps

1. 策划定稿数值后更新 `shared/seeds/`（regions/interactions/lottery/prizes），跑 `npm test` + 本地走查。
2. 用 `node scripts/generate-codes.js` 生成正式码量（建议预留 20% 冗余），打印二维码物料并现场演练一次完整注册。
3. 在 Zeabur（或同级平台）部署并演练：持久卷挂载、重启恢复、备份/还原 `data/`。
4. 活动前压测：模拟 150 注册 + 高频互动（可临时调低 `interact_rate_limit_ms` 用脚本压测），确认事务延迟可接受。
5. 补充：结局剧情文案（行政楼 CLEAR 后的终盘衔接）、可能的 STG/QUIZ 现场流程与 stage-events 对齐。
6. 可选工程化：GitHub Actions 跑 `npm test`；引入 ESLint（若团队希望统一风格）。

## How to run

```bash
npm install        # 实际无依赖，仅为习惯性确认
npm test           # 77 项测试
npm run seed:dev   # （可选）写入演示数据
npm start          # http://127.0.0.1:3000 （管理员入口见启动日志或 .env）
```
