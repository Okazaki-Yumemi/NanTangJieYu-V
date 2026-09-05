# RELEASE_CHECKLIST — 上线核对单

> 用法：每项标 [ ] / [x] / [N/A]，附证据（测试名 / 截图路径 / API 断言）。发现即修，修完打勾。

## Functional

- [ ] 注册（注册码 + 阵营 + 昵称 + 密码；重复注册码拒绝）
- [ ] 登录 / logout（正确凭证、错误凭证、换设备重登）
- [ ] 队伍平衡（team_join_max_diff 生效提示）
- [ ] 能量（消耗 / 恢复 45s / 上限 5 / 不足提示）
- [ ] 冷却（倒计时显示 / 到期恢复 / 服务端拒绝提前）
- [ ] 互动（可用动作分组、阵营限定、区域限定）
- [ ] 贡献（结算、排行榜、个人排名）
- [ ] 区域进度（异变削减 / CLEAR / 下一区解锁 / 奖品入池）
- [ ] 抽奖（权重展示、执行、reel、claimed、作废重抽）
- [ ] 管理端全操作（含确认框与日志落账）
- [ ] 大屏只读镜像一致性

## Activity State Matrix（API 级验证）

维度：activity.status ∈ {scheduled, running, paused, ended} × registration_open × interaction_open × region{locked, available, investigating, cleared, closed} × player{normal, banned}

| # | 组合 | 期待 | 证据 |
|---|------|------|------|
| M1 | running + open + available 区 | 可互动 | ✓ PASS（一次性实例，action_result 正常返回） |
| M2 | running + interaction_open=false | 「当前暂未开放互动。」 | ✓ 代码级验证（interactions.js:70；无管理端开关，现场靠 pause） |
| M3 | paused | 「当前活动未在进行中。」 | ✓ PASS（pause→interact 拒绝→resume） |
| M4 | scheduled | 同上 | ✓ PASS（初始实例 interact 拒绝） |
| M5 | ended | 同上；页面态「已结束」 | ✓ PASS（一次性实例 end 后拒绝） |
| M6 | registration_open=false | 注册码校验拒绝 | ✓ PASS（close_registration→REGISTRATION_CLOSED→恢复） |
| M7 | locked 区 | 「尚未解锁。」 | ✓ PASS（kaixuan_gate REGION_LOCKED） |
| M8 | cleared 区 | 「异变已经解决！」 | ✓ PASS（dev 实例 siyuan_gate REGION_CLEARED） |
| M9 | closed 区 | 「暂时关闭」 | ✓ PASS（close→REGION_CLOSED→reopen） |
| M10 | banned 玩家 | 登录/互动被拒；界面有封禁徽标 | ✓ PASS（ban→USER_BANNED→unban） |
| M11 | 重复 client_request_id | 返回首次结果，不重复结算 | ✓ PASS（duplicate=true 且贡献值与首次一致） |
| M12 | 400ms 内连发 | RATE_LIMITED 429 | ✓ PASS（脚本连发时被限频器正确拦截两次） |

矩阵结论（2026-09-05）：**全部组合符合期待**。门控顺序实测为 活动→互动开关→封禁→幂等→限频→区域→可用性→冷却→能量。副作用观察：限频先于区域检查（400ms 内连发报 RATE_LIMITED 而非业务错误），符合防洪设计。

## Reliability

- [ ] 服务重启：状态不丢、会话不丢、seeds 不漂移
- [ ] 断网恢复：轮询自动续、无重复扣能量（服务端幂等）
- [ ] 请求 500：用户可见「服务器状态保存失败」而非白屏
- [ ] long-session soak（≥30min 页面开着，无泄漏 / 无状态腐烂）
- [ ] 备份 / 恢复（data/ 快照 + 恢复演练）

## UI viewport

- [x] 375×812 玩家端基线（10 状态：home/investigating/expanded/result-modal/cooldown/cleared/locked/prize-track/长昵称/能量不足）+ 空实例注册页
- [x] 390×844（soak/Track F 会话 DOM 断言覆盖；无独立截图）+ 430×932 注册页抽检
- [x] 1920×1080 大屏基线（原生截图 + scrollH/W=1080/1920 断言）+ 1600×900 备份
- [x] 1366 管理端基线（7 张：六节 + 数值模态）
- [ ] 管理端危险确认模态独立截图（行为已 DOM 断言，视觉由数值模态覆盖）
- [ ] 大屏未开始/全 CLEAR/抽奖后状态（留待 rehearsal，一次性实例）
- [ ] 管理端空数据 / 长昵称行

## Browser

- [ ] Chromium（本环境主验证）
- [ ] Edge（同引擎抽验）
- [ ] Safari/WebKit（如环境可用；重点 backdrop-filter / dvh / safe-area）

## Operations

- [x] 生产 env（PORT / ADMIN_PASSWORD / 隐私管理路径 / cookieSecure）——规则与 `COOKIE_SECURE=0` 陷阱见 RUNBOOK 1.1（http 现场 + production 未关 secure = 登录后即掉线）
- [x] DATA_DIR 持久化位置确认——启动自检第 5 项（RUNBOOK 1.3）
- [x] /healthz 可用（不读状态、不建会话，rehearsal 实测）
- [x] 数据导出 / 备份 / 恢复流程文档化（`docs/ops/EVENT_RUNBOOK.md` §6–7 + `EMERGENCY.md`；rehearsal 实测：暂停→整目录拷贝、双文件恢复、主文件截断自动自愈、双损坏拒绝启动）
- 全流程 rehearsal 与 lottery rehearsal 记录见 `FIELD_TEST_LOG.md` 2026-09-05 条目

## 视觉回归基线

- 位置：`docs/release/baselines/`（截图文件不入库则记录清单与生成方式）
- 覆盖：注册页、主页正常/locked/cleared/cooldown/能量不足/result modal/CLEAR modal/更多行动展开/长昵称/排行榜空与有数据/奖池部分与全部解锁；大屏未开始/进行/部分 CLEAR/全 CLEAR；管理端六页 + 危险确认模态
