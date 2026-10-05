# 钢琴调律与琴房环境档案（gbpianotune）

面向钢琴调律师与琴行售后的本地化档案工具：按琴建档后逐次记录调律的基准音高与各音区音分偏差，登记整音、换弦与击弦机调整等维修事项，同时记录琴房温度湿度并跟踪调律周期与下次建议日期。

核心动作：**建琴档案 → 录调律前后音分 → 记整音维修 → 录琴房环境 → 算周期并提醒下次调律 → 导出档案**。

纯前端单页应用（Svelte 5 + TypeScript + Vite + Svelte SPA Router + Tailwind CSS + Dexie），**无后端、无数据库服务、无 API 服务**，全部数据保存在浏览器本地（IndexedDB），刷新或重启浏览器后仍然存在。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先复制环境变量模板
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

启动完成后访问：**http://localhost:22830**

常用命令：

```bash
docker compose ps                 # 查看服务状态（healthy 表示就绪）
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 代码改动后重新构建
```

> 本项目使用 `svelte-spa-router`，它采用 **hash 路由**，因此页面地址形如 `http://localhost:22830/#/pianos`；直接访问 `http://localhost:22830` 会自动跳到 `/pianos`。
> 端口可在 `.env` 中通过 `FRONTEND_PORT` 修改；容器名固定为 `${COMPOSE_PROJECT_NAME:-gbpianotune}-frontend`。
> 容器无状态：不连接数据库、不挂载命名卷，数据全部在浏览器本地，迁移设备请使用应用内「导出整库备份 / 导入备份」。

---

## 二、技术栈

| 分类 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Svelte 5（runes：`$state` / `$derived` / `$props` / `$effect`） | 全部页面与组件使用 runes 语法 |
| 语言 | TypeScript（`strict: true`，无 `any`） | `npm run build` 内含 `svelte-check` 类型检查 |
| UI 方案 | Tailwind CSS 3.4（手写组件类） | 不引入任何 UI 组件库，样式在 `app.css` 里以 `@layer components` 统一 |
| 构建工具 | Vite 6 | 开发服务器端口 22830 |
| 状态管理 | Svelte store（`writable` / `derived`） | `pianoStore` / `tuningStore` / `voicingStore` / `environmentStore` / `reminderStore` |
| 路由 | svelte-spa-router 5（hash 路由） | 路由表在 `src/lib/router/index.ts` |
| 本地存储 | Dexie 4（IndexedDB 封装） | 库名 `gbpianotune-db`，含结构版本号与 upgrade 迁移 |
| 容器化 | Docker 多阶段构建：`node:20-alpine` → `nginx:alpine` | 构建阶段执行类型检查与打包，运行阶段仅托管静态产物 |

---

## 三、本地开发方式

```bash
cd frontend
npm install
npm run dev        # 开发服务器 http://localhost:22830
npm run build      # 类型检查（svelte-check）+ 生产构建，产物在 frontend/dist
npm run preview    # 本地预览构建产物（http://localhost:22830）
npm run check      # 仅做类型检查
```

---

## 四、页面与路由

| 路由 | 模块 | 消费模型 | 主要交互 |
| --- | --- | --- | --- |
| `/pianos` | 钢琴档案台账 | Piano、Tuning、Reminder | 新建/编辑/删除琴档（删除确认与级联）、按品牌/类型/场所筛选、卡片回显最近调律日期、平均音分偏差与下次建议日期、筛选同步 URL query |
| `/tunings` | 调律记录 | Tuning、Piano | 录入基准音高与低/中/高音区音分偏差、自动计算平均与最大值、**音区偏差条形图**、超阈值自动标记需复调 |
| `/voicings` | 整音与维修 | Voicing、Piano | 登记毡槌/击弦机/换弦/踏板事项、按钢琴汇总维修履历、切换计划/已完成（完成回写钢琴状态） |
| `/environments` | 琴房温湿度记录 | Environment、Piano、EnvThreshold、EnvQueueItem | 按日期录入温湿度，**按记录当天生效的阈值版本判定越界并高亮**；阈值变更后全量重刷旧标记并联动重算调律提醒；记录仪批量导入（跨标签页提交锁、每日 200 条上限超额排队次日分批）；停用琴拒写并存草稿 |
| `/reminders` | 调律周期提醒与导出 | Reminder 及全部模型 | 由周期与上次调律日期推算下次建议日期、**超期琴置顶**、按场所批量筛选、单琴档案与整库 JSON 导出导入 |

