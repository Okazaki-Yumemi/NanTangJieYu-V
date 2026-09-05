# UI/UX 迭代状态（STATE）

- 更新时间：2026-09-05（Iteration 5 完成后）
- HEAD：见 git log（Iter1 = 5946f98，Iter5 = 5ec8d48；自 Iter5 起每次 commit 后 push origin main）
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
- Iteration 3（027e0f3）：文案第一批（interactions 三处与结算矛盾的文本）。
- Iteration 4（8b78366）：admin 主次按钮视觉分层 + 确认框后果说明。
- Iteration 5（5ec8d48）：玩家端行动分组——常用（调查异常点/集中调查/本阵营协助）平铺，其余收进「更多行动 (N)」折叠区；aria-expanded/controls、展开状态存 appState 跨重渲染保持；修复 display:flex 覆盖 [hidden] 的折叠失效 bug；375px 页头「进行中」chip nowrap、brand-eyebrow ≤430px 字距 0.08em 消除孤字折行。验证：375/390/430 DOM 断言 + 大屏 bodyScrollH=1080 回归，npm test 84/84。

## 已验证页面（2026-09-05 baseline 截图）

- 玩家注册页 390×844 ✔；玩家主界面（登录 dev 账号）390×844 ✔；大屏 1920×1080 ✔；管理端总览 1366×768 ✔。
- Iter5 补充：玩家端 375×812 / 390×844 / 430×932 DOM 断言 ✔（行动分组、chip/eyebrow 单行、无横向滚动）。
- `npm test`：84/84 通过。

## 已知问题（详见 BACKLOG）

- P2 admin window.prompt/confirm 粗糙；admin 英文 eyebrow；「冷却 1 分 30 秒」折行。
- 375px 地图 marker label 实测尚可（6 标记无重叠、无出界），暂降级为观察项。
- 大屏动态流滚动（卡内滚动，可接受）。
- 集成测试偶发 flaky 1 次（复跑全过，观察）。
- 运行时 `data/state.json` 有 dev 脏数据（奖品名 "w"、"测试用"），演示前删 data/ 重播种。
- 浏览器 HTML 有缓存：改版本号后需带 query 参数强制刷新才能看到新 ?v=。

## 下一步（优先级）

1. Iteration 6：admin window.prompt/confirm → 自定义模态（现场安全，含 focus 管理）；admin 英文 eyebrow 取舍（倾向保留抽奖台仪式感，仅去杂乱）。
2. Iteration 7：copy pass 第二批（display 空态、admin 文案全扫、角色语气校对）。
3. 观察项：375px marker 间距、「冷却 1 分 30 秒」折行、flaky 测试。

## 版本号现状

- index.html: styles v8 / player v8 / common v3 / map v3 / app v5
- display.html: styles v8 / display v9 / common v3 / map v3 / display.js v4
- admin.html: styles v8 / admin.css v12 / common v4 / admin.js v12
- 改 CSS/JS 后必须 bump 对应 ?v=（styles.css 三端共享，需三处同步 bump；本会话曾因忘 bump 误判 CSS 未生效）。

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
- CSS/JS 改动需同步 bump HTML 中的 ?v= 版本号（以「版本号现状」为准）；浏览器会缓存 HTML，验证时给页面 URL 加 query 参数强制刷新。
