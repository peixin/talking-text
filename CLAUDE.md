# CLAUDE.md — Project Collaboration Guide

> Auto-loaded at the start of every Claude Code session.
> Product philosophy: [`docs/product.md`](docs/product.md)
> Architecture: [`docs/architecture.md`](docs/architecture.md)
> Chinese version: [`CLAUDE.cn.md`](CLAUDE.cn.md)

---

## Project Overview

**Talking Text (字有天地)** — A Web app for children to practice English speaking.

**Core mechanism:** Feed the child's textbook (vocab, sentence patterns, texts, grammar, syllabus) into an LLM, and let the LLM chat with the child within "learned scope + ~10% stretch vocab." Voice pipeline: STT → LLM → TTS — batch in V1, streaming in V2.

**Philosophy:** Wittgenstein's "limits of language are limits of world" × Yu Guangzhong's tribute to Li Bai "one breath from an embroidered mouth, and half the Tang Dynasty spills forth" — don't make the child hit the boundary; let them speak from the center of their own world and push the boundary outward, one inch at a time.

**Target users:** Elementary school English learners (and parents who want to learn too).

**Deployment:** Mainland China — no dependency on any blocked service.

**Billing model:** Token consumption. A parent Account can have N Learners, each independent.

---

## Tech Stack (quick reference)

| Layer | Choice |
|---|---|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2.0 (async) + asyncpg |
| Frontend | Next.js 16 App Router (**full Next paradigm, not SPA**) + React 19.2 |
| UI | Tailwind CSS v4 + shadcn/ui (Radix primitives) + lucide-react |
| Voice + LLM | Volcengine Ark full stack (STT + Doubao + TTS) |
| Primary DB | PostgreSQL 16 |
| Cache | Redis |
| Object storage | Volcengine TOS |
| Package mgmt | backend: Poetry · frontend: pnpm |
| DB migrations | Alembic (async template) |
| Lint/Format (Py) | Ruff |
| Type check (Py) | mypy |
| Lint (TS) | ESLint 9 + eslint-config-next 16 (Flat Config) |
| Format (TS/CSS) | Prettier + prettier-plugin-tailwindcss |
| Git hooks | lefthook |
| Commit format | commitlint + Conventional Commits |
| Task runner | root `justfile` |
| Containerization | **Deferred to V1 release** |

---

## Repo Layout

```
talking-text/
├── backend/                   # Python FastAPI
│   ├── app/
│   │   ├── api/               # HTTP layer
│   │   ├── core/              # Business logic (zero external SDK deps)
│   │   │   ├── scope/         # Scope Computer
│   │   │   ├── prompt/        # Prompt assembly + boundary check
│   │   │   ├── dialog/        # Single-turn orchestration
│   │   │   └── mastery/       # V2: mastery tracker (V1 stub)
│   │   ├── adapters/          # External service adapters (STT/LLM/TTS)
│   │   ├── curriculum/        # Curriculum ingestion pipeline
│   │   └── storage/           # DB (Base metadata + SQLA models)
│   ├── alembic/               # DB migrations
│   ├── alembic.ini
│   ├── pyproject.toml
│   └── .env.example
├── frontend/                  # Next.js 16 (app/ directory)
│   ├── app/
│   │   ├── [locale]/          # Localized routes (zh-CN, zh-TW, en)
│   │   │   ├── layout.tsx     # Localized root layout
│   │   │   ├── page.tsx       # Landing page (Server Component)
│   │   │   ├── login/         # Login
│   │   │   └── (app)/         # Authenticated route group (chat, parent)
│   │   ├── favicon.ico
│   │   └── globals.css
│   ├── i18n/                  # next-intl configuration
│   │   ├── messages/          # Locale JSON files (zh-CN.json, etc.)
│   │   ├── request.ts         # next-intl server config
│   │   └── routing.ts         # Shared routing config (Link, redirect)
│   ├── components/            # Shared components (LocaleSwitcher, etc.)
│   │   └── ui/                # shadcn components (auto-generated)
│   ├── lib/
│   │   ├── backend.ts         # server-only Python backend client
│   │   └── utils.ts           # shadcn cn() helper
│   ├── proxy.ts               # Auth & i18n middleware (Next.js 16)
│   ├── eslint.config.mjs
│   ├── .prettierrc.json
│   ├── commitlint.config.mjs
│   └── package.json
├── docs/
│   ├── product.md / product.cn.md
│   ├── architecture.md / architecture.cn.md
│   ├── tech-stack.md / tech-stack.cn.md
│   └── session-log.md / session-log.cn.md
├── lefthook.yml               # Git hooks
├── justfile                   # Task runner
├── README.md / README.cn.md
└── CLAUDE.md / CLAUDE.cn.md   # This file
```

