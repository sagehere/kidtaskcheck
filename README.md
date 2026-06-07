# Kids Task Checkin 家庭任务打卡

这是一个自托管的家庭任务与积分奖励系统。家长可以创建任务、审核孩子提交的打卡、发放积分、设置奖励兑换；孩子可以完成任务、查看积分和兑换奖励。

本项目现在是 Docker 优先部署的 Node.js + React + SQLite 应用。

## 项目组成

- 前端：React 19 + Vite。
- 后端：Node.js HTTP 服务，入口文件是 `server/index.mjs`。
- API：`server/api`。
- 数据库：SQLite，默认保存在 `data/taskcheck.sqlite`。
- 定时任务：内置在 Node 服务中，设置 `ENABLE_BUILTIN_SCHEDULER=true` 后启用。
- Docker 镜像：`ghcr.io/sagehere/kidtaskcheck:latest`。

## 零基础 Docker 部署教程

下面的教程假设你已经有一台 Linux 服务器，并且已经安装好 Docker 和 Docker Compose。如果你使用的是宝塔、1Panel、Nginx Proxy Manager 等面板，也可以按这个流程理解：应用容器负责运行程序，反向代理负责把公网 HTTPS 域名转发到容器端口。

### 1. 准备一个部署目录

登录服务器后，先创建一个目录用来放配置文件和数据库。

```bash
mkdir -p /opt/stacks/taskcheck
cd /opt/stacks/taskcheck
```

以后所有部署、更新、备份命令都建议在这个目录里执行。

### 2. 创建 `docker-compose.yml`

在 `/opt/stacks/taskcheck` 目录里创建 `docker-compose.yml`，内容如下。

```yaml
services:
  app:
    image: ghcr.io/sagehere/kidtaskcheck:latest
    restart: unless-stopped
    ports:
      - "100:3000"
    environment:
      ENVIRONMENT: production
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change-me-admin-password
      APP_URL: https://your-domain.com
      DATABASE_PATH: /app/data/taskcheck.sqlite
      ENABLE_BUILTIN_SCHEDULER: "true"
    volumes:
      - ./data:/app/data
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 60s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. 修改必须修改的配置

第一次启动前，必须修改这些值。

| 配置项 | 是否必须修改 | 怎么填 |
|---|---|---|
| `ADMIN_PASSWORD` | 必须 | 改成一个强密码。不要使用 `change-me-admin-password`，生产模式会拒绝默认密码。 |
| `ADMIN_USERNAME` | 可选 | 管理员登录名，默认是 `admin`。 |
| `APP_URL` | 必须 | 改成你实际访问应用的 HTTPS 地址，例如 `https://kid.example.com`。必须和浏览器地址栏完全一致。 |
| `ports` | 按需 | 示例中的 `"100:3000"` 表示宿主机端口 `100` 转发到容器内部端口 `3000`。如果你的反向代理想转发到别的宿主机端口，就改左边的 `100`。 |

端口写法要特别注意：

- 左边的 `100` 是服务器宿主机端口，给反向代理访问。
- 右边的 `3000` 是容器内部端口，不要改，除非你非常清楚自己在做什么。
- 健康检查必须访问 `http://127.0.0.1:3000/healthz`，因为健康检查是在容器内部执行的，不能写宿主机端口 `100`。

### 4. 启动应用

在 `docker-compose.yml` 所在目录执行：

```bash
mkdir -p data
docker compose pull
docker compose up -d --force-recreate app
```

命令含义：

- `mkdir -p data`：创建数据库目录。
- `docker compose pull`：拉取最新镜像。
- `docker compose up -d --force-recreate app`：后台启动应用，并强制重建容器，让端口、健康检查等配置真正生效。

如果你的服务器提示没有 `docker compose`，但有 `docker-compose`，就把命令里的 `docker compose` 改成 `docker-compose`。

### 5. 检查是否启动成功

查看容器状态：

```bash
docker compose ps
```

正常情况下会看到类似：

```text
STATUS
Up ... (healthy)
```

如果刚启动，还可能短暂显示 `starting`，等待约 1 分钟再看。

检查应用日志：

```bash
docker compose logs --tail=80 app
```

检查健康检查配置是否正确：

```bash
docker inspect --format '{{json .Config.Healthcheck.Test}}' "$(docker compose ps -q app)"
```

输出里应该包含：

```text
http://127.0.0.1:3000/healthz
```

如果看到 `127.0.0.1:100/healthz`，说明健康检查写成了宿主机端口，这是错误的。改回 `127.0.0.1:3000/healthz` 后执行：

```bash
docker compose up -d --force-recreate app
```

### 6. 配置反向代理和 HTTPS

推荐用 Nginx Proxy Manager、1Panel 反向代理、宝塔反向代理或手写 Nginx，把公网域名转发到应用的宿主机端口。

如果你使用上面的默认端口 `"100:3000"`，反向代理应这样填：

- 协议：`http`
- 转发地址：`127.0.0.1`
- 转发端口：`100`
- 开启 HTTPS 证书
- 开启强制 HTTPS

然后把 `APP_URL` 设置成你的公网 HTTPS 地址，例如：

```yaml
APP_URL: https://kid.example.com
```

`APP_URL` 必须和浏览器地址栏完全一致。比如你实际访问的是 `https://kid.example.com`，就不要写成 `http://kid.example.com`、`https://www.kid.example.com` 或服务器 IP。

### 7. 更新应用

