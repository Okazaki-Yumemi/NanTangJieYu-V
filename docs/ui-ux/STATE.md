# UI/UX 迭代状态（STATE）

- 更新时间：2026-09-05
- HEAD：e8c2208（main，与 origin 同步）
- 工作区：`.ntj-beautify-notes.md` 为用户/前次会话的美化备忘（未跟踪，视为用户资产，不提交不删除）

## 视觉方向（已确立，不推翻）

夜幕下的交通大学被后户四季力量侵蚀。黑/墨蓝/深紫基底 + 五色光晕背景 + 毛玻璃面板 + 3D diorama 校园地图（map.js，rotateX 55°，billboard 立牌）+ 季节语义色 + 灵梦红/魔理沙金阵营色。立绘已无框化、底部对齐。

## 三端

- 玩家端 `index.html/app.js/player.css`：手机 375–430 优先。
- 大屏 `display.html/js/css`：1920×1080，3s 轮询只读。
- 管理端 `admin.html/js/css`：1366/1440 桌面。

## 最近完成（本次会话之前）

- 3D diorama 地图 + 选中上浮高亮（ade96b0）。
- 立绘去硬边框、600×800 归一化（14e9e60 / 9a3f686 / e8c2208）。
- 标题季节色竖条、间距节奏（753f4bd）。
- 抽奖 reel（CSGO 式）+ easter egg 事件（f9b0358 等）。

## 已验证页面（2026-09-05 baseline 截图）

- 玩家注册页 390×844 ✔；玩家主界面（登录 dev 账号）390×844 ✔；大屏 1920×1080 ✔；管理端总览 1366×768 ✔。
- `npm test`：84/84 通过。

## 已知问题（详见 BACKLOG）

- P0 玩家端异变数值语义矛盾：`284,907 / 290,000 异变` 是"剩余"，进度条却是"已解决%"，方向相反。
- P0 地图图例四色（金/蓝/绿/米）与 marker 实际视觉（季节色 orb+进度环+灰锁）不对应。
- P1 cleared 区域 orb 仍是季节色（粉色 ✓ 像“错误”），缺成功语义。
- P1 大屏排行榜 8 行/页 + space-around → 底部行与页码被裁切。
- P1 大屏区域状态：locked 显示 `360,000/360,000 0%`、cleared 显示 `0/200,000 100%` 语义混乱。
- P1 大屏奖池 8 件奖品在中心列溢出裁切。
- P1 互动按钮未展示服务端已有的 `contribution_hint.anomaly`（异变削减预期）。
- P1 interactions.json 妹红 outcome 文案「异变 -0」与实际 anomaly [30,60] 矛盾。
- P2 冷却文案「5 分 0 秒」冗长；admin「强制 CLEAR」中英混排；admin window.prompt 交互粗糙；admin 英文 eyebrow；display 提示「点击大屏地图无效…」给观众看很怪；窄屏 section-head 挤压换行。
- 运行时 `data/state.json` 有 dev 脏数据（奖品名 "w"、"测试用"），演示前需重置重播种。

## 下一步（优先级）

1. Iteration 1（进行中）：玩家端「异变进度语义 + 区域状态视觉」——剩余条语义、图例重做、cleared 金色 ✓、冷却文案、action meta 补异变范围、section-head 窄屏。
2. Iteration 2：大屏排行榜溢出 + 区域状态语义 + 奖池布局。
3. Iteration 3：文案 pass（seeds + 端内提示 + admin 术语统一）。

## 用户明确要求 / 禁止破坏

- 不推翻现有设计方向；refinement 而非 redesign。
- 不改业务数值/概率/状态机；seeds 只可改 name/description/text/title/cleared_story/tagline/story_intro/slogan。
- 零第三方依赖；不从公网 CDN 加载资源。
- 遵守 prefers-reduced-motion；性能敏感（现场低端手机）。
- 地图 API `NTJ.renderCampusMap(container, regions, {selectedId, onSelect}) → {update}` 不可破坏（display.js 依赖）。
- 用户自己的 yukari.png 改动不提交。
- 每个稳定 milestone 独立 commit；永不 reset --hard / clean -fd。