---

## Eight Architecture Rules (ask before breaking)

### 1. Adapter Pattern is non-negotiable

STT / LLM / TTS vendors will change. **All external SDK calls must live in `backend/app/adapters/`**. Business logic (`core/`) depends only on Protocols. Never put third-party calls in `core/`.

### 2. Scope Computer is the product's soul

Before every conversation turn, Scope Computer must be asked: "Which words are allowed this turn?"

- **Interface is frozen at V1** — no breaking changes allowed
- V1: returns all words the learner has studied; stretch is empty
- V2: adds next-unit words as stretch
- V3: integrates mastery tracker for dynamic adjustment

See `docs/architecture.md` §5 for the full interface.

### 3. VocabEvents: write in V1, read in V2

Every turn writes `vocab_event` (which word the AI used / the child used / the child asked about).

**V1 doesn't read these — but must write every turn.** Reason: V2's mastery tracker has no other training data source. Skip V1 writes → V2 starts from zero → 6 months of data lost.

### 4. Voice pipeline: batch in V1, designed for streaming

- V1: HTTP batch
- V2: WebSocket streaming
- **Both `invoke()` and `stream()` methods must be exposed on the Adapter interface from V1**

### 5. Account vs Learner model

- **Account** = login + billing entity (one per family)
- **Learner** = study profile (one per person; parents who want to learn are also Learners)
- Business logic (Scope Computer, mastery tracker) operates at the Learner level only

### 6. Frontend: Full Next.js + Internationalization

- **Default to Server Component**
- Client Component only where interaction is required; **add `Client` suffix**
- Server Actions for forms; **return Error Codes** (e.g. `AUTH_INVALID_CREDENTIALS`) instead of raw messages
- **Internationalization (i18n):**
  - Use `next-intl` with the `[locale]` dynamic segment
  - All labels/messages must live in `i18n/messages/*.json`
  - Use `Link`, `redirect`, `useRouter`, `usePathname` from `@/i18n/routing` (localized versions)
  - Backend errors are translated in the UI via these dictionaries
- **Auth and i18n Middleware:** Use `proxy.ts` (Next.js 16 naming)
- **No Next API Routes** — backend is a separate Python service
- **All backend calls must go through `lib/backend.ts` (`server-only`)**
- **Auth and session cookie logic lives exclusively in Server Actions**
- This pattern keeps the Python backend URL and API structure invisible to the browser.

### 7. Curriculum data follows a canonical schema

All external input (text / PDF / image / MP3) must be converted to the internal `Curriculum → Unit → (articles, vocab, grammar_points, objectives, key_points)` structure. Conversion is done by LLM (structured extraction); parent review is the source of truth.

### 8. No Docker in V1 — but code must be Docker-ready

Deferring Docker ≠ writing Docker-hostile code. These rules apply from day one:

- All config via environment variables or config files (DB URL, API keys, ports, etc.)
- Logs to stdout/stderr — no fixed-path local log files
- No `__file__`-relative paths for loading runtime resources
- Audio temp files use `tempfile` or go straight to TOS
- No filesystem preconditions at startup (e.g., "data/ directory must exist")

**Goal: add Dockerfile + docker-compose once at release time, no regrets.**

---

## Next.js 16 Breaking Changes

1. **`middleware.ts` → `proxy.ts`** — function also renamed from `middleware` to `proxy`; edge runtime no longer supported
2. **Async Request APIs** — `cookies()` / `headers()` / `params` / `searchParams` are all Promises; must `await`
3. **Turbopack by default** — no `--turbopack` flag needed
4. **`next lint` removed** — use ESLint CLI (`pnpm lint` already configured)
5. **`next/legacy/image` deprecated** — use `next/image` only
6. **`serverRuntimeConfig` / `publicRuntimeConfig` removed** — use env vars + `NEXT_PUBLIC_` prefix

