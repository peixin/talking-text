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
│   │   ├── layout.tsx         # Root layout (Server Component)
│   │   ├── page.tsx           # Landing page (Server Component, force-dynamic)
│   │   ├── login/             # Login (Server Component + Server Action)
│   │   └── (app)/             # Authenticated route group
│   ├── components/ui/         # shadcn components (auto-generated, don't edit logic)
│   ├── lib/
│   │   ├── backend.ts         # server-only Python backend client
│   │   └── utils.ts           # shadcn cn() helper
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

### 6. Frontend: full Next.js paradigm, not SPA

- **Default to Server Component**
- Client Component only where interaction is required (audio controls on chat page); **add `Client` suffix** (e.g. `ChatClient.tsx`)
- Server Actions for forms (login, curriculum upload)
- **Use `proxy.ts` for auth (renamed from `middleware.ts` in Next.js 16)**
- **No Next API Routes** — backend is a separate Python service
- Backend calls go through `lib/backend.ts` (`server-only`); Client Components must not fetch the backend directly

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

### TypeScript / React
- **Strict mode** (`strict: true`)
- **Components:** PascalCase filenames; Server Component has no suffix; Client Component has `Client` suffix (e.g. `ChatClient.tsx`)
- **Pages** follow Next.js conventions (`page.tsx` / `layout.tsx` / `actions.ts` / `proxy.ts`)
- **No `useEffect` / `useState` in Server Components**
- **Styling:** Tailwind v4 utility classes; use shadcn for complex components (`pnpm dlx shadcn@latest add <component>`)
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
- No emoji, no "🤖 Generated" co-author trailers (unless explicitly requested)

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

1. **Read `docs/architecture.md`** (or the relevant section) to confirm which layer the task belongs to (api / core / adapters / storage / frontend)
2. **Interface first:** write the Protocol / Pydantic schema / Mapped model before the implementation
3. **Write in the right place:**
   - Pure business logic → `core/`
   - External SDK calls → `adapters/`
   - HTTP routing → `api/`
   - DB models + queries → `storage/`
4. **After changing the DB schema:** `just migrate "<msg>"`, review the new file in `alembic/versions/`, then `just db-up`
5. **Event logging:** any vocab-related action — consider whether it needs a `vocab_event`
6. **Before committing:** `just check`
7. **Don't optimize early:** correctness first, performance after a real bottleneck appears

---

## Current Progress

**Done (scaffold + DX):**
- ✅ Backend skeleton (`app/{api,core,adapters,curriculum,storage}` tree + `/health`)
- ✅ Frontend skeleton (Next.js 16 App Router + landing + login/(app)/chat/parent stubs)
- ✅ Tailwind v4 + shadcn/ui initialized (vermillion primary `oklch(0.52 0.175 25)`)
- ✅ Alembic async template, DB connected
- ✅ ESLint 9 + Prettier + prettier-plugin-tailwindcss
- ✅ Ruff + mypy (backend)
- ✅ lefthook + commitlint (Conventional Commits)
- ✅ justfile full recipe set
- ✅ PostgreSQL 16 + Redis local, `talking_text` DB created

**Next TODO (priority order):**
- [ ] Account system (`storage/models/account.py`, `learner.py` + Alembic migration + `api/auth.py` + frontend login Server Action)
- [ ] `proxy.ts` auth (Next.js 16 naming)
- [ ] Volcengine Ark LLM adapter (get `invoke()` batch working first)
- [ ] Curriculum ingestion MVP (paste text → LLM extract → human review → DB)
- [ ] Scope Computer V1 stub + Prompt assembly + boundary check
- [ ] Conversation API (`POST /conversation/turn`)
- [ ] Frontend chat page MVP (hold-to-record → HTTP → play audio)
- [ ] Volcengine STT / TTS adapter
- [ ] First-party textbook data (Tot Talk series — user to provide materials)
