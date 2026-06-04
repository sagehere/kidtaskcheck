# 儿童任务打卡

一个面向家庭儿童激励的 Cloudflare Pages 应用。前端使用 React + TypeScript，后端使用 Cloudflare Pages Functions，核心数据存储在 D1。

## 功能范围

- 管理员：管理家长用户、系统图库、AI 服务配置。
- 家长：管理孩子、任务分类、任务、奖励、成就，处理任务审核和奖励核销。
- 子用户：提交任务、查看积分、兑换奖励、查看成就墙、AI 寄语。
- 任务支持每日、每周、每月、一次性周期，支持加分和扣分。
- 任务审核跨周期时按提交时间归属。
- 奖励兑换周期限制按申请时间归属。
- 积分余额由流水汇总得到。
- 删除家长用户时执行软删除，并归档其子账户和配置。

## 本地开发

```bash
npm install
npm run build        # TypeScript 检查 + 前端构建
npm test             # 运行测试（8 个文件，40+ 测试）
npm run db:migrate:local  # 本地 D1 数据库迁移
npm run pages:dev    # 启动本地开发服务器（默认端口 8788）
```

默认管理员账号：`admin`。生产环境不要把管理员密码写进 `wrangler.toml`，请在 Cloudflare 中用环境变量或 Secret 设置 `ADMIN_PASSWORD`。

## 部署

本项目部署到 Cloudflare 时分成两部分：

- Cloudflare Pages：负责网站页面和 `/api/*` 接口。
- 独立 Cloudflare Worker：负责 AI 定时刷新任务，因为 Pages 不支持 Cron Trigger。

也就是说，完整部署需要完成：

1. 创建 D1 数据库。
2. 部署 Pages 应用。
3. 部署 Cron Worker。
4. 给 Pages 和 Worker 分别设置生产环境变量或 Secret。

### 新手准备

先确认你已经有以下账号和工具：

- 一个 Cloudflare 账号。
- 一个 GitHub 账号。
- 本项目代码已经推送到 GitHub 仓库。
- 电脑已安装 Node.js，建议使用 Node.js 22 或更新版本。
- 电脑可以打开命令行工具，例如 Windows PowerShell、macOS Terminal 或 Linux Shell。

第一次在本地使用项目时，先安装依赖：

```bash
npm install
```

登录 Cloudflare 命令行工具：

```bash
npx wrangler login
```

执行后浏览器会打开 Cloudflare 授权页面，按页面提示允许 Wrangler 访问你的 Cloudflare 账号。

### 生产环境变量

生产部署前至少要准备这些变量：

| 名称 | 是否必须 | 说明 | 示例 |
|------|----------|------|------|
| `ADMIN_PASSWORD` | 必须 | 管理员登录密码，不能使用默认密码 | `your-strong-password` |
| `ENVIRONMENT` | 必须 | 生产环境标记 | `production` |
| `APP_URL` | 必须 | 应用公网地址，用于安全校验 | `https://your-app.pages.dev` |
| `AI_API_KEY` | 可选 | AI 服务 API Key，只有启用 AI 服务时需要 | `sk-...` |

注意：Pages 和 Cron Worker 是两个不同的 Cloudflare 项目。**如果 Worker 也需要使用某个 Secret，就要在 Worker 上再设置一遍，不能只给 Pages 设置。**

### 方式一：通过 Cloudflare 界面部署 Pages

适合不熟悉命令行的新手。这个方式用 GitHub 连接 Cloudflare Pages，每次推送代码后自动部署网站。

1. 登录 Cloudflare Dashboard。
2. 左侧进入 `Workers & Pages`。
3. 点击 `Create application`。
4. 选择 `Pages`。
5. 选择 `Connect to Git`。
6. 授权 Cloudflare 访问你的 GitHub。
7. 选择本项目仓库，例如 `taskcheck`。
8. 点击 `Begin setup`。
9. 填写项目名称，例如 `kids-task-checkin`。
10. 选择生产分支，一般是 `main`。
11. Build command 填写：

