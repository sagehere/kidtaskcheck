# PROJECT_BRIEF_FOR_AI

最近更新：2026-06-23

这份文件用于让新的 AI 模型快速建立对本项目的全局理解。它不是 `FEATURE_INDEX.md` 的替代品：执行具体维护任务时，仍必须先读 `PROJECT_INDEX.md` 和 `FEATURE_INDEX.md`，定位到对应功能单元，再读取该单元的 P0/P1/P2 文件。

## 一句话理解

这是一个 Docker-first 的家庭任务打卡与积分奖励系统。管理员创建和维护家长账号；家长配置孩子、任务、奖励、成就、反馈、AI 服务和报表；孩子完成任务、兑换奖励、查看积分、通知、仓库、成就和日程表。生产形态是 Node.js HTTP 服务托管 React 静态资源，后端使用 SQLite，推荐通过 Docker Compose 和外部反向代理部署。

## 用户角色

- 管理员：维护家长账号、图库、系统时区、系统错误日志和管理员资料。
- 家长：管理家庭内的孩子、任务、奖励、成就、反馈、AI 设置、报表、导入导出和审核流程。
- 协同管理员：由家长创建，进入家长侧工作台，权限边界由后端 actor/parent 关系控制。
- 孩子：查看今日任务和任务墙、提交任务、查看积分流水、兑换奖励、管理仓库、查看 AI 问候、维护自己的日程表。

## 技术栈

- 前端：React 19、TypeScript、Vite、lucide-react、emoji-datasource。
- 后端：Node.js ESM HTTP server，不依赖 Express。
- API：`server/api/router.mjs` 负责鉴权、actor 构建、路由分发和错误处理；具体能力拆在 `server/api/routes/*`。
- 数据库：SQLite，默认本地路径为 `data/taskcheck.sqlite`，适配层在 `server/sqlite-db.mjs`。
- AI：OpenAI-compatible 文本/图片 provider，队列、缓存、prompt 和定时刷新在 `server/api/ai/*`。
- 定时任务：`server/scheduler-tick.mjs` 是共享 tick；`server/index.mjs` 可启用内置 scheduler；`server/scheduler.mjs` 是独立 scheduler 进程。
- 测试：Vitest，测试数据库由 `tests/helpers/sqlite-test-db.ts` 创建内存 SQLite。
- 部署：Docker Compose，镜像目标是 `ghcr.io/sagehere/kidtaskcheck:latest`。

## 关键入口文件

- `src/App.tsx`：登录、会话恢复、角色识别和角色 App 懒加载。
- `src/AdminApp.tsx`：管理员后台。
- `src/ParentApp.tsx`：家长工作台和大多数配置、审核、报表、AI 设置界面。
- `src/ChildApp.tsx`：孩子端任务墙、积分、奖励、仓库、成就、AI 问候和日程表。
- `src/components/Shell.tsx`：全局壳、退出、通知中心和快捷操作。
- `src/components/LedgerModal.tsx`：家长和孩子共用的积分流水展示。
- `src/api/client.ts`：浏览器侧 API 请求封装和 unauthorized 事件。
- `src/types/api.ts`：前后端共享类型。
- `src/lib/domain.ts` 与 `src/lib/domain.js`：周期、时区、规则等共享领域逻辑，两个文件必须保持同步。
- `src/lib/appHelpers.ts`：前端展示辅助逻辑，尤其是成就规则说明。
- `src/lib/ledgerView.ts`：积分流水展示分组、筛选和标签逻辑。
- `server/index.mjs`：Node HTTP/static server，提供 `/healthz` 和 `/api`。
- `server/api/router.mjs`：API bootstrap、actor 解析、鉴权、路由分发和错误日志。
- `server/api/utils.js`：数据库 helper、鉴权、校验、通知、账本、报表、schema ensure 等共享后端能力。
- `server/api/routes/auth.js`：登录、退出和当前用户。
- `server/api/routes/admin.js`：管理员能力。
- `server/api/routes/parent.js`：家长能力和大部分家庭配置。
- `server/api/routes/child.js`：孩子能力。
- `server/api/routes/shared.js`：通知、流水、配置导入导出等共享能力。
- `server/api/ai/orchestrator.js`：AI 生成流程编排。
- `server/api/ai/providers.js`：OpenAI-compatible provider 访问。
- `server/api/ai/prompt.js`：文本和图片 prompt 构造。
- `server/api/ai/cache.js`：AI 问候和报表评论缓存。
- `server/api/ai/queue.js` 与 `server/api/ai/cartoon-queue.js`：文本/图片异步任务队列。
- `server/api/ai/scheduled.js`：定时 AI 刷新。
- `migrations/*.sql`：SQLite schema 演进。
- `tests/*.test.ts`：按领域覆盖 API、账本、通知、AI、迁移、调度、并发和跨家庭隔离。

