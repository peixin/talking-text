# talking-text — 项目任务入口
# 用法：just <recipe>；直接敲 `just` 查看所有命令

set shell := ["bash", "-cu"]

# 默认显示命令清单
default:
    @just --list

# ───── 开发 ─────

# 同时起后端和前端（Ctrl+C 一起退）
dev:
    #!/usr/bin/env bash
    set -e
    trap 'kill 0' SIGINT SIGTERM EXIT
    (cd backend && poetry run uvicorn app.main:app --reload --port 8000) &
    (cd frontend && pnpm dev) &
    wait

# 只起后端
api:
    cd backend && poetry run uvicorn app.main:app --reload --port 8000

# 只起前端
web:
    cd frontend && pnpm dev

# ───── 透传命令（便于在根目录随意调用两边工具）─────

# 在 backend/ 里跑任意 poetry 命令：just be run python scripts/xxx.py
be *args:
    cd backend && poetry {{args}}

# 在 frontend/ 里跑任意 pnpm 命令：just fe add react-query
fe *args:
    cd frontend && pnpm {{args}}

# ───── 安装 ─────

install:
    cd backend && poetry install
    cd frontend && pnpm install
    lefthook install

# ───── 质量 ─────

test:
    cd backend && poetry run pytest

lint:
    cd backend && poetry run ruff check .
    cd frontend && pnpm lint

fmt:
    cd backend && poetry run ruff format .
    cd frontend && pnpm format

typecheck:
    cd backend && poetry run mypy app
    cd frontend && pnpm typecheck

# 同时跑 lint + typecheck + format 检查（提交前自检）
check:
    cd backend && poetry run ruff check . && poetry run ruff format --check .
    cd frontend && pnpm lint && pnpm format:check && pnpm typecheck

# ───── 数据库迁移 ─────

# 新建 migration（自动 diff 当前 metadata 与 DB 差异）
# 用法：just migrate "add users table"
migrate msg:
    cd backend && poetry run alembic revision --autogenerate -m "{{msg}}"

# 升到最新
db-up:
    cd backend && poetry run alembic upgrade head

# 回滚一格
db-down:
    cd backend && poetry run alembic downgrade -1

# 查看当前 revision
db-current:
    cd backend && poetry run alembic current

# 查看历史
db-history:
    cd backend && poetry run alembic history