以后更新到最新镜像时，在部署目录执行：

```bash
docker compose pull
docker compose up -d --force-recreate app
```

建议始终带上 `--force-recreate app`。因为 Docker 会把健康检查、端口映射等配置保存到容器上，如果只重启旧容器，可能仍然使用旧配置。

### 8. 常见问题

容器显示 `unhealthy`，但网页能打开：

- 先检查健康检查是否写成了宿主机端口。
- 正确写法是 `http://127.0.0.1:3000/healthz`。
- 错误示例是 `http://127.0.0.1:100/healthz`。
- 改完后必须运行 `docker compose up -d --force-recreate app`。

### 9. Dockge 部署时的特别说明

如果你使用 Dockge 管理这个应用，要以 Dockge stack 目录里的配置为准。以本文示例为例，真实配置文件通常是：

```text
/opt/stacks/taskcheck/compose.yaml
```

注意：Dockge 页面里点“重启”不一定会重新创建容器。Docker 的健康检查是在容器创建时写入的配置，如果你以前把健康检查写成了 `127.0.0.1:100/healthz`，后来只在 Dockge 里改成 `127.0.0.1:3000/healthz` 并重启，旧容器可能仍然保留错误的健康检查。

在服务器上检查当前容器实际使用的健康检查：

```bash
cd /opt/stacks/taskcheck
docker inspect --format '{{json .Config.Healthcheck.Test}}' "$(docker compose ps -q app)"
```

如果输出里还是：

```text
http://127.0.0.1:100/healthz
```

说明 Dockge 没有重新创建容器，旧配置还在生效。请在 Dockge 里选择“重新部署 / Recreate / Force recreate”这类会重建容器的操作，不要只点 restart。

也可以在服务器命令行执行：

```bash
cd /opt/stacks/taskcheck
docker compose up -d --force-recreate app
```

如果仍然没有更新，就删除旧的 `app` 容器再创建。这里不会删除 `data` 目录，也不会删除数据库：

```bash
cd /opt/stacks/taskcheck
docker compose stop app
docker compose rm -f app
docker compose up -d app
```

然后再次确认健康检查已经变成容器内部端口：

```bash
docker inspect --format '{{json .Config.Healthcheck.Test}}' "$(docker compose ps -q app)"
docker compose ps
```

登录或接口请求失败：

- 检查 `APP_URL` 是否和浏览器地址栏完全一致。
- 检查是否已经启用 HTTPS。
- 检查浏览器访问地址是不是反向代理配置的域名。

容器启动失败：

- 检查 `ADMIN_PASSWORD` 是否仍是默认值 `change-me-admin-password`。
- 生产模式下默认密码会阻止启动，这是为了避免公网部署时使用弱密码。
- 查看日志：`docker compose logs --tail=120 app`。

## 数据备份

数据库保存在服务器部署目录的 `data/taskcheck.sqlite`。这个文件非常重要，丢失后任务、积分、奖励记录都会丢失。

运行中的应用可以用 SQLite 在线备份命令：

```bash
mkdir -p backups
docker compose exec app node -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/app/data/taskcheck.sqlite'); db.exec(\"VACUUM INTO '/app/data/backup.sqlite'\"); db.close();"
cp data/backup.sqlite backups/taskcheck-$(date +%F).sqlite
```

建议定期把 `backups` 目录复制到服务器外部保存。

不要把 `data/`、`backups/`、SQLite 数据库文件、日志文件提交到 Git。

## 数据库迁移修复

如果更新后日志反复出现这个错误：

```text
migration failed: 0002_limits_and_repeat_submissions.sql: duplicate column name: limit_count
```

意思是数据库表结构里已经有 `tasks.limit_count` 字段，但迁移记录表 `__vps_migrations` 缺少 `0002` 记录。不要直接删除数据库，除非你确定要清空所有本地数据。

先备份数据库：

```bash
mkdir -p backups
docker compose exec app node -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/app/data/taskcheck.sqlite'); db.exec(\"VACUUM INTO '/app/data/repair-before-0002.sqlite'\"); db.close();"
cp data/repair-before-0002.sqlite backups/taskcheck-repair-before-0002-$(date +%F-%H%M%S).sqlite
```

再运行修复脚本：

```bash
docker compose run --rm app npm run db:repair:0002
docker compose up -d --force-recreate app
docker compose logs --tail=80 app
```

这个脚本只处理已知的 `0002` 半迁移状态。如果它提示完整性错误或表结构不匹配，请停止操作，先恢复备份或人工检查数据库。

## 本地开发

如果你要在自己电脑上开发代码，而不是部署服务器，可以使用下面的命令。

```bash
npm install
npm run build
npm test
npm run db:migrate:sqlite
npm run server
```

默认本地服务端口是 `3000`。如需修改端口，可以设置 `PORT` 环境变量。

常用脚本：

```bash
npm run build
npm test
npm run server
ENABLE_BUILTIN_SCHEDULER=true npm run server
npm run db:repair:0002
```

## 安全注意事项

- 生产环境不要使用默认 `ADMIN_PASSWORD`。
- `APP_URL` 必须填写真实公网 HTTPS 地址。
- 积分余额来自 `point_ledger` 汇总，不要直接手动修改余额。
- 数据库迁移通常是追加式变更，不要随意删除历史业务表。
- 多家庭数据查询必须按 `parent_id` 隔离。
- 定期备份 `data/taskcheck.sqlite`。
