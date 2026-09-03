# 东方南堂界遇 V

上海交通大学东方 Project 同人活动「东方南堂界遇 V —— 被隐匿的交通大学 / Hidden SJTU in Four Seasons」的线上互动系统。

玩家扫码注册后加入**博丽灵梦队**或**雾雨魔理沙队**，在简化的交大校园地图上按顺序调查六个季节异变区域（思源门 → 思源湖 → 凯旋门 → 电草 → 涵泽湖 → 行政楼），消耗能量执行互动、积累个人与阵营贡献、降低区域异变值。区域异变解决后解锁后续区域，并将对应奖品注入**终盘奖池**；活动尾声由管理员按权重执行抽奖。

系统为零第三方依赖的单实例 Node.js 应用，面向约 150 人规模的线下活动：可靠性、可查账、现场可维护性优先。

---

## 功能总览

### 玩家端（手机优先）

- 通过物料二维码（`https://站点/?code=注册码`）进入，注册码自动填入。
- 一个注册码只能注册一个账号；昵称唯一；密码用于换设备重新登录。
- 选择阵营（有人数差限制），进入主界面。
- **校园地图**：简化的交大校园示意图，点击地图块选中区域；只有当前区域异变解决后才能解锁下一个。
- 每个区域有独立状态：`locked / available / investigating / cleared`，外加管理员「临时关闭」。
- 互动系统：每个区域可执行多种互动（调查异常点、协助灵梦讨伐、湖底打捞、风祝的奉纳、半灵剑技特训等），消耗能量，随机结算贡献与异变削减，结果弹窗附带东方角色立绘与文案。
- **能量**：上限与恢复速度可配置（默认 5 点、每 90 秒 1 点）。
- **贡献**三层记账：个人总贡献、个人×区域贡献、阵营总贡献，全部有流水可查。
- **抽奖权重**实时展示：票种基础权重 + 贡献阶梯加成 + 区域排名加成（CLEAR 后生效）+ 管理员调整。
- **终盘奖池进度条**：已解决区域显示真实奖品，未解决区域显示「神秘奖品」。
- 总排行榜、区域贡献榜、我的记录、全场动态。

### 管理后台（随机入口路径）

- 活动状态机：开始 / 暂停 / 恢复 / 结束，注册独立开关。
- 区域管理：调整异变值、强制解锁、强制 CLEAR、临时关闭 / 重开。
- 玩家管理：搜索、调整贡献（写流水）、调整抽奖权重、恢复能量、重置密码、封禁 / 解封。
- 注册码管理：批量生成（普通 / 特典）、查询、禁用 / 解禁、导出 CSV。
- 抽奖：奖池一览、按权重抽取指定奖品、权重预览、标记领取、作废重抽（同一玩家同一奖品防重复中奖，可配置）。
- 全部管理操作写入 AdminLog；贡献调整写入贡献流水。

### 大屏（/display.html）

16:9 投影页面：双方阵营贡献对比、校园地图实时状态、终盘奖池解锁进度（神秘奖品机制）、区域异变列表、贡献排行与全场动态。3 秒轮询只读接口，无任何写操作。

---

## 环境要求

- Node.js 18 或更高（开发时使用 Node 24 验证）
- npm（仅用于脚本入口，**无任何第三方依赖**）

```bash
node --version
```

---

## 快速开始

```bash
git clone git@github.com:Okazaki-Yumemi/NanTangJieYu-V.git
cd NanTangJieYu_V

# 运行测试（77 个单元 + 集成测试）
npm test

# 启动服务
npm start
```

默认地址：

- 玩家端：<http://127.0.0.1:3000/>
- 大屏：<http://127.0.0.1:3000/display.html>
- 管理后台：<http://127.0.0.1:3000/nantang-admin.html>（默认入口，正式部署务必修改）
- 健康检查：<http://127.0.0.1:3000/healthz>

本地开发时可用 `.env`（参考 `.env.example`，项目会自动读取，无需 dotenv 包）：

```env
PORT=3000
ADMIN_PASSWORD=local-dev-password
ADMIN_ENTRY_PATH=/my-secret-admin.html
```

> 项目不依赖 `.env` 也能运行：所有变量都有默认值，但 `NODE_ENV=production` 时未设置 `ADMIN_PASSWORD` 会拒绝启动。

---

## 目录结构

