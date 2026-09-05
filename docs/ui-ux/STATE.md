# UI/UX 迭代状态（STATE）

- 更新时间：2026-09-05（Iteration 2 完成后）
- HEAD：见 git log（Iter1 = 5946f98）
- 工作区：`.ntj-beautify-notes.md` 为用户/前次会话的美化备忘（未跟踪，视为用户资产，不提交不删除）

## 视觉方向（已确立，不推翻）

夜幕下的交通大学被后户四季力量侵蚀。黑/墨蓝/深紫基底 + 五色光晕背景 + 毛玻璃面板 + 3D diorama 校园地图（map.js，rotateX 55°，billboard 立牌）+ 季节语义色 + 灵梦红/魔理沙金阵营色。立绘已无框化、底部对齐。

## 三端

- 玩家端 `index.html/app.js/player.css`：手机 375–430 优先。
- 大屏 `display.html/js/css`：1920×1080，3s 轮询只读。
- 管理端 `admin.html/js/css`：1366/1440 桌面。

## 最近完成（本会话）

- Iteration 1（5946f98）：玩家端剩余异变条语义、图例 orb 化、cleared 金 ✓、互动按钮补削减量/具名阵营限定/冷却文案、section-head 窄屏换行。
- Iteration 2：大屏 1080 一屏锁定（body height:100vh 桌面端）、grid 行 minmax(0,1fr)、排行榜页码可见、奖池 4 列网格卡内滚动、区域状态语义（locked「—」/cleared 金卡「异变已清零」/条=剩余季节色）、修复大屏异变条 0 高历史 bug（.anomaly-bar 从 player.css 上移 styles.css 共享）、地图提示文案。

## 已验证页面（2026-09-05 baseline 截图）

- 玩家注册页 390×844 ✔；玩家主界面（登录 dev 账号）390×844 ✔；大屏 1920×1080 ✔；管理端总览 1366×768 ✔。
- `npm test`：84/84 通过。

## 已知问题（详见 BACKLOG）

- P1 interactions.json 三处文案（妹红「异变-0」、早苗 Performing、文「全新闻自由」）。
- P1 admin「强制 CLEAR」等术语 + 确认框后果（Iter3）。
- P2 admin window.prompt/confirm 粗糙；admin 英文 eyebrow；结束/开始活动按钮区分弱；玩家端 action list 10 键同权重；375px marker label 拥挤；「冷却 1 分 30 秒」折行。
- 大屏区域列表余 ~70px、动态流滚动（卡内滚动，可接受）。
- 集成测试偶发 flaky 1 次（复跑全过，观察）。
- 运行时 `data/state.json` 有 dev 脏数据（奖品名 "w"、"测试用"），演示前删 data/ 重播种。

## 下一步（优先级）

1. Iteration 3：文案 pass —— seeds 三处修正、admin 术语统一（强制 CLEAR→强制解决）+ 确认框写明后果、玩家端遗留提示语润色。
2. Iteration 4：管理端视觉层级（danger/primary 区分、danger 确认样式、表格密度）。
3. Iteration 5：玩家端 action 分组 + 375px marker 细节 + 430×932 复验。

## 用户明确要求 / 禁止破坏

- 不推翻现有设计方向；refinement 而非 redesign。
- 不改业务数值/概率/状态机；seeds 只可改 name/description/text/title/cleared_story/tagline/story_intro/slogan。
- 零第三方依赖；不从公网 CDN 加载资源。
- 遵守 prefers-reduced-motion；性能敏感（现场低端手机）。
- 地图 API `NTJ.renderCampusMap(container, regions, {selectedId, onSelect}) → {update}` 不可破坏（display.js 依赖）。
- 用户自己的 yukari.png 改动不提交。
- 每个稳定 milestone 独立 commit；永不 reset --hard / clean -fd。

## 环境备忘

- 本地 `.env`：PORT=3000，ADMIN_PASSWORD=demo-admin-2026，入口 /demo-admin-entry.html。
- dev 玩家：测试-紫音 等 20 个（密码 dev1234，见 scripts/seed-dev.js）。
- 浏览器截图通道易在带 3D 地图的页面上卡死/返回旧帧：每标签页前 1-2 张可靠，之后用新标签页或 DOM 断言代替。
- CSS/JS 改动需同步 bump HTML 中的 ?v= 版本号（styles.css 现为 v=7；common.js 玩家端 v=3 / 管理端 v=4；app/display.js v=3）。