```bash
npm run build
```

12. Build output directory 填写：

```bash
dist
```

13. Root directory 保持空白，除非你的代码在仓库子目录中。
14. 点击 `Save and Deploy`。

首次部署后，需要进入 Pages 项目设置继续配置 D1 和环境变量。

#### 通过界面绑定 D1 数据库

1. 进入 Cloudflare Dashboard。
2. 左侧进入 `Workers & Pages`。
3. 打开你的 Pages 项目，例如 `kids-task-checkin`。
4. 进入 `Settings`。
5. 找到 `Bindings`。
6. 添加 D1 database binding。
7. Binding name 必须填写：

```text
DB
```

8. D1 database 选择 `kids_task_checkin`。
9. 保存设置。

如果你还没有 D1 数据库，可以在 Cloudflare Dashboard 左侧进入 `Storage & Databases`，选择 `D1 SQL Database`，点击 `Create database`，数据库名称填写：

```text
kids_task_checkin
```

创建完成后，把数据库 ID 填入两个配置文件：

- `wrangler.toml`
- `wrangler.scheduler.toml`

对应字段是：

```toml
database_id = "你的 D1 database ID"
```

#### 通过界面设置 Pages 环境变量

1. 打开 Pages 项目。
2. 进入 `Settings`。
3. 进入 `Environment variables`。
4. 在 `Production` 环境中添加：

```text
ADMIN_PASSWORD=你的管理员密码
ENVIRONMENT=production
APP_URL=https://你的 Pages 域名
```

5. 如果使用 AI 服务，也添加：

```text
AI_API_KEY=你的 AI Key
```

6. 保存后重新部署一次 Pages。

#### 界面部署后必须执行的命令

Cloudflare Pages 可以通过界面连接 GitHub 自动部署，但下面两件事仍然建议通过命令完成：

- 执行 D1 数据库迁移，把表结构创建到远程数据库中。
- 部署独立 Cron Worker，因为 Pages 自身不支持 Cron Trigger。

在本地项目目录执行：

```bash
npm install
npx wrangler login
npm run db:migrate:remote
npm run scheduler:deploy
```

如果你还没有给 Cron Worker 设置 Secret，继续执行：

```bash
npx wrangler secret put ADMIN_PASSWORD --config wrangler.scheduler.toml
npx wrangler secret put ENVIRONMENT --config wrangler.scheduler.toml
npx wrangler secret put APP_URL --config wrangler.scheduler.toml
```

如果使用 AI 服务，再执行：

```bash
npx wrangler secret put AI_API_KEY --config wrangler.scheduler.toml
```

最后再次部署 Worker，让配置确认生效：

```bash
npm run scheduler:deploy
```

### 方式二：通过命令行部署 Pages

适合希望在本地手动执行部署的人。

先在本地验证代码：

```bash
npm run build
npm test
```

如果还没有 D1 数据库，可以用命令创建：

```bash
npx wrangler d1 create kids_task_checkin
```

命令执行后会输出 `database_id`。把这个 ID 填入：

- `wrangler.toml`
- `wrangler.scheduler.toml`

然后执行远程数据库迁移：

```bash
npm run db:migrate:remote
```

设置 Pages Secret。项目名称如果不同，请把 `kids-task-checkin` 换成你的 Pages 项目名：

```bash
npx wrangler pages secret put ADMIN_PASSWORD --project-name kids-task-checkin
npx wrangler pages secret put ENVIRONMENT --project-name kids-task-checkin
npx wrangler pages secret put APP_URL --project-name kids-task-checkin
```

每条命令执行后，终端会提示你输入对应的值。例如 `ENVIRONMENT` 输入 `production`，`APP_URL` 输入你的 Pages 网址。

发布 Pages：

```bash
npm run pages:publish
```

这个脚本会依次执行构建、远程迁移和 Pages 发布。

### 部署 Cron Worker

