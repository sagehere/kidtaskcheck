# Docker 部署指南（零基础版）

本指南面向没有 Docker 经验的用户，手把手教你把任务打卡系统部署到一台 Linux 服务器（VPS）上。

---

## 目录

1. [准备工作](#1-准备工作)
2. [安装 Docker](#2-安装-docker)
3. [上传项目代码](#3-上传项目代码)
4. [配置环境变量](#4-配置环境变量)
5. [首次部署](#5-首次部署)
6. [验证部署](#6-验证部署)
7. [日常运维](#7-日常运维)
8. [数据备份](#8-数据备份)
9. [常见问题](#9-常见问题)
10. [从 Cloudflare D1 迁移数据](#10-从-cloudflare-d1-迁移数据)

---

## 1. 准备工作

### 你需要什么

| 项目 | 说明 |
|------|------|
| 一台 Linux 服务器 | 推荐 Ubuntu 22.04 或 24.04，最低 1 核 1G 内存 |
| 服务器公网 IP | 记下这个 IP，后面要用 |
| 域名（可选） | 如果要 HTTPS，需要一个域名指向服务器 IP |
| SSH 工具 | Windows 用 PowerShell 或 PuTTY，Mac/Linux 用终端 |

### 确认能连上服务器

```bash
ssh root@你的服务器IP
```

输入密码后看到命令提示符就表示连接成功。

---

## 2. 安装 Docker

### Ubuntu / Debian

```bash
# 更新软件源
apt update

# 安装 Docker
apt install -y docker.io docker-compose-plugin

# 启动 Docker 并设置开机自启
systemctl enable --now docker

# 验证安装（看到版本号就成功了）
docker --version
docker compose version
```

### CentOS / RHEL / AlmaLinux

```bash
# 安装 Docker
dnf install -y docker docker-compose-plugin

# 启动 Docker 并设置开机自启
systemctl enable --now docker

# 验证
docker --version
docker compose version
```

> **说明**：旧版 Docker 需要单独安装 `docker-compose` 命令。如果 `docker compose version` 报错，试试 `docker-compose --version`。本指南的命令对两种写法都适用。

---

## 3. 上传项目代码

### 方式一：用 Git（推荐）

```bash
# 安装 Git（如果没有）
apt install -y git

# 克隆项目
cd /opt
git clone https://github.com/你的用户名/你的仓库名.git taskcheck
cd taskcheck
```

### 方式二：手动上传

在你本地电脑用 `scp` 或 SFTP 工具（如 FileZilla）把项目文件夹上传到服务器的 `/opt/taskcheck`。

```bash
# 本地电脑执行（PowerShell 或终端）
scp -r .\* root@你的服务器IP:/opt/taskcheck/
```

上传后在服务器上进入目录：

```bash
cd /opt/taskcheck
```

---

## 4. 配置环境变量

项目根目录有一个 `.env.example` 文件，复制一份作为你的配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
nano .env
```

修改以下内容（按 `Ctrl+X` → `Y` → `Enter` 保存）：

```env
# 你的域名（没有域名就填服务器IP，例如 123.45.67.89）
APP_DOMAIN=taskcheck.example.com

# 应用名称
APP_NAME=儿童任务打卡

# 管理员账号
ADMIN_USERNAME=admin

# 管理员密码（必须修改！不要用默认值！）
ADMIN_PASSWORD=你的安全密码

# 生产环境标记
ENVIRONMENT=production

# 应用公网地址（必须和实际访问地址一致）
# 有域名填 https://你的域名，没有域名填 http://服务器IP
APP_URL=https://taskcheck.example.com

# 数据库路径（容器内部路径，一般不需要改）
DATABASE_PATH=/app/data/taskcheck.sqlite
```

### 关键提醒

- **`ADMIN_PASSWORD`**：生产环境禁止使用默认密码 `change-this-before-production`，否则无法登录。
- **`APP_URL`**：必须和用户实际访问的地址完全一致（包括 `https://` 或 `http://`），否则接口会被安全校验拦截。
- **`APP_DOMAIN`**：如果填了域名，Caddy 会自动申请 HTTPS 证书。如果没有域名（直接用 IP 访问），见下方[常见问题](#9-常见问题)。

---

## 5. 首次部署

### 5.1 构建镜像

```bash
cd /opt/taskcheck
docker compose build
```

第一次构建需要下载依赖，可能要等 2-5 分钟。看到 `Successfully built` 就成功了。

### 5.2 初始化数据库

```bash
docker compose run --rm app npm run db:migrate:sqlite
```

这会创建 `data/taskcheck.sqlite` 并执行所有数据库迁移。

### 5.3 启动服务

```bash
docker compose up -d
```

`-d` 表示后台运行。第一次启动会下载 Caddy 镜像，之后就很快了。

### 5.4 确认运行状态

```bash
docker compose ps
```

应该看到三个容器都是 `running` 状态：

```
NAME                STATUS
taskcheck-app-1     Up ...
taskcheck-scheduler-1  Up ...
taskcheck-caddy-1   Up ...
```

---

## 6. 验证部署

### 6.1 检查健康接口

```bash
# 在服务器上测试
curl http://localhost:3000/healthz
```

应返回：`{"ok":true}`

### 6.2 浏览器访问

- 有域名：打开 `https://你的域名`
- 没有域名：打开 `http://服务器IP`

看到登录页面就表示部署成功。

### 6.3 登录管理员

- 账号：`admin`（或你在 `.env` 里设置的 `ADMIN_USERNAME`）
- 密码：你在 `.env` 里设置的 `ADMIN_PASSWORD`

登录后可以创建家长账号，家长再创建孩子账号。

---

## 7. 日常运维

### 查看日志

```bash
# 查看应用日志（实时跟踪）
docker compose logs -f app

# 查看定时任务日志
docker compose logs -f scheduler

# 查看所有日志
docker compose logs -f

# 只看最近 100 行
docker compose logs --tail 100 app
```

### 重启服务

```bash
# 重启所有服务
docker compose restart

# 只重启应用
docker compose restart app
```

### 停止服务

```bash
docker compose down
```

### 更新代码

```bash
cd /opt/taskcheck

# 拉取最新代码（如果是 Git 克隆的）
git pull

# 重新构建并启动
docker compose build
docker compose up -d
```

### 执行数据库迁移（更新后）

如果新版本包含数据库迁移文件（`migrations/` 目录下有新的 `.sql` 文件），需要执行：

```bash
docker compose run --rm app npm run db:migrate:sqlite
docker compose restart app
```

### 验证数据库完整性

```bash
docker compose run --rm app npm run db:verify:sqlite
```

---

## 8. 数据备份

### 手动备份

```bash
# 创建备份目录
mkdir -p /opt/taskcheck/backups

# 备份数据库
docker compose exec app sqlite3 /app/data/taskcheck.sqlite ".backup '/app/data/backup.sqlite'"
cp /opt/taskcheck/data/backup.sqlite /opt/taskcheck/backups/taskcheck-$(date +%F).sqlite
```

### 自动每日备份（crontab）

```bash
# 编辑定时任务
crontab -e
```

在文件末尾添加：

```
0 3 * * * cd /opt/taskcheck && docker compose exec -T app sqlite3 /app/data/taskcheck.sqlite ".backup '/app/data/backup.sqlite'" && cp data/backup.sqlite backups/taskcheck-$(date +\%F).sqlite
```

这会在每天凌晨 3 点自动备份。

### 恢复备份

```bash
# 停止服务
docker compose down

# 用备份文件替换数据库
cp /opt/taskcheck/backups/taskcheck-2026-01-01.sqlite /opt/taskcheck/data/taskcheck.sqlite

# 重新启动
docker compose up -d
```

---

## 9. 常见问题

### 没有域名，直接用 IP 访问

修改 `Caddyfile`：

```bash
nano /opt/taskcheck/Caddyfile
```

替换为：

```
:80 {
  encode gzip zstd
  reverse_proxy app:3000
}
```

同时修改 `.env`：

```env
APP_DOMAIN=
APP_URL=http://你的服务器IP
```

然后重启：

```bash
docker compose down
docker compose up -d
```

> **注意**：没有域名就没有 HTTPS，数据在网络上传输是明文的。仅建议在内网或测试环境使用。

### 端口被占用（80 或 443）

如果服务器上已经有 Nginx 或 Apache 占用了 80 端口，需要先停止它们：

```bash
# 停止 Nginx
systemctl stop nginx
systemctl disable nginx

# 或停止 Apache
systemctl stop apache2
systemctl disable apache2
```

或者修改 `docker-compose.yml` 里 Caddy 的端口映射：

```yaml
caddy:
  ports:
    - "8080:80"    # 改成 8080
    - "8443:443"   # 改成 8443
```

### 登录提示"请先修改默认管理员密码"

说明 `ADMIN_PASSWORD` 还是默认值。修改 `.env` 文件中的密码，然后重启：

```bash
docker compose restart app
```

### 接口报 403 或"操作被拒绝"

通常是 `APP_URL` 和实际访问地址不一致。确保 `.env` 中的 `APP_URL` 与浏览器地址栏的地址完全匹配（包括协议和端口）。

### 容器启动失败

```bash
# 查看错误信息
docker compose logs app

# 常见原因：
# 1. .env 文件格式错误（多了空格或换行）
# 2. 数据库文件权限问题
# 3. 端口被占用
```

### 数据库文件权限问题

如果看到 `SQLITE_CANTOPEN` 错误：

```bash
# 确保 data 目录可写
chmod -R 777 /opt/taskcheck/data
```

---

## 10. 从 Cloudflare D1 迁移数据

如果你之前用的是 Cloudflare Pages + D1 部署，想迁移到 Docker，请参考项目中的 `VPS_MIGRATION.md` 文件。简要步骤：

### 10.1 导出 D1 数据

在你本地电脑（有 wrangler 的环境）执行：

```bash
npx wrangler d1 export kids_task_checkin --remote --output=backups/d1-final.sql
```

### 10.2 上传到服务器

```bash
scp backups/d1-final.sql root@你的服务器IP:/opt/taskcheck/backups/
```

### 10.3 导入到 SQLite

```bash
cd /opt/taskcheck

# 构建镜像
docker compose build

# 停止服务（如果已启动）
docker compose down

# 导入数据
docker compose run --rm app sh -c "sqlite3 /app/data/taskcheck.sqlite < /app/backups/d1-final.sql"

# 标记迁移已完成（因为 D1 导出的已经是最新 schema）
docker compose run --rm app npm run db:stamp:sqlite

# 验证数据
docker compose run --rm app npm run db:verify:sqlite

# 启动服务
docker compose up -d
```

---

## 快速命令速查

| 操作 | 命令 |
|------|------|
| 首次部署 | `docker compose build && docker compose run --rm app npm run db:migrate:sqlite && docker compose up -d` |
| 查看状态 | `docker compose ps` |
| 查看日志 | `docker compose logs -f app` |
| 重启 | `docker compose restart` |
| 停止 | `docker compose down` |
| 更新代码 | `git pull && docker compose build && docker compose up -d` |
| 执行迁移 | `docker compose run --rm app npm run db:migrate:sqlite` |
| 手动备份 | `docker compose exec app sqlite3 /app/data/taskcheck.sqlite ".backup '/app/data/backup.sqlite'"` |
| 验证数据库 | `docker compose run --rm app npm run db:verify:sqlite` |
