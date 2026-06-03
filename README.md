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

默认管理员账号：`admin`，密码在首次启动时由 `wrangler.toml` 中的 `ADMIN_PASSWORD` 设置。

## 部署

本地验证、远程迁移和 Pages 发布是三件独立的事情：

1. **构建验证**：`npm run build && npm test`
2. **远程数据库迁移**：`npm run db:migrate:remote`
3. **发布到 Pages**：`npm run pages:publish`（自动执行构建 + 迁移 + 发布）

### 生产环境要求

部署生产前必须设置以下 Cloudflare Secrets（**不要放在 `wrangler.toml` 中**）：

| Secret | 说明 |
|--------|------|
| `ADMIN_PASSWORD` | 管理员登录密码，禁止使用默认值 |
| `ENVIRONMENT=production` | 启用生产安全策略（Cookie Secure、默认密码拒绝等） |
| `APP_URL` | 应用的公网地址，用于 CSRF 校验（如 `https://your-app.pages.dev`） |
| `AI_API_KEY` | （可选）AI 服务的 API Key |

设置方式：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ENVIRONMENT
npx wrangler secret put APP_URL
```

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
