# Baselines — 视觉回归基线清单

生成：2026-09-05 · Phase 2 Round 2 · 环境限制备注见文末。

## 玩家端 375×812

| 文件 | 状态 |
|------|------|
| player-375-home.png | 主页顶部（VS + 个人卡 + 地图） |
| player-375-region-investigating.png | 调查中区域详情 + 行动分组 |
| player-375-more-actions-expanded.png | 「更多行动」展开态（收起 8 + 阵营限定标签） |
| player-375-result-modal.png | 互动结果弹窗（立绘 + 新文案 + 收益 chips） |
| player-375-cooldown-active.png | 湖底打捞冷却中（disabled + 「冷却中 40 秒」原位递减） |
| player-375-region-cleared.png | 已解决区域（金色 ✓ 选中 + 异变已清零 + 解决剧情） |
| player-375-region-locked.png | 未解锁区域（满格条 + 「需要先解决…」+ 空足迹） |
| player-375-prize-track.png | 终盘奖池进度（含 "w"/「测试用」脏数据存证） |
| player-375-home-long-nickname.png | 16 字昵称截断 + 注册成功 toast + 空实例（3100） |
| player-375-register-empty.png | 空实例注册页（双阵营 0 人，3100） |
| player-375-energy-depleted.png | 能量不足（mid-regen：cost-2 动作在能量 1 时禁用；纯 0 态未捕获，45s 回复窗口太短） |
| player-430-register.png | 430 宽抽检（注册页） |

390×844：以 soak/Track F 会话内 DOM 断言覆盖，未单独出图。

## 大屏

| 文件 | 状态 |
|------|------|
| display-1920-running.png | 1920×1080 原生运行态 + DOM 断言 scrollH/W=1080/1920 精确一屏 |
| display-1600-running.png | 1600×900 运行态（1920 截图通道不稳定时的备份基线） |

未开始 / 全部 CLEAR / 抽奖后状态：需操纵活动生命周期，留待 rehearsal 轮次（一次性实例）。

## 管理端 1366×768

| 文件 | 状态 |
|------|------|
| admin-1366-overview.png | 活动状态页（实底红结束活动 + helper + 概览五卡） |
| admin-1366-regions.png | 地图区域（cleared 行操作灰化正确） |
| admin-1366-players.png | 玩家管理（8 列操作 + 封禁红描边） |
| admin-1366-modal-numeric.png | 调整贡献数值模态（placeholder + 取消/调整） |
| admin-1366-lottery.png | 抽奖台（QUICK PICK + PLAYER DROP + 以服务端为准文案） |
| admin-1366-codes.png | 注册码（批量生成 + 查询/导出） |
| admin-1366-logs.png | 操作日志 + 贡献流水 |

危险确认模态视觉：与数值模态同一套样式（仅按钮 danger 变体色差），行为已 DOM 断言验证（danger 按钮存在、后果文案正确、可取消）；截图通道连续失败，未单独出图。
空数据管理端 / 长昵称行：3100 实例只有 1 玩家，长昵称在玩家端已覆盖截断表现；管理端留待 rehearsal。

## 环境限制（影响解读）

- IAB 截图通道：带 3D 地图页面长页滚动截图会产生拼接伪影；1920 大屏截图偶发 30s 超时；模态帧可能滞后一拍。
- IAB 标签页：同一标签页 1–2 张截图后易失联（三种页面均发生），采集采用「一状态一标签页」。
- 所有截图为 Chromium/IAB 渲染，Safari/WebKit 需真机走查（Track C 未完成项）。
