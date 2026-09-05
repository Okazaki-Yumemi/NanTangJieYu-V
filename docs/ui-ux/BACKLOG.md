# Backlog

## P0

（空）

## P1

- [x] 大屏动态流每 3s 滚动重置已由轮询载荷守卫修复（4482376）。
- [ ] 如仍感卡顿：光晕 mix-blend-mode: screen、34 粒子数量是下一批候选。

## P2

- [ ] 集成测试偶发 flaky（连跑曾 1 次 fail，复跑全过；如复发需定位）。
- [ ] 375px 地图 marker 间距实测尚可，降级观察（若后续新增区域再评估）。

## Icebox

- 玩家端个人页/兑换码物料核销（需求未定）。
- 正式美术替换占位 SVG（需用户提供）。
- okina.png 立绘缺失（thpdp 无此角色，剧情文案暂不依赖）。
- ESLint / CI（零依赖原则下低优先）。

## Done（摘要）

- 2026-09-05 前：3D 地图、立绘无框化、排版节奏、抽奖 reel。
- Iter1（5946f98）：玩家端剩余异变条、图例 orb 化、cleared 金 ✓、按钮收益/禁用原因、时长文案。
- Iter2（aa33e4e / 238738c）：大屏一屏锁定、排行榜页码、奖池网格、区域状态语义、大屏异变条 0 高历史 bug 修复。
- Iter3（027e0f3）：interactions 三处文案（妹红/早苗/文文）。
- Iter4（8b78366）：admin 主/危险按钮视觉分层 + 确认框后果说明 + focus-visible。
- Iter5（5ec8d48）：玩家端行动分组（常用/更多行动折叠，含 [hidden] 失效 bug 修复）；375px 页头 chip 不折行、eyebrow 窄屏字距防孤字。
- Iter6（0748fb4）：admin 原生 confirm/prompt 全部替换为页内模态（焦点管理/危险态红确认）；换阵营改下拉；封禁补确认；修复换阵营 player 未定义的历史 bug。
- Iter7（e668dc1）：admin 去除操作性英文 eyebrow（保留 QUICK PICK 仪式牌）；空态统一「暂无…」。
- Iter8（13ec962）：「结束活动」实底红 + meta 分段 nowrap（冷却短语不拆行）+ 琪露诺文案补主语。
- Iter9：文案去 AI 味——通读文花帖/音乐室评论/求闻史纪提炼 7 条准则入 COPY_GUIDE；interactions 34 条 outcome 全重写（数值零改动）、titles/activity/regions 收尾、app.js 空态。