When something doesn't match your mental model of Next.js, read `frontend/node_modules/next/dist/docs/01-app/` for the relevant section before touching anything.

---

## End-to-end flow — one conversation turn (V1)

```
Child presses record →
  Frontend MediaRecorder captures (batch) →
  POST /conversation/turn (audio blob) →
  Volcengine STT (batch) → text →
  Scope Computer → allowed vocab for this turn →
  Prompt Assembler → full prompt →
  Doubao LLM (batch) → reply text →
  Boundary check (out-of-scope → retry once) →
  Write Turn + VocabEvent to DB →
  Volcengine TTS (batch) → audio URL →
  Return {text, audio_url} →
  Frontend shows text + plays audio
```

Full sequence diagram (incl. V2 streaming) in `docs/architecture.md` §6.

---

## Command Reference

```bash
# Setup
just install          # install backend + frontend deps + lefthook install

# Daily dev
just dev              # start backend + frontend together
just api              # backend only (http://localhost:8000)
just web              # frontend only (http://localhost:3000)

# Pass-through
just be run <cmd>     # run poetry command in backend/
just fe <cmd>         # run pnpm command in frontend/

# Quality
just lint             # ruff check + pnpm lint
just fmt              # ruff format + pnpm format
just typecheck        # mypy + tsc --noEmit
just check            # read-only version of the above three (pre-commit check)
just test

# DB migrations (Alembic)
just migrate "<msg>"  # alembic revision --autogenerate -m "..."
just db-up            # upgrade head
just db-down          # downgrade -1
just db-current       # show current revision
just db-history
```

---

## Code Conventions

### Language policy

- **Pure English project:** all code, comments, naming, configuration, documentation, and runtime prompts must be written in English — no exceptions
- **Docs file convention:** each doc has two versions — default file (`xxx.md`) in English; Chinese translation in `xxx.cn.md`

### Python
- **3.12+** with full type annotations (all function signatures + public attributes)
- **Async-first:** all FastAPI routes are `async def`; DB uses asyncpg + SQLAlchemy async
- **Pydantic v2** for data validation
- **Ruff** for lint + format (config in `backend/pyproject.toml` under `[tool.ruff]`)
- **mypy** for type checking
- Module organization: interface first, implementation below, private last
- SQLAlchemy 2.0 style: `Mapped[T]` + `mapped_column()` + `select().where()` — not the old `Column()` / `session.query()`
- **Every Model must inherit `TimestampMixin`** — never hand-write `created_at` / `updated_at` on a model

### TypeScript / React
- **Strict mode** (`strict: true`)
- **Internationalization:**
  - Standard: `next-intl`
  - Storage: `i18n/messages/{en,zh-CN,zh-TW}.json`
  - Logic: Grouped in `i18n/` root folder
  - Always use `routing.ts` helpers for navigation
- **Components:** PascalCase filenames; Server Component has no suffix; Client Component has `Client` suffix (e.g. `ChatClient.tsx`)
- **Pages** follow Next.js conventions (`[locale]/page.tsx`, `actions.ts`, `proxy.ts`)
- **No `useEffect` / `useState` in Server Components**
- **Styling:** Tailwind v4 utility classes; use shadcn for complex components
- `components/ui/` is shadcn-managed — only change styles, never the structural logic

### Commit format (Conventional Commits, enforced by commitlint)

Format: `<type>(<scope>): <subject>`

| type | when |
|---|---|
| `feat` | new feature |
| `fix` | bug fix |
| `refactor` | refactor (no behavior change) |
| `chore` | maintenance (deps, build, tooling) |
| `docs` | documentation |
| `test` | tests |
| `style` | formatting only |
| `perf` | performance |

- Subject line ≤ 100 characters
- English or Chinese both fine
- No emoji, no "🤖 Generated" co-author trailers

---

## Configuration Layering

Two layers of config — never mix them:

| Layer | File | What goes here | In git? |
|---|---|---|---|
| **Env config** | `.env` (loaded by pydantic-settings) | Secrets, infra URLs, ports | ❌ No (gitignored) |
| **Business config** | `backend/config.toml` (loaded by `app/app_config.py`) | Tunable business params | ✅ Yes |

**Env config examples:** `DATABASE_URL`, `SESSION_SECRET`, `VOLC_API_KEY`, `DEBUG`

