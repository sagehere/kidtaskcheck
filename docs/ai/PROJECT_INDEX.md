# PROJECT_INDEX

最近更新：2026-07-22

## 项目简介

这是一个 Docker-first 的家庭儿童任务打卡应用。管理员创建家长账号并管理系统配置；家长维护孩子、任务、奖励、成就、反馈模板、AI 服务和报表；孩子提交任务、兑换奖励、查看积分和通知。

本仓库当前没有旧的托管平台部署路径，生产形态以 Node.js HTTP 服务、React 静态资源、SQLite 数据库和 Docker 镜像为中心。

## 技术栈

- 前端：React 19、TypeScript、Vite、lucide-react、emoji-datasource
- 后端：Node.js ESM HTTP server
- API：`server/api/router.mjs` 分发到 `server/api/routes/*`
- 数据库：SQLite，适配层 `server/sqlite-db.mjs`
- AI：OpenAI-compatible text/image provider flow，后端队列、缓存和定时刷新在 `server/api/ai`
- 测试：Vitest，SQLite 内存测试辅助在 `tests/helpers/sqlite-test-db.ts`
- 部署：Docker Compose，镜像 `ghcr.io/sagehere/kidtaskcheck:latest`

## 主要目录

- `src/App.tsx`：登录、角色识别和角色应用懒加载
- `src/AdminApp.tsx`：管理员后台
- `src/ParentApp.tsx`：家长工作台和大部分配置界面
- `src/ChildApp.tsx`：孩子端任务、奖励、积分和仓库
- `src/components`：Shell、通知中心、通用 UI 和 Emoji 选择
- `src/api/client.ts`：浏览器 API 请求封装
- `src/types/api.ts`：前后端共享类型
- `src/lib/domain.ts` / `src/lib/domain.js`：周期、时区、规则等共享领域逻辑，二者必须同步
- `server/index.mjs`：Node HTTP/static server，`/healthz` 和 `/api` 入口
- `server/api/router.mjs`：API bootstrap、鉴权 actor、路由分发和错误日志
- `server/api/routes`：按角色/共享能力拆分的 API 路由
- `server/api/utils.js`：数据库 helper、鉴权、校验、通知、账本、报表、schema ensure 等
- `server/api/ai`：AI provider、prompt、cache、队列、图片任务和定时刷新
- `server/scheduler.mjs`：独立定时刷新进程
- `migrations`：SQLite schema 迁移
- `tests`：Vitest 测试
- `docs/ai`：AI 维护索引和 AI 修改日志

## 常用命令

- 安装依赖：`npm install`
- 构建：`npm run build`
- 测试：`npm test`
- 完整验证：`npm run build && npm test`
- Vite 开发：`npm run dev`
- 本地 Node 服务：`npm run server`
- 带内置 scheduler 的本地服务：`ENABLE_BUILTIN_SCHEDULER=true npm run server`
- 独立 scheduler：`npm run scheduler`
- SQLite 迁移：`npm run db:migrate:sqlite`
- SQLite 验证：`npm run db:verify:sqlite`
- Docker 更新：`docker compose pull && docker compose up -d`

## 核心业务流与不变量

- 登录分流：`/auth/login` 创建会话，`/auth/me` 决定 admin、parent/parent_delegate 或 child 应用；退出清除会话 cookie。
- 任务审核：孩子提交任务，家长审核后才写入任务积分账本并通知；审核必须幂等，完成程度任务必须选择已配置档位。
- 奖励兑换：孩子兑换先冻结/扣减积分，家长核销、取消或退款按既有账本语义结算；奖励、任务和成就的跨家庭查询必须在 SQL 层以 `parent_id` 隔离。
- 反馈与补救：表扬/批评写入账本和通知；可补救批评、必做扣分均可冻结积分，补救、超时或确认后结算，撤回保留审计语义。
- 必做任务：周期结束由共享 scheduler tick 幂等结算，同一任务/孩子/周期最多一条扣分记录；余额永远由 `point_ledger` 聚合，不维护可漂移的余额字段。
- AI：问候、报告和三类图片均由持久队列处理；前端只读缓存/任务状态，scheduler 会恢复 pending 或过期 processing 作业。
- 维护：启动与每个 scheduler tick 都检查 24 小时维护闸门；归档只清理已终态历史，不能破坏账本、软删除和用户可见缓存。

## AI 维护入口说明

后续 Codex 维护必须从这里开始：

1. 先读本文件，确认项目形态、技术栈、常用命令和目录边界。
2. 再读 `docs/ai/FEATURE_INDEX.md`，定位用户请求对应的功能单元。
3. 优先读取该功能单元的 P0 文件。
4. 只有在 P0 不足以解释或修改问题时，才读取 P1/P2，并说明原因。
5. 修改业务代码后，必须更新对应功能单元的索引和 `docs/ai/CHANGELOG_AI.md`。
6. 如果索引与代码冲突，以代码为准，并把索引修正到当前事实。

禁止为了“先了解一下”默认读取全项目、生成目录、依赖目录、大日志或 `.git`。
