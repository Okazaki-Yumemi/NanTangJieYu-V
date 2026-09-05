# RC_STATE — 发布候选状态（Phase 2 真相源）

> 职责：记录「是否可以可靠上线」。设计/文案规范见 `docs/ui-ux/`。
> 更新纪律：每轮自治循环结束时同步本文件。只保存当前真相，不保存历史叙事（历史看 ITERATION_LOG）。

## 基线（2026-09-05，Phase 2 启动时）

- HEAD：`3fdeb90`（docs iter9）／ 代码 `7d20a80`
- `npm test`：**85/85 PASS**（Phase 2 新增 1 项会话续期回归测试）
- git status：干净（仅用户未跟踪文件 `.ntj-beautify-notes.md`，永不提交）
- dev 服务器：PORT=3000，seeds 已加载 iter9 文案
- 数据：`data/` 含演示脏数据（"w"/「测试用」）——**BLOCKED_ON_USER_APPROVAL**，未清理

## 阶段判定

**RC-IN-PROGRESS**（未冻结）

冻结条件（全部满足才可 RC FROZEN）：

- [ ] npm test 全通过（当前 ✓，需持续保持）
- [ ] RC Blocker = 0
- [ ] High = 0
- [ ] 活动状态矩阵全组合验证（见 RELEASE_CHECKLIST 矩阵节）
- [ ] 三端主要 viewport 视觉基线建立且无回归
- [ ] long-session soak 无泄漏/无状态腐烂
- [ ] 网络故障恢复路径可接受（Track F 实测）
- [ ] 完整活动 rehearsal 成功
- [ ] lottery rehearsal 成功
- [ ] deployment checklist 完成
- [ ] `docs/ops/EVENT_RUNBOOK.md` + `EMERGENCY.md` 可用

## 确认缺陷台账（摘要，详情 KNOWN_ISSUES）

| ID | 优先级 | 状态 | 一句话 |
|----|--------|------|--------|
| RC-1 | High | FIXED | 会话失效后玩家端停留冻结旧界面 → 前端 401 处理 + 回登录视图（app v9，浏览器端到端验证） |
| RC-2 | Medium | FIXED | interact/管理操作不刷新会话活跃时间 → 滑动续期（新增集成测试） |
| RC-3 | Low | WONTFIX 倾向 | 暂停期点未解锁区域报「尚未解锁」而非「活动未开始」（两者都真，重试自愈，不值得动门控顺序） |

## 已验证可靠（本轮证据）

- 幂等：同 `client_request_id` 重复提交返回首次结果（`server/domain/interactions.js` request_locks）
- 限频：interact 400ms 服务端限频，前端另有 pendingInteract 点击守卫
- 轮询失败：静默吞掉下一轮重试，页面不白掉（`NTJ.polling`）
- 会话持久化：sessions 在 state.json 内，服务重启不掉登录
- 错误分层：HTTP 401/403/409/429 映射齐全（player-routes ERROR_STATUS），无 stack 泄露
