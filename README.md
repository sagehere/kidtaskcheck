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

## 当前环境提示

在 `C:\Users\link\Desktop\任务打卡` 这个中文路径下，`wrangler pages dev` 可能因为 esbuild 解析入口文件时报 `Cannot read directory "../..": Access is denied`。源码构建、测试和 D1 migration 已可正常运行；如需本机跑完整 Pages Functions 预览，建议把项目放到纯 ASCII 路径后再执行 `npm run pages:dev`。
