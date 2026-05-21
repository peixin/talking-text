# Docker 部署规范

## 服务栈 (Stack)

| 服务 | 镜像 | 说明 |
|---|---|---|
| frontend | `talking-text-frontend` | Next.js 16, 独立独立输出 (standalone), Node 22 alpine |
| backend | `talking-text-backend` | FastAPI, Python 3.12 alpine |
| postgres | `postgres:16-alpine` | 主数据库；通过挂载 volume 持久化存储数据 |
| redis | `redis:7-alpine` | 会话缓存与限流 |

> [!NOTE]
> **Nginx** 由共享的 `stillume-nginx` 服务栈统一管理。它负责 HTTPS 证书卸载 (SSL termination)，并通过外部 Docker 网络 `stillume-net` 反向代理流量到本应用服务栈中。

---

## 流量路由与转发 (Request Routing)

```
浏览器 → 共享 Nginx (80 / 443 端口)
  /api/*      → backend:8010/          (剥离 /api 前缀)
  /nex-api/*  → frontend:3000          (保留路径，Next.js API 路由)
  /*          → frontend:3000          (Next.js 页面)

Next.js 侧服务端渲染 → http://backend:8010   (走 Docker 内部虚拟网，绕过 Nginx 直接通信)
```

**关键：** `/api/` 路由由 FastAPI 处理。`/nex-api/` 则是 Next.js API 路由（例如 SSE 流式代理，在本地开发时用于解决 Cookie 跨域问题）。所有 Next.js 服务端渲染请求 (Server Components) 均通过 Docker 内部虚拟网络高速连接 Python 后端，绝不经过 Nginx 绕路。

---

## 镜像构建策略

采用“双层镜像”策略，最大程度节省代码变动时的构建时间：

```
Dockerfile.base   依赖安装层 — 只有在 pyproject.toml / pnpm-lock.yaml 发生改变时才重新构建（极慢，但极少变动）
Dockerfile        代码层 — 每次代码改动构建此层（基于 base 层，极快）
```

构建配置文件分别位于 `backend/docker/` 和 `frontend/docker/` 目录中。

**镜像命名** (托管于阿里云私有镜像仓)：
- `{REGISTRY}/{NS}/talking-text-backend-base:latest`
- `{REGISTRY}/{NS}/talking-text-frontend-base:latest`
- `{REGISTRY}/{NS}/talking-text-backend:{git-sha}`
- `{REGISTRY}/{NS}/talking-text-frontend:{git-sha}`

---

## 国内镜像源加速

| 构建层 | 加速源 |
|---|---|
| Alpine apk | 使用阿里源 `mirrors.aliyun.com`（在 Dockerfile 中通过 sed 命令全局替换） |
| pip | 使用阿里 PyPI 源 `mirrors.aliyun.com/pypi/simple/` （配置于 `backend/docker/pip.conf`） |
| pnpm | 使用国内 npm 淘宝源 `registry.npmmirror.com`（在 Dockerfile.base 中设置） |
| Docker Hub 基础镜像 | 引入 `ARG ALIYUN_REGISTRY=docker.io` 变量，在构建时可通过变量传入国内代理节点防止拉取超时 |

---

## 目录结构

```
backend/
  docker/
    Dockerfile.base   # Python 3.12-alpine + 所有通过 poetry 导出的依赖
    Dockerfile        # 基于 base 层 + 最新代码 + Alembic 迁移脚本 + Uvicorn 运行器
    pip.conf          # 阿里 PyPI 加速源

frontend/
  docker/
    Dockerfile.base   # Node 22-alpine + pnpm install 依赖
    Dockerfile        # 基于 base 层 + Next.js build 生成 standalone 运行目录

nginx/
  local.conf              # 本地集成测试使用的 HTTP Nginx 配置

docker-compose.yml          # 本地联调集成测试配置（包含本地 Nginx 代理）
docker-compose-remote.yml   # 远程生产环境部署配置（无内置 Nginx，连接 stillume-net）

scripts/
  build-base.sh   # 构建并推送 base 基础依赖镜像（支持 --local 标志仅在本地标记）
  build.sh        # 构建并推送应用代码镜像
  deploy.sh       # 构建、推送并通过 SSH 一键部署至远程服务器（支持 --skip-build 跳过构建）
```

---

## 环境变量配置文件说明

