# Docker Deployment

## Stack

| Service | Image | Notes |
|---|---|---|
| frontend | `talking-text-frontend` | Next.js 16, standalone output, Node 22 alpine |
| backend | `talking-text-backend` | FastAPI, Python 3.12 alpine |
| postgres | `postgres:16-alpine` | Primary DB; data volume-mounted |
| redis | `redis:7-alpine` | Session cache |

> [!NOTE]
> **Nginx** is managed by the shared `stillume-nginx` stack. It terminates SSL and proxies requests to this stack via the `stillume-net` external Docker network.

---

## Request Routing

```
Browser → Shared nginx (80 / 443)
  /api/*      → backend:8000/          (strip /api prefix)
  /nex-api/*  → frontend:3000          (path preserved, Next.js API routes)
  /*          → frontend:3000          (Next.js pages)

Next.js server → http://backend:8000   (Docker internal network, no nginx)
```

Key: `/api/` is FastAPI. `/nex-api/` is Next.js API routes (e.g. the SSE streaming proxy). All server-side backend calls bypass nginx entirely via the Docker network.

---

## Image Strategy

Two-layer build to minimize rebuild time:

```
Dockerfile.base   deps only — rebuild only when pyproject.toml / pnpm-lock.yaml change
Dockerfile        FROM base + code — rebuild on every code change (fast)
```

Both Dockerfiles live in `backend/docker/` and `frontend/docker/`.

**Image names** (in Aliyun registry):
- `{REGISTRY}/{NS}/talking-text-backend-base:latest`
- `{REGISTRY}/{NS}/talking-text-frontend-base:latest`
- `{REGISTRY}/{NS}/talking-text-backend:{git-sha}`
- `{REGISTRY}/{NS}/talking-text-frontend:{git-sha}`

---

## China Mirrors

| Layer | Mirror |
|---|---|
| Alpine apk | `mirrors.aliyun.com` (sed replace in Dockerfile) |
| pip | `mirrors.aliyun.com/pypi/simple/` (`backend/docker/pip.conf`) |
| pnpm | `registry.npmmirror.com` (set in Dockerfile.base) |
| Docker Hub base images | `ARG ALIYUN_REGISTRY=docker.io` — pass registry host at build time |

---

## Directory Layout

```
backend/
  docker/
    Dockerfile.base   # Python 3.12-alpine + all pip deps (via poetry export)
    Dockerfile        # FROM base + app code + alembic + uvicorn
    pip.conf          # aliyun PyPI mirror

frontend/
  docker/
    Dockerfile.base   # Node 22-alpine + pnpm install
    Dockerfile        # FROM base + next build → standalone runner

nginx/
  local.conf              # local HTTP-only config (for docker-compose.yml)

docker-compose.yml          # local integration test (includes local nginx)
docker-compose-remote.yml   # production (no nginx)

scripts/
  build-base.sh   # build + push base images  (--local flag for local tagging)
  build.sh        # build + push app images
  deploy.sh       # build + push + SSH deploy  (--skip-build to skip build)
```

---

## Environment Files

| File | Where | Contents | In git? |
|---|---|---|---|
| `.env.deploy` | local machine | registry, server host, domain, postgres password | No |
| `backend/.env` | local machine | app secrets for local Docker testing | No |
| `.env` | server | compose vars written by deploy script | No |
| `.env.app` | server | app secrets (API keys, session secret, etc.) — created manually | No |

`.env.deploy` is created from `.env.deploy.example`.

`.env.app` on the server mirrors `backend/.env.example`. The key override: `DATABASE_URL` must point to `postgres` (the Docker service name), not `localhost`.

---

## Persistent Volumes

| Data | Local path (server) | Container path |
|---|---|---|
| PostgreSQL data | `./data/postgres` | `/var/lib/postgresql/data` |
| Audio files | `./data/audio` | `/app/storage/audio` |

---

## Database Initialization & Migration

PostgreSQL auto-creates the database and user on first start from `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` env vars (only when the data volume is empty).

`alembic upgrade head` runs automatically inside the backend container on every startup — idempotent, safe to re-run.

The backend `depends_on` postgres with `condition: service_healthy` (pg_isready check) so migrations never race the DB startup.

---

## Commands

```bash
# First-time setup
cp .env.deploy.example .env.deploy      # fill in registry, server, domain
just docker-base                        # build + push base images to Aliyun

# On the server (once)
scp backend/.env.example stillume:/opt/apps/talking-text/.env.app
ssh stillume "vim /opt/apps/talking-text/.env.app"   # fill in secrets

# Deploy
just docker-deploy                      # build + push + deploy
just docker-deploy-only                 # deploy only (skip build)
just docker-build                       # build + push without deploying
just docker-base                        # rebuild base images (when deps change)

# Local integration test
just docker-base-local                  # build base images with :local tag
cp backend/.env.example backend/.env
docker compose up --build

# Runtime management
docker compose ps
docker compose logs -f backend
docker compose exec backend alembic current
docker compose exec backend alembic upgrade head
docker compose down          # stop (keep volumes)
docker compose down -v       # stop + delete volumes
```

---

## Network Configuration

Production deployment requires the `stillume-net` external network:
```bash
docker network create stillume-net
```
This network allows the shared `stillume-nginx` container to reach the `frontend` and `backend` services.