```text
.
├── server/                  # 后端（零依赖 Node.js）
│   ├── index.js             # 入口：装配配置 / 存储 / 路由
│   ├── config.js            # 环境变量与 .env 加载
│   ├── state-store.js       # JSON 状态库（原子写盘 / 备份恢复 / 事务串行）
│   ├── seed-loader.js       # 种子配置加载与交叉校验（启动 fail-fast）
│   ├── http-utils.js        # JSON / Cookie / 静态资源 / 轻路由
│   ├── auth.js              # scrypt 密码、ID / 注册码生成
│   ├── views.js             # 玩家 / 管理 / 大屏三套只读视图
│   ├── domain/              # 领域层（全部业务规则在这里）
│   │   ├── state.js         #   运行时状态构建与迁移
│   │   ├── codes.js         #   注册码
│   │   ├── players.js       #   玩家 / 会话 / 能量
│   │   ├── regions.js       #   区域状态机（解锁推导 / 异变 / CLEAR）
│   │   ├── interactions.js  #   统一互动系统（幂等 / 限流 / 结算）
│   │   ├── contributions.js #   贡献流水（state 短窗 + ledger.jsonl 全量）
│   │   ├── weights.js       #   LotteryWeightCalculator（纯函数）
│   │   ├── lottery.js       #   奖池 / 抽奖 / 领取 / 作废
│   │   ├── stage.js         #   节目事件
│   │   └── admin-log.js     #   管理审计日志
│   └── routes/              # HTTP 路由（player / admin / public）
├── shared/
│   ├── constants.js         # 队伍 / 状态 / 错误码
│   ├── random.js            # 加权随机工具
│   └── seeds/               # ★ 活动规则配置（改这里 + 重启生效）
│       ├── activity.json    #   活动元信息 / 能量 / 会话 / 限流
│       ├── teams.json       #   阵营（名称 / 颜色 / 立绘路径）
│       ├── regions.json     #   六个区域：剧情 / 季节 / 异变值 / 解锁链 / 奖品
│       ├── interactions.json#   互动与随机结果（含角色立绘引用）
│       ├── prizes.json      #   奖池（base 或绑定区域）
│       ├── lottery.json     #   抽奖权重规则（阶梯全部可配）
│       └── titles.json      #   称号阶梯
├── web/public/              # 前端（原生 JS，无构建步骤）
│   ├── index.html / app.js / player.css     # 玩家端
│   ├── admin.html / admin.js / admin.css    # 管理后台
│   ├── display.html / display.js / display.css  # 大屏
│   ├── common.js / map.js / styles.css      # 共享工具 / 校园地图组件
│   └── assets/
│       ├── characters/      # 角色立绘（互动结果与队伍卡）
│       └── regions/         # 区域与奖品占位图（可直接替换同名文件）
├── scripts/
│   ├── generate-codes.js    # 批量生成注册码 + CSV
│   ├── seed-dev.js          # 开发种子数据（20 玩家 + 模拟贡献）
│   ├── export-data.js       # 赛后数据导出（玩家 / 全量流水 / 抽奖）
│   └── lib.js
└── tests/                   # node:test 单元 + 集成测试
```

---

## 活动规则配置（seeds）

**所有数值都不在代码里**。修改 `shared/seeds/*.json` 后重启服务即生效：

| 想改什么 | 改哪个文件 |
| --- | --- |
| 区域名称 / 剧情 / 季节 / 异变值上限 / 解锁链 / 绑定奖品 | `regions.json` |
| 互动名称、能耗、冷却、结果概率与奖励区间、角色文案 | `interactions.json` |
| 能量上限 / 恢复速度 / 昵称密码限制 / 限流 / 会话时长 | `activity.json` |
| 阵营名称 / 颜色 / 立绘 | `teams.json` |
| 奖品清单与数量（`source: "base"` 或区域 id） | `prizes.json` |
| 抽奖权重：贡献阶梯、区域排名加成、同奖品防重复中奖 | `lottery.json` |
| 现场节目联动事件 | `stage-events.json` |

启动时会对种子做交叉引用校验（引用不存在的区域 / 奖品 / 队伍会直接拒绝启动），避免现场带着坏配置上线。

**运行时状态**（玩家、码、异变进度、流水、抽奖记录）保存在 `data/state.json`，与配置分离：改配置不丢数据，重启服务状态不丢。

---

## 常用运维命令