## 主要业务域

### 登录、会话与角色分流

登录从 `src/App.tsx` 进入，经 `src/api/client.ts` 调用 `/api/auth/login`，后端由 `server/api/routes/auth.js` 处理。`/api/auth/me` 返回当前 actor，前端按 `admin`、`parent`、`parent_delegate`、`child` 分流。会话使用 HttpOnly cookie 和 `sessions` 表；“记住我”对应长会话。

### 管理员后台

管理员主要维护系统级资源：家长用户、图库、时区、系统错误日志和自身资料。生产环境默认管理员密码不能使用占位值。删除家长应保持归档/停用语义，而不是硬删除。

### 家长配置与审核

家长端是最大界面，集中在 `src/ParentApp.tsx` 和 `server/api/routes/parent.js`。核心能力包括孩子账号、协同管理员、任务分类、任务、奖励、成就、反馈模板、AI 服务、报表、配置导入导出、任务审核、奖励核销/取消/退款。跨家庭查询必须在 SQL 层过滤 `parent_id`。

### 孩子端

孩子端集中在 `src/ChildApp.tsx` 和 `server/api/routes/child.js`。孩子可查看任务墙、提交任务、查看积分流水、兑换奖励、清理仓库、查看通知、管理日程表。孩子端不能暴露 AI 生成触发逻辑，只展示已缓存的问候和状态。

### 积分账本

`point_ledger` 是积分余额的事实来源，余额应通过账本求和得到，不应信任 UI 派生状态。任务审核、奖励兑换/取消/退款、反馈、补救和必做任务扣分都必须通过账本产生可追踪记录。流水排序通常应使用 `datetime(created_at) DESC, created_at DESC, id DESC` 兼容旧 SQLite 时间文本。

### 必做任务与周期规则

任务可配置为必做任务，包含必做次数和未达标扣分。周期规则在 `src/lib/domain.ts` 和 `src/lib/domain.js` 中共享。`settleRequiredTaskPenalties` 由 `schedulerTick` 显式触发，按 `task_id + child_id + period_key` 幂等结算，同周期不重复扣分，扣分最多扣到可用积分 0，不产生负分。

### 通知中心

通知由 `server/api/utils.js` 的通知 helper 创建，展示在 `src/components/Shell.tsx`。通知中心只显示未读通知，待处理任务和奖励事件优先。家长可从通知中心快捷审核任务或处理奖励兑换。必做扣分也会生成孩子端通知。

### 报表、打印与归档

家长可导出孩子打卡清单、周报、月报和日程表打印页。报表应使用已完成周期语义，并适配 A4。AI 评论缺失不能导致基础 HTML 报表 500。活动归档和流水查询需要保持时间窗口、时区和排序一致。

### AI 文本与图片

家长配置 OpenAI-compatible 文本和图片服务。文本 AI 生成孩子问候和周/月报评论；图片 AI 生成漫画报告图、打印清单图和日程表图。预览默认不写缓存，只有用户显式替换缓存时才写入。图片生成使用独立 job 表和轮询接口，不要把生成结果持久化到新存储，除非用户明确要求。