**Business config examples:** `session_max_age_days`, `max_login_attempts`, `llm_temperature`, `max_tokens`

Rules:
- Adding a new business-logic parameter → `config.toml` + `AppConfig` dataclass
- Adding a new secret or infra address → `.env` + `Settings` field + `.env.example` entry
- Never put secrets in `config.toml`; never put business params in `.env`

---

## Database Design Principles

1. **Every table must have `created_at` and `updated_at`**
   - Injected via `TimestampMixin` (`app/storage/base.py`); all Models must inherit it
   - `created_at`: auto-set by the DB at insert time (`server_default=now()`); never written by application code
   - `updated_at`: auto-refreshed by the DB on every update (`onupdate=now()`); never written by application code
   - Both columns must be declared explicitly in Alembic migrations (`server_default=sa.text("now()")`)

2. **Primary keys are always UUID** (`uuid.uuid4`, generated in the application layer) — no auto-increment integers

3. **Every foreign key must declare cascade behavior** (`ondelete="CASCADE"` or `ondelete="RESTRICT"`) — never leave it implicit

4. **Column lengths must reflect their business meaning** (e.g. `String(254)` = max email length, `String(72)` = bcrypt hash length)

5. **Add indexes only when driven by queries** — use `unique=True` for uniqueness constraints and `index=True` for filtered lookups; avoid over-indexing

---

## Collaboration Rules

1. **No git operations** — all `git add / commit / push` etc. are the user's responsibility; AI must not trigger them
2. **Verification is user-initiated** — after completing a feature segment, the user starts the service and reports results back; AI must not run the service unless explicitly told to
3. **DB schema changes require user confirmation first** — for any new table, new/modified column, or index change, AI must present the proposed schema for discussion and get explicit approval before writing code or migration files

---

## Known Constraints

- **No blocked services:** Vercel, OpenAI, Claude API, Supabase, Google Fonts (Chinese) — all off limits
- **Child privacy (no compliance in V1, but self-disciplined):**
  - No national ID numbers / home addresses stored
  - Audio goes to Volcengine TOS only (domestic), never leaves China
  - COPPA / PIPL compliance before any public launch
- **Explicitly deferred (do not implement now):**
  - Docker
  - PDF / image / MP3 curriculum import (V1 text paste only)
  - Streaming voice pipeline
  - SMS / WeChat login
  - Scope Computer V2/V3 logic (V1 is a stub)

---

## Starting a New Task

1. **Read `docs/architecture.md`** to confirm which layer the task belongs to (api / core / adapters / storage / frontend)
2. **Interface first:** write the Protocol / Pydantic schema / Mapped model before the implementation
3. **Write in the right place:** pure business logic → `core/`, SDK calls → `adapters/`, HTTP → `api/`, DB → `storage/`
4. **After changing the DB schema:** `just migrate "<msg>"`, review the file, then `just db-up`
5. **Before committing:** `just check`
6. **Don't optimize early:** correctness first, performance after a real bottleneck appears

---

## Current Progress

**Done (scaffold + DX + Core Auth):**
- ✅ Backend skeleton (`app/{api,core,adapters,curriculum,storage}` tree + `/health`)
- ✅ Frontend skeleton (Next.js 16 App Router + localized routes)
- ✅ Internationalization (next-intl, 3 languages, LocaleSwitcher)
- ✅ Account system (PostgreSQL models + FastAPI endpoints + session cookies)
- ✅ `proxy.ts` auth & i18n middleware (Next.js 16 naming)
- ✅ Tailwind v4 + shadcn/ui initialized
- ✅ Alembic async template, DB connected
- ✅ ESLint 9 + Prettier + prettier-plugin-tailwindcss
- ✅ Ruff + mypy (backend)
- ✅ lefthook + commitlint (Conventional Commits)
- ✅ justfile full recipe set
- ✅ PostgreSQL 16 + Redis local

**Next TODO (priority order):**
- [ ] Volcengine Ark LLM adapter (get `invoke()` batch working first)
- [ ] Curriculum ingestion MVP (paste text → LLM extract → human review → DB)
- [ ] Scope Computer V1 stub + Prompt assembly + boundary check
- [ ] Conversation API (`POST /conversation/turn`)
- [ ] First-party textbook data (Tot Talk series — user to provide materials)
