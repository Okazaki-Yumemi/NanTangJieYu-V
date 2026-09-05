# Design System（当前有效规则）

## Tokens（styles.css :root）

- 背景 `--bg:#06070c`；面板 `--panel:rgba(16,19,30,.55)`；强面板 `--panel-strong:rgba(17,20,32,.82)`；内嵌 `--panel-inset:rgba(255,255,255,.05)`
- 文字 `--ink:#eef0f8` / 次级 `--ink-soft:#9aa0b5`
- 描边 `--line:rgba(255,255,255,.13)` / 弱 `--line-soft:.08`
- 强调 `--accent:#ff4d6d`（+soft）；金 `--gold:#ffd166`（+soft）
- 涨 `--up:#4ade80` / 跌 `--down:#ff6b81`
- 圆角 `--radius:14px`（modal 18、按钮 10–12、chip 999）
- 模糊 `--glass-blur:blur(16px) saturate(1.35)`；阴影 `--shadow:0 8px 32px rgba(0,0,0,.45)`
- 字体 Noto Sans SC 栈；数字一律 `font-variant-numeric: tabular-nums`

## 季节语义色（common.js SEASON_STYLES，勿散写）

spring #ff7fa3 / summer #4ade80 / autumn #ffb454 / winter #6ab7ff / chaos #b287ff(乱) / final #ffd166(终)。
季节色只用于：区域状态、光晕、地图、进度、小装饰。禁止整面板高饱和染色。

## 状态视觉语言（区域）

- 状态用「明暗 + glyph + 边框 + 文案」同时表达，不只靠颜色。
- marker：季节色 orb（内 glyph：季节字 / cleared ✓）+ conic 进度环 + 地面碟 + 选中光柱/上浮。
- locked = 灰度 + 0.55 透明；closed = 0.6 灰度；selected = 浮起 + 光柱 + 环高亮。
- cleared：orb 转金 `#ffd166`、✓ glyph、金进度环满圈（Iter1 起生效）。

## 组件基型

- 面板卡 = glass（panel+blur+line+radius+shadow）；区块标题 `.block-title` 带渐变竖条。
- 按钮层级：`.primary-btn`（主行动，红渐变）> `.ghost-btn`（次行动）> `.subtle`（弱化）。
- 管理端按钮语义：`.primary`（推进/确认）、普通（中性）、`.warn`（暂停/强制类）、`.danger`（结束/封禁/禁用/作废）。
- 禁用态不许只靠 opacity：必须同时给出原因文案（tag/helper）。
- chip/tag：`.status-chip`（活动态）、`.tag ok/warn/bad`（管理端行内状态）、`.season-chip`（季节）。
- 数字/时间：`formatNumber` 千分位；时长 `formatDuration`（≥60s 显示「X 分钟」，不带零秒；<60s「X 秒」；≥1h「X 时 X 分」）。

## 动效规则

- 背景光晕/粒子慢速无限；交互反馈 ≤0.35s；duration/easing 见 map/lottery 常量。
- 所有动画必须有 `prefers-reduced-motion: reduce` 降级。
- 地图视差仅 `(pointer:fine)`。

## 布局

- 玩家 shell max-width 560（≥700px 时 640）；区块间距 14。
- 大屏 grid `1.05fr / 1.35fr / 1fr`，卡片 grow + overflow hidden。
- 管理端 max-width 1180；表格 `admin-table` + `admin-table-wrap` 横向滚动。