### 孩子日程表

孩子可编辑每日模板式日程表：时间段、计划富文本、可完成任务。家长只读，可打印或生成日程表插画。日程表不改变任务提交、审核和积分流程。日程表任务池使用任务自身的 `limitCount` / `limit_count` 表示可安排次数，不使用必做任务的 `required_count`。

### 配置导入导出

家长可导出和导入家庭配置。跨数据库导入不能依赖旧库中的孩子、任务、奖励或成就 ID，应尽量通过孩子名、分类名、任务标题等语义字段重映射。导入必须保持跨家庭隔离和去重策略。

## 数据和安全不变量

- 跨家庭数据必须在 SQL 层按 `parent_id` 隔离。
- 删除父级或孩子应优先软删除/归档。
- `point_ledger` 是余额来源。
- `src/lib/domain.ts` 和 `src/lib/domain.js` 必须同步。
- schema 变更通常需要同时更新 migration 和运行时 ensure helper。
- 生产 `APP_URL` 必须与浏览器访问 URL 完全一致。
- 生产 `ADMIN_PASSWORD` 不能是默认占位值。
- 家长 AI 设置有 draft state；后台轮询不能覆盖正在编辑的表单。
- 新增用户可感知功能后，应更新 `docs/ai/FEATURE_INDEX.md` 并追加 `docs/ai/CHANGELOG_AI.md`。

## 维护工作流

1. 先读 `docs/ai/PROJECT_INDEX.md` 和 `docs/ai/FEATURE_INDEX.md`。
2. 在 `FEATURE_INDEX.md` 中找到用户请求对应的功能单元。
3. 先读该功能单元 P0 文件；只有 P0 不足时才说明原因并读 P1/P2。
4. 结构性问题优先使用 CodeGraph：定义、调用链、影响面和相关符号源码。
5. 字面量问题使用有目标的 `rg`，不要默认全项目搜索。
6. 不读 `node_modules`、`dist`、`build`、`.next`、`coverage`、`.git`、大型日志或生成文件，除非用户明确指定。
7. 如果索引与代码冲突，信代码，完成任务后修正索引。
8. 不做无关重构，不升级依赖，除非用户明确要求。
9. 按改动风险运行最小必要验证。

## 常用验证

- 构建：`rtk npm run build`
- 全量测试：`rtk npm test`
- 单测文件：`rtk npm test -- tests/api.test.ts`
- SQLite 迁移：`rtk npm run db:migrate:sqlite`
- SQLite 校验：`rtk npm run db:verify:sqlite`
- 本地 Node 服务：`rtk npm run server`
- 内置 scheduler 服务：`ENABLE_BUILTIN_SCHEDULER=true rtk npm run server`
- 独立 scheduler：`rtk npm run scheduler`

## 部署心智模型

本仓库当前没有旧托管平台部署路径。生产默认是 Docker Compose 拉取 `ghcr.io/sagehere/kidtaskcheck:latest`，容器内部端口为 `3000`，当前 compose 示例把宿主机 `100` 映射到容器 `3000`。公网 HTTPS 通常由既有反向代理处理，例如 Nginx Proxy Manager。不要提交 `data/`、`backups/`、SQLite 数据库、日志或本地构建输出。

## AI 读项目时的推荐路线

如果只是建立理解，按这个顺序阅读：

1. `docs/ai/PROJECT_INDEX.md`
2. `docs/ai/FEATURE_INDEX.md`
3. 本文件
4. 与任务相关功能单元的 P0 文件
5. 必要时读 P1/P2 文件和对应测试

如果要改代码，先明确用户可感知功能属于哪个功能单元，再动手。这个项目的很多逻辑跨前端、API、共享 helper、迁移和测试，最危险的错误通常来自只改了其中一侧。