Pages 不支持 Cron Trigger，所以 AI 定时刷新由独立 Worker 执行。

Worker 配置文件是：

```text
wrangler.scheduler.toml
```

定时表达式是：

```toml
crons = ["*/30 * * * *"]
```

含义是每 30 分钟触发一次。代码内部只会在本地时间 0 点附近执行真正的周报、月报或寄语刷新，其他时间会跳过。

部署 Worker：

```bash
npm run scheduler:deploy
```

首次部署 Worker 后，给 Worker 设置 Secret。注意这一步设置的是 Worker，不是 Pages：

```bash
npx wrangler secret put ADMIN_PASSWORD --config wrangler.scheduler.toml
npx wrangler secret put ENVIRONMENT --config wrangler.scheduler.toml
npx wrangler secret put APP_URL --config wrangler.scheduler.toml
```

如果 Worker 需要调用 AI 服务，也设置：

```bash
npx wrangler secret put AI_API_KEY --config wrangler.scheduler.toml
```

Secret 设置完成后，建议再次部署 Worker：

```bash
npm run scheduler:deploy
```

### 推荐完整命令流程

如果你已经创建好 Cloudflare Pages 项目，并且 `wrangler.toml`、`wrangler.scheduler.toml` 中的 D1 `database_id` 都正确，可以按下面顺序执行：

```bash
npm install
npx wrangler login
npm run build
npm test
npm run db:migrate:remote
npm run pages:publish
npm run scheduler:deploy
```

然后分别设置 Pages Secret 和 Worker Secret。Secret 设置完成后，再执行一次：

```bash
npm run pages:publish
npm run scheduler:deploy
```

### 常见部署错误

#### Pages 报错不支持 triggers

错误示例：

```text
Configuration file for Pages projects does not support "triggers"
```

原因是把 Cron 配置写进了 Pages 使用的 `wrangler.toml`。Pages 不支持 Cron Trigger。

正确做法：

- `wrangler.toml` 只放 Pages 支持的配置。
- `wrangler.scheduler.toml` 放独立 Worker 的 `[triggers]` 配置。
- 用 `npm run scheduler:deploy` 部署 Cron Worker。

#### 页面能打开，但接口报数据库错误

通常是 D1 没有绑定或绑定名称写错。

检查 Pages 项目的 D1 binding name 必须是：

```text
DB
```

也要确认已经执行：

```bash
npm run db:migrate:remote
```

#### 生产环境无法登录管理员

检查 Pages 的生产环境变量是否设置了：

```text
ADMIN_PASSWORD
ENVIRONMENT=production
APP_URL
```

如果刚刚修改过环境变量，需要重新部署 Pages 后才会生效。

#### Cron Worker 没有执行 AI 刷新

先检查 Worker 是否已经部署：

```bash
npm run scheduler:deploy
```

再检查 Worker 是否绑定了同一个 D1 数据库，binding name 是否为：

```text
DB
```

最后检查 Worker 是否也设置了 AI 相关 Secret。Pages 的 Secret 不会自动同步给 Worker。

### 默认密码保护

生产环境下，如果 `ADMIN_PASSWORD` 仍为 `change-me-admin-password`，登录将被拒绝，并提示修改密码。如需临时绕过（如首次初始化），可添加 `ALLOW_DEFAULT_ADMIN_PASSWORD=1` 作为 Secret。

## 测试

```bash
npm test                                   # 运行全部测试
npx vitest run tests/cross-family.test.ts  # 跨家庭安全测试
npx vitest run tests/concurrency.test.ts   # 并发与幂等测试
npx vitest run tests/api.test.ts           # API 集成与输入校验测试
```

## 数据安全

- 所有跨家庭查询都通过 `parent_id` 过滤。
- 积分流水通过部分唯一索引防止重复记账。
- AI 服务地址必须为 HTTPS，禁止内网和回环地址。
- 非 GET 请求在生产环境校验 Origin/Referer。
- AI 请求设置 15 秒超时，禁止跟随重定向。
