# FIELD_TEST_LOG — 验证与演练记录

> 每次实机验证一行一条：日期 / 环境 / 做了什么 / 结果 / 产生的问题。

## 2026-09-05 · Phase 2 启动审计（代码级）

- 环境：dev（PORT=3000，node fetch API 级验证）
- 内容：状态门控审读（domain/interactions.js 门控顺序）、会话生命周期、幂等与限频、轮询失败路径
- 结果：
  - 幂等 / 限频 / 401 语义 ✓（服务端侧）
  - 轮询失败静默重试 ✓（页面不白掉）
  - 发现 RC-1（前端吞 401 → 冻结界面）、RC-2（last_seen_at 只在登录写入）、RC-3（门控顺序语义偏移，WONTFIX 倾向）
- 产生：KNOWN_ISSUES RC-1/RC-2/RC-3

## 2026-09-05 · 状态矩阵 API 验证（M1–M12）

- 环境：一次性临时实例（独立 DATA_DIR，PORT=3100）+ dev 实例补测 M8
- 内容：注册/登录/生成注册码 → 全矩阵组合（scheduled/paused/ended/locked/cleared/closed/ban/registration_close/幂等/限频）
- 结果：20/20 PASS（含 M8 两次限频器拦截的意外验证）；矩阵写入 RELEASE_CHECKLIST
- 产生：无新缺陷；确认门控顺序 活动→互动开关→封禁→幂等→限频→区域→可用性→冷却→能量

## 2026-09-05 · RC-1 修复端到端验证

- 环境：dev 实例 + IAB 浏览器（390×844，登录态为 测试-紫音）
- 步骤：页面登录态正常 → 页面内调管理 API 对该玩家 force_logout → 等待 7.5s（>1 个 6s 轮询周期）→ DOM 断言
- 结果：页面自动回到登录视图，显示「登录状态已失效，请重新登录。」；无 JS 报错、无冻结残留
- 产生：RC-1 转 FIXED（app.js v9）

## 2026-09-05 · 回归测试基线更新

- npm test：84 → **85**（新增会话滑动续期集成测试）
- dev 服务器重启加载修复后代码，85/85 PASS

## 2026-09-05 · 视觉回归基线采集（Round 2）

- 环境：dev 实例（3000，有数据）+ 一次性实例（3100，干净数据）+ IAB 浏览器
- 结果：21 张基线入库 `docs/release/baselines/`（玩家 375×10 + 430×1、大屏 1920 原生 + 1600 备份、管理端 1366×7），manifest 含逐张状态与缺口说明
- 过程中发现并核实两个环境现象（非产品缺陷）：
  - cookie 按 host 共享不分端口：3000/3100 双实例并行时会话 cookie 互相覆盖（生产单域名无此问题）
  - 注册成功 toast 截图中的「常驻」为截图通道旧帧，代码 2800ms 自动消失（common.js:88）
- IAB 标签页失联 4 次（玩家/大屏/管理端均发生，存活 3–10 分钟不等）——无法归因产品，真机 soak 列为必办

## 2026-09-05 · Track F 网络故障实测（玩家互动路径）

- 方法：页面内 monkey-patch fetch，对 /api/player/interact 注入一次 reject
- 结果：toast「网络连接失败，请检查网络后重试。」✓；按钮解冻（pendingInteract 在 finally 清除）✓；无假成功弹窗 ✓；随后真实互动正常结算（贡献 +150）✓
- 代码级已验证：轮询失败静默重试；500 返回结构化中文文案；同 client_request_id 幂等（M11）

## 2026-09-05 · Long-session soak #1（受阻）

- 目标：≥15min 页面常开 + 周期轮询 + 数据变化
- 结果：IAB 标签页 4 次失联（3–10 分钟），最长采样窗仅 84s（期间 DOM 168 恒定、监听器净增 0，但均为注册页，无代表性）
- 代码级泄漏审查（本轮完成）：轮询为单 setTimeout 链（poller 唯一、stop 一次）；冷却 tick 自清理；模态 document keydown 监听器随 close() 成对移除；渲染层 innerHTML 重建、无持有节点引用的数组——未发现结构性泄漏向量
- 结论：**真机长时 soak 为 RC 冻结前必办项**（Android Chrome 低端机 + 投影电脑各一次，≥30min），写入 RUNBOOK 待办

## 2026-09-05 · 全流程 rehearsal（一次性实例 :3101，API 级照手册逐步执行）

- 环境：`PORT=3101` + 全新 `DATA_DIR` + `ADMIN_PASSWORD` 显式设置（NODE_ENV=development）
- **PRE-EVENT**：healthz ✓；管理登录 ✓；初始态 scheduled/注册开/0码/6区域/8奖品 ✓；生成 10 码 + 禁用 + CSV 导出（11 行含表头）✓；注册 2 人（灵梦/魔理沙各一）✓；负例：禁用码 `CODE_DISABLED` ✓、已用码 `CODE_ALREADY_USED` ✓、未开始互动 `ACTIVITY_NOT_RUNNING` ✓
- **EVENT**：start ✓；互动结算 ✓；幂等重放 `duplicate:true` 总量不变 ✓；400ms 限流 `RATE_LIMITED` ✓；暂停→互动拒→恢复→互动正常 ✓；关注册→注册拒 `REGISTRATION_CLOSED`→重开 ✓；force_clear 思源门（区域奖解锁 `prizes_available:true`）✓；advance_stage 播报「已强制解决「思源湖」，下一阶段「凯旋门」开启」✓
- **FINALE（lottery rehearsal）**：抽未解锁奖 `PRIZE_LOCKED（需要先解决「凯旋门」异变）` ✓；书签×2 抽满：第 1 抽池 2/权重快照 4（基础 1+区域排名加成 3）→确认→领取，第 2 抽池缩为 1（防重复生效）另一人中→确认→领取，第 3 抽 `该奖品已被抽完` ✓；区域限定奖 抽→作废（不占名额）→重抽同一人可再中→确认 ✓；记录总览四种状态（pending/confirmed/claimed/void）正确 ✓
- **POST-EVENT**：备份演习（暂停→整目录拷贝→恢复；ledger 末行可解析）✓；重启持久化（管理/玩家会话均存活、p1 总量 775→888、draws=4 保留）✓；损坏演习 A：state.json 截断→日志 `Recovering … from state.json.bak: Invalid JSON …`→自动恢复数据完整 ✓；损坏演习 B：双文件损坏→退出码 1、`State recovery failed`、拒绝启动不静默重建 ✓；恢复演习 C：备份两文件放回→重启健康 ✓；end 活动→互动拒→重复 end `NO_CHANGE` ✓
- **发现**：
  - RC-4（Low）：每次注册/登录在 state.json 写入一条永不使用的死会话行（domain `createSession` 与路由 `transactWithSession` 各建一条；浏览器使用路由那条）
  - 手册偏差 1：Windows 启动先打两条 `Could not fsync … EPERM` 警告（代码 win32 分支预期噪音），RUNBOOK 1.2 已补说明
  - 环境教训：Git Bash 中 `VAR=… nohup node … &` 的环境变量前缀会丢失，导致两次进程按 `.env` 落到 :3000/仓库 data——该进程因端口冲突即退，仅触发 initialize 的常规 normalize 写盘（data/ 为 gitignored，无 git 影响）；后续全部改用托管后台任务
- 测试：rehearsal 后 `npm test` 85/85 PASS