---

## 五、目录结构

```
sologsb101-1030/
├── README.md
├── docker-compose.yml
├── .env / .env.example
├── .gitignore
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # try_files SPA fallback + gzip
    ├── .dockerignore
    ├── index.html / vite.config.ts / svelte.config.js / tsconfig.json / tsconfig.node.json
    ├── tailwind.config.js / postcss.config.js / package.json
    ├── public/favicon.svg
    └── src/
        ├── main.ts  App.svelte  app.css  vite-env.d.ts
        ├── lib/types/              # piano.ts tuning.ts voicing.ts environment.ts reminder.ts filter.ts
        ├── lib/stores/             # pianoStore tuningStore voicingStore environmentStore reminderStore
        ├── lib/components/common/  # CentsTag.svelte FilterBar.svelte StatBadge.svelte EmptyPanel.svelte
        ├── lib/hooks/              # useCentsDeviation.ts useIdbTable.ts
        ├── lib/utils/              # cents.ts db.ts export.ts seed.ts uuid.ts query.ts
        ├── lib/router/index.ts     # 路由表与导航配置
        └── routes/                 # pianos/ tunings/ voicings/ environments/ reminders/ 各一个 +page.svelte
```

---

## 六、数据存储说明

- **IndexedDB 库名**：`gbpianotune-db`（Dexie 封装），结构版本号 `version(2)`（v2 由 v1 自动升级：新增阈值版本表与导入队列表）。
- **分表存储**：`pianos` 钢琴、`tunings` 调律、`voicings` 整音维修、`environments` 琴房环境、`reminders` 周期提醒、`thresholds` 温湿度阈值版本、`envQueue` 记录仪导入队列，共 7 张表；每行带 `revision` / `createdAt` / `updatedAt`。
- **温湿度阈值按日期生效**：每条环境记录入库时选取当天生效的阈值版本（`effectiveDate <= 记录日期` 中最新一份）判定 `abnormal` 并落库版本 id；阈值变更后以新版本全量重刷历史标记，旧标记失效。
- **越界联动调律提醒**：上次调律后出现越界记录，下次建议日期提前到「最早越界日期 + 30 天」；阈值变更重刷标记后逐台重算，无提醒但确实越界的琴自动补建（`triggerSource: environment`，越界清除且无调律基准时回收），不会漏掉本该提醒的琴。
- **停用琴拒写与草稿**：单条记录引用停用钢琴时不写入，表单内容存入 localStorage 草稿，下次打开新建弹窗自动恢复。
- **批量导入并发与限额**：跨标签页通过 Web Locks API（不支持时退回 localStorage 心跳锁）互斥，两页同时提交只放一份，另一页保留钢琴选择并提示冲突；每日批量上限 200 条，超额请求拒绝写入，余下保留原始观测日期入队，次日起每天最多放行 200 条（应用启动自动尝试放行）。
- **首屏自动播种**：`lib/utils/db.ts` 的 `initDatabase()` 在 `pianos` 表为空时调用 `seedDatabase()`，灌入互相引用的三层演示数据（钢琴 → 调律记录 → 维修 / 环境 → 提醒），其中包含 1 台超期琴与 2 条异常环境记录，保证 5 个页面首次打开都有内容；播种幂等，清空后重进会重新播种。
- **音分换算**：`lib/utils/cents.ts` 提供 `cents = 1200 × log2(f / f0)` 与反算、与标准音 A4 = 440 Hz 的比对、偏差分档（±5 / ±10 / ±20 / ±20 以上）与配色映射。
- **无后端**：没有 API 服务、没有数据库容器；容器本身无状态，不挂载任何卷。
- **级联规则**：删除钢琴会级联删除其调律、维修、环境与提醒记录。
