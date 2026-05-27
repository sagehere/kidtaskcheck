# 儿童任务打卡

一个面向家庭儿童激励的 Cloudflare Pages 应用。前端使用 React + TypeScript，后端使用 Cloudflare Pages Functions，核心数据存储在 D1。

## 功能范围

- 管理员：管理家长用户、系统图库。
- 家长：管理孩子、任务分类、任务、奖励、成就，处理任务审核和奖励核销。
- 子用户：提交任务、查看积分、兑换奖励、查看成就墙。
- 任务支持每日、每周、每月、一次性周期，支持加分和扣分。
- 任务审核跨周期时按提交时间归属。
- 奖励兑换周期限制按申请时间归属。
- 积分余额由流水汇总得到。
- 删除家长用户时执行软删除，并归档其子账户和配置。

## 本地开发

```bash
npm install
npm run build
npm test
npm run db:migrate:local
npm run pages:dev
```

默认管理员账号来自 `wrangler.toml`：

- 账号：`admin`
- 密码：`change-me-admin-password`

线上部署前请修改 `ADMIN_PASSWORD`，并把 `wrangler.toml` 中的 `database_id` 替换为真实 Cloudflare D1 数据库 ID。

## 部署与数据库迁移

远程 D1 初始化和后续 schema 变更需要 Wrangler migration。项目提供了部署脚本：

```bash
npm run deploy:pages
```

该脚本会先执行 `npm run build`，再执行 `wrangler d1 migrations apply DB --remote`。如果在 Cloudflare Pages 或 CI 中使用它，需要配置具备 D1 编辑权限的 Cloudflare API Token。Pages 的静态构建本身不会自动运行 D1 migration，因此不要只配置 `npm run build` 后就发布依赖新 schema 的版本。

## 当前环境提示

在 `C:\Users\link\Desktop\任务打卡` 这个中文路径下，`wrangler pages dev` 可能因为 esbuild 解析入口文件时报 `Cannot read directory "../..": Access is denied`。源码构建、测试和 D1 migration 已可正常运行；如需本机跑完整 Pages Functions 预览，建议把项目放到纯 ASCII 路径后再执行 `npm run pages:dev`。