```bash
# 生成 300 个普通注册码并导出 CSV
node scripts/generate-codes.js --count 300 --type ordinary --note "现场第一批"

# 生成特典票码（初始抽奖权重 2，权重在 lottery.json 配置）
node scripts/generate-codes.js --count 20 --type special

# 生成开发演示数据（20 个测试玩家 + 模拟贡献；仅限开发环境）
node scripts/seed-dev.js

# 赛后导出（players / contributions / codes / lottery / summary）
node scripts/export-data.js --out exports
```

注册码二维码地址格式：`https://<现场域名>/?code=<注册码>`（也兼容 `?token=`）。

---

## 数据存储与备份

```text
data/
├── state.json        # 权威运行状态（原子写盘：临时文件 + rename + fsync）
├── state.json.bak    # 上一份确认有效的状态（主文件损坏时自动恢复）
├── ledger.jsonl      # 全量贡献流水（追加式审计日志）
└── admin.local.json  # 可选：管理员口令本地配置（不入库）
```

- 每个写操作都在串行事务中完成「读取 → 校验 → 变更 → 双文件落盘」。
- 主、备文件同时损坏时服务**拒绝启动**，绝不静默重建数据。
- 管理端「结束活动」等操作不会删除数据；如需重置，先停止服务并移走 `data/`，或对 `data/` 做快照。
- 正式活动建议：活动开始前备份一次 `data/`；活动期间每隔一段时间复制 `state.json` + `ledger.jsonl` 到外部位置；赛后执行 `npm run data:export` 留档。

---

## 部署（Zeabur / 任意 Node 平台）

1. 推送代码到 GitHub，平台选择仓库与 `main` 分支。
2. 启动命令 `npm start`（读取平台注入的 `PORT`）。
3. 配置环境变量：
   ```env
   NODE_ENV=production
   ADMIN_PASSWORD=<足够长的随机密码>
   ADMIN_ENTRY_PATH=/secret-admin-<随机串>.html
   DATA_DIR=/data
   ```
4. 为服务挂载持久卷到 `/data`（否则重启丢数据）。
5. 部署后检查清单：
   - `/healthz` 返回 200；
   - 用测试码注册 → 互动 → 重启服务 → 数据仍在；
   - 管理后台默认口令已更换、入口路径已改；
   - HTTPS 正常（生产环境 Cookie 自动附加 `Secure`）。

---

## 安全设计要点

- **服务端权威**：贡献、异变、解锁、权重、抽奖、注册码有效性全部由服务端决定；前端只提交意图（区域 + 互动 + 请求 ID）。
- **幂等**：互动携带 `client_request_id`，重复提交返回首次结果，不重复计分；另有进程内限流防连点。
- **注册码一次性**：绑定后不再作为身份凭据；身份 = HttpOnly 会话 Cookie 或昵称 + 密码（scrypt 存储）。
- **管理员接口全部鉴权**，登录有失败限速；危险操作二次确认并写 AdminLog。
- 玩家输入在渲染层统一 HTML 转义。
- 请勿将真实管理员密码、`data/` 运行数据、正式注册码清单提交到仓库。

---

## 开发

```bash
npm test          # node --test：单元 + 集成（真实启动 HTTP 服务走完整流程）
npm run seed:dev  # 写入开发演示数据后 npm start 预览完整界面
```

测试覆盖：注册码一次性 / 重复注册 / 昵称冲突、互动结算与幂等、能量恢复、区域解锁链与 CLEAR、抽奖权重（贡献阶梯 + 区域排名 + 管理员调整）、奖池解锁与同奖品防重复中奖、节目事件、管理操作鉴权、服务重启持久化、审计日志文件容错。

### 替换美术资源

- 角色立绘：`web/public/assets/characters/<角色id>.png`（角色 id 见 `interactions.json` 与 `teams.json` 的引用），建议透明背景 PNG。
- 区域 / 奖品图：`web/public/assets/regions/<区域id>.svg`（或改 `regions.json` / `prizes.json` 中的 `image` 路径指向新图）。
- 校园地图整体替换：改 `web/public/map.js` 的底图绘制，或在 `regions.json` 中调整各区域 `map.x / map.y` 坐标（viewBox 380×560）。
- 所有图片路径都集中在 seeds 配置与 `common.js` 的 `characterImage()`，不要在组件里散写。

---

## License

项目仅用于上海交通大学东方 Project 同人活动，未经维护者授权不得用于其他用途。