| 配置文件 | 使用场景 | 包含内容 | 是否提交 Git？ |
|---|---|---|---|
| `.env.deploy` | 本地部署机 | 镜像仓库地址、服务器 IP、域名、PostgreSQL 密码 | 否 |
| `backend/.env` | 本地宿主机 | 本地开发联调或在本地运行容器测试时的环境变量配置 | 否 |
| `.env` | 生产服务器 | 部署脚本根据部署环境自动填充生成的 Compose 环境配置 | 否 |
| `.env.app` | 生产服务器 | 应用核心机密（LLM 密钥、STT/TTS API 密钥、Session 密钥等）— 手动建立 | 否 |

`.env.deploy` 应当通过复制并重命名 `.env.deploy.example` 建立。

服务器上的 `.env.app` 内容和 `backend/.env.example` 保持一致。唯一的关键区别在于：生产环境中 `DATABASE_URL` 的连接 Host 必须指向 `postgres`（即 Docker Compose 服务名），而非 `localhost`。

---

## 持久化卷挂载 (Persistent Volumes)

| 数据类型 | 服务器物理路径 | 容器内挂载路径 |
|---|---|---|
| PostgreSQL 数据库文件 | `./data/postgres` | `/var/lib/postgresql/data` |
| 音频存储目录 | `./data/audio` | `/app/storage/audio` |

---

## 数据库自动初始化与迁移

1. 只有在挂载的数据卷为空时，PostgreSQL 容器才会根据 `.env` 中定义的 `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` 自动初始化数据库和对应权限角色。
2. 每次后端容器启动时，都会在入口处自动运行 `alembic upgrade head`，该命令是幂等的，多次运行非常安全，能确保生产环境数据库 Schema 永远最新。
3. 后端服务配置了 `depends_on: postgres: condition: service_healthy`（依靠 `pg_isready` 进行健康检查），从而确保 Alembic 迁移脚本绝不会在 PG 数据库未就绪前抢先运行导致崩溃。

---

## 常用运维命令

```bash
# 首次部署配置
cp .env.deploy.example .env.deploy      # 填入阿里云镜像仓地址、服务器 IP 和域名
just docker-base                        # 构建 base 镜像并推送到云端

# 在服务器上执行（仅一次）
scp backend/.env.example stillume:/opt/apps/talking-text/.env.app
ssh stillume "vim /opt/apps/talking-text/.env.app"   # 填入大模型密钥和 API 密钥

# 一键部署与构建
just docker-deploy                      # 全流程一键打包并发布到生产服务器
just docker-deploy-only                 # 跳过本地构建，仅让服务器拉取最新镜像重启
just docker-build                       # 仅构建镜像并推送，不触发服务器发布
just docker-base                        # 重建基础依赖镜像 (仅当 dependencies 改变时运行)

# 本地容器化集成测试
just docker-base-local                  # 在本地构建打上 :local 标签的 base 镜像
cp backend/.env.example backend/.env
docker compose up --build

# 容器管理与诊断
docker compose ps
docker compose logs -f backend
docker compose exec backend alembic current
docker compose exec backend alembic upgrade head
docker compose down          # 停止运行（保留本地存储数据卷）
docker compose down -v       # 停止运行并彻底销毁所有本地数据卷（开发调试重置时使用）
```

---

## 网络配置要求

生产部署要求宿主机必须事先创建名为 `stillume-net` 的外部虚拟网络：
```bash
docker network create stillume-net
```
只有加入此网络，共享的 `stillume-nginx` 容器才能安全穿透容器壁，与我们的前端、后端容器顺畅连通。

---

## 通过 SSH 隧道安全连接生产数据库

出于极致的安全防范，生产环境中的 PostgreSQL 容器**绝不**向宿主机外映射任何 5432 物理端口，仅在 Docker 内部封闭网络中监听。

### 为什么不能直接 SSH 到 localhost 转发？
因为宿主机的 5432 端口并没开。要连上数据库，SSH 隧道必须直接定向到 Postgres 容器在 Docker 内部网络分配的虚拟虚拟 IP 地址。

### 具体连接步骤：

1. **获取 Postgres 容器的虚拟内部 IP**：
   在本地终端运行：
   ```bash
   ssh stillume "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' talking-text-postgres"
   # 输出示例：172.18.0.2
   ```

2. **建立 SSH 隧道映射**：
   将上述得到的 IP（如 `172.18.0.2`）代入下述命令中并在本地运行：
   ```bash
   ssh -L 5433:172.18.0.2:5432 stillume -N
   ```

3. **使用可视化客户端 (如 Navicat / DBeaver) 进行连接**：
   - **Host (主机)**: `localhost`
   - **Port (端口)**: `5433`
   - **User (用户名)**: `talking_text`
   - **Database (数据库)**: `talking_text`
   - **Password (密码)**: 服务器 `.env` 配置文件中定义的 `POSTGRES_PASSWORD` 值。
