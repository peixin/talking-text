# CLAUDE.md — Project Collaboration Guide

> Auto-loaded at the start of every Claude Code session.
> Product philosophy: [`docs/product.md`](docs/product.md)
> Architecture: [`docs/architecture.md`](docs/architecture.md)
> Roadmap: [`docs/roadmap.md`](docs/roadmap.md)
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
| LLM | Multiple OpenAI-compatible vendors (DeepSeek / Doubao / Aliyun Qwen / Xiaomi MiMo) via one `OpenAICompatibleLLMAdapter`; per-stage model config |
| Voice (STT + TTS) | Volcengine Ark (STT + Tina TTS) |
| Primary DB | PostgreSQL 16 |
| Cache | Redis |
| Object storage | `BlobStorage` adapter — local disk in V1, cloud-pluggable (TOS/OSS/COS/Qiniu/MinIO) |
| Package mgmt | backend: Poetry · frontend: pnpm |
| DB migrations | Alembic (async template) |
| Lint/Format (Py) | Ruff |
| Type check (Py) | mypy |
| Lint (TS) | ESLint 9 + eslint-config-next 16 (Flat Config) |
| Format (TS/CSS) | Prettier + prettier-plugin-tailwindcss |
| Git hooks | lefthook |
| Commit format | commitlint + Conventional Commits |
| Task runner | root `justfile` |
| Containerization | `docker-compose.yml` for local full-stack integration tests; production deployment deferred to release |

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

- **Interface is frozen at V1** — no breaking changes allowed (additive fields OK)
- V1: returns all words the learner has studied; stretch is empty
- V2 (live): adds ~10% next-unit words as stretch, mastery-weighted (`core/scope/v2.py`, `docs/phase2-mastery-stretch.md`)
- V3: integrates mastery tracker for dynamic adjustment

See `docs/architecture.md` §5 for the full interface.

### 3. Word mastery: derive from Turn text, not a separate event table

`vocab_event` was removed (2026-04-30). Word frequency data is derivable from `turn.text_user` / `turn.text_ai` at any time via string splitting — it is not an independent source of truth.

**Resolved 2026-06-10** (`docs/phase2-mastery-stretch.md` Decision A): no `learner_word_stats` table. Item-level `learner_item_stats` covers mastery; the weekly report computes word diffs from turn text at read time. Do not re-introduce a per-word-per-turn event table, and do not materialize word stats until a real read-path bottleneck appears.

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

### 8. Code must be Docker-ready (compose exists for local integration tests only)

Daily development stays native (`just dev`); the root `docker-compose.yml` is a full-stack
integration test, not the dev loop and not production. These rules apply from day one:

- All config via environment variables or config files (DB URL, API keys, ports, etc.)
- Logs to stdout/stderr — no fixed-path local log files
- No `__file__`-relative paths for loading runtime resources
- Audio goes through the `BlobStorage` adapter (storage key, never an absolute path) — local disk in V1, cloud later
- No filesystem preconditions at startup (e.g., "data/ directory must exist")

**Goal: production container deployment lands at release time with no code changes.**

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
  POST /sessions/{session_id}/turns (audio blob) →
  Volcengine STT (batch) → text →
  Scope Computer → allowed vocab for this turn →
  Prompt Assembler → full prompt →
  Doubao LLM (batch) → reply text →
  Boundary check (out-of-scope → retry once) →
  Write Turn to DB (word data derived from turn text — see Rule #3, no event table) →
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
just api              # backend only (http://localhost:8010)
just web              # frontend only (http://localhost:3010)

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
- **Styling:** Tailwind v4 utility classes; use shadcn for complex components. Full component & style contract: [`docs/frontend-ui.md`](docs/frontend-ui.md)
- **Design tokens only — no raw palette classes.** Never use raw Tailwind palette colors (`bg-indigo-600`, `text-slate-500`, `border-amber-300`, …) in app code. Use semantic tokens exclusively: `primary` (brand/interactive), `muted` / `muted-foreground` / `border` / `foreground` (neutrals), `destructive` (errors/danger), `success` / `warning` (status). Tints via opacity modifiers (`bg-primary/10`, `border-success/30`), never via palette shades. New business-semantic colors are added as tokens in `globals.css` `@theme`, not inline
- **No `dark:` variants** — V1 has no dark mode; never write `dark:` classes outside shadcn-managed `components/ui/`
- **Component sourcing — library first, hand-write last.** Any standard UI pattern (button, dialog, popover, dropdown/select, tabs, tooltip, badge, switch, accordion, toast, …) must come from shadcn/ui. If the component isn't in `components/ui/` yet, add it via `pnpm dlx shadcn@latest add <name>` — never hand-write a parallel version of something the library already has. Restyling is done with tokens/className on the library component
- **Hand-written components are the exception, not the default** — reserved for product-specific UI with no library equivalent (record button, chat message bubble, tag-tree row). They are built from semantic tokens + existing primitives, and the moment a second page needs the same pattern, it is extracted into `components/` and reused — no copy-paste forks
- **Buttons specifically:** anything that *looks like* a button uses `<Button>` / `buttonVariants()`. A raw `<button>` tag is acceptable only when the element is a different visual species that merely needs to be clickable for HTML semantics/a11y (chips, tree rows, the record button) — wrapping those in `<Button>` would mean overriding all of its styles, which defeats the purpose. Visual-language consistency is the goal, not tag uniformity
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
  - Audio stays on domestic object storage only (whatever `BlobStorage` backend), never leaves China
  - COPPA / PIPL compliance before any public launch
- **Explicitly deferred (do not implement now):**
  - Production container deployment (local docker-compose integration test already exists)
  - PDF / image / MP3 curriculum import (V1 text paste only)
  - Streaming voice pipeline
  - SMS / WeChat login
  - Scope Computer V3 logic (V2 stretch shipped 2026-06-10; V3 = mastery-driven dynamic trimming)

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

**Done (Voice pipeline — 2026-04-30):**
- ✅ Volcengine STT adapter (`bigmodel_nostream` WebSocket, ogg/opus)
- ✅ Volcengine LLM adapter (Ark OpenAI-compatible, Doubao)
- ✅ Volcengine TTS adapter (HTTP Chunked, Tina 2.0 voice)
- ✅ `audio_codec.py` — webm → ogg re-mux via ffmpeg
- ✅ `POST /sessions/{session_id}/turns` API (multipart audio upload, base64 audio response)
- ✅ Chat UI — record / upload / playback (`ChatClient.tsx`)
- ✅ `Turn` model + Alembic migration — billing fields persisted per turn
- ✅ Stale session → graceful redirect to login (`lib/session.ts` + `proxy.ts ?expired=1`)

**Done (Session & audio improvements):**
- ✅ `Turn.sequence` — explicit integer ordering within a session (Alembic migration `c9e4f72a1d38`)
- ✅ Backend-managed conversation history — orchestrator queries `turn` by `sequence ASC`; `history` form field removed from API and frontend
- ✅ Audio addressed by backend-independent storage key (`{learner_id}/{session_id}/{turn_id}_{in|out}.ext`) via the `BlobStorage` adapter
- ✅ `GET /sessions/{session_id}/turns/{turn_id}/audio?dir=in|out` — authenticated audio endpoint (`FileResponse`)
- ✅ Chat UI — per-message play/stop buttons; lazy-load audio via Server Action; singleton `<audio>` element
- ✅ `TurnOut.has_audio_in` / `has_audio_out` — frontend knows which bubbles have playback

**Done (Adapter factory):**
- ✅ `config.toml [adapter]` — STT/TTS provider + per-stage LLM model selector (see overhaul below)
- ✅ `AdapterConfig` dataclass in `app/app_config.py`
- ✅ `app/adapters/factory.py` — reads config, creates shared singleton adapters + orchestrator
- ✅ `session.py` imports from factory; no direct vendor instantiation

**Done (Adapter-layer overhaul — 2026-06-05, see `docs/2026-06-05-dev-log.md`):**
- ✅ **`BlobStorage` abstraction** (`app/adapters/storage/`) — `put/get/exists/delete/url`; `LocalBlobStorage` (V1) + cloud-pluggable. DB stores a backend-independent **storage key**, not a path. `core` no longer touches `pathlib`/`AUDIO_STORAGE_DIR`.
- ✅ **LLM role protocols** — fat `LLMAdapter` split into `TextLLM` + `MultimodalLLM` (interface segregation); `invoke_vision` gone (images are `ImagePart` content parts). One `OpenAICompatibleLLMAdapter` collapses `VolcLLMAdapter`+`DeepSeekLLMAdapter`; Aliyun + Xiaomi added. Vendors = config + a factory `case`, no new class.
- ✅ **Per-stage model config** (`[adapter.stage.*]`) — `chat` (cheap, high-volume) vs `extraction` (multimodal) wired independently; capability validated at startup (fail fast).
- ✅ **Two-stage extraction prototype** (`[adapter.ingest] extraction_mode = single|two_stage`) — `two_stage` = perception (VLM layout-aware transcription) → structuring (`deepseek-v4-pro`, single text brain). For A/B on real textbook pages.

**Done (Scope Computer V1 + Prompt assembler):**
- ✅ `core/scope/v1.py` — three modes (group / calibration / free); group mode pulls items from the session's group + descendants
- ✅ `core/prompt/assembler.py` — pure function assembling Tina persona + calibration / level hint / vocab scope / patterns / nudges (covered by `tests/test_prompt_assembler.py`)

**Done (Curriculum ingestion + Content lifecycle — 2026-05-30):**
- ✅ Ingestion MVP — `POST /ingest/extract` (image/text/voice → LLM structured items), parent review drawer, transactional save
- ✅ **Capture/Canonical split** (`docs/content-lifecycle.md`): extraction no longer infers hierarchy; capture produces a flat bag; structuring is a deliberate `tag_path` action. See `docs/2026-05-30-dev-log.md`
- ✅ `_assemble_tag_path` — deterministic, organize-time tree assembly (nodes are untyped `kind="tag"`); `tests/test_ingest_extraction.py` locks the extraction contract

**Done (Phase 2 — mastery + stretch, 2026-06-10, see `docs/phase2-mastery-stretch.md`):**
- ✅ Scope Computer V2 (`core/scope/v2.py`) — stretch = ~10% next-unit words, mastery-weighted (glimpsed-but-unmastered first), session-seeded rotation; `[scope]` budgets in `config.toml`
- ✅ `item_group.position` (nullable, migration `8f2d4b7c1a90`) — sibling order `(position NULLS LAST, natural-sort(name))` via `core/scope/siblings.py`
- ✅ Prompt assembler stretch section — new-word escape hatch now points at the stretch list
- ✅ Mastery scan widened to next-unit words — stretch exposure/usage lands in `learner_item_stats` (the thesis measurement)
- ✅ Weekly report — `core/report.py` + `GET /learners/{id}/report/weekly` (read-time word diff, stretch/curriculum/wild tags) + parent-dashboard section
- ✅ Decision A: **no** `learner_word_stats` table (see Rule #3)

**Done (Child safety + input limits — 2026-06-11, see `docs/2026-06-11-dev-log.md`):**
- ✅ Always-on `_SAFETY_INSTRUCTIONS` in the system prompt (all modes, custom personas): no unsafe topics, deflect-and-redirect when the child raises one, comfort + "talk to your parents" for distress, no personal info / meetups / external sites; tests lock it in. Vendor moderation is layer 2; a moderation API is deferred to public launch.
- ✅ `config.toml [limits]` + `LimitsConfig` — chat text 500 chars, recording auto-stop 60 s/120 s, ingest text 10k chars (fits OCR re-extract round-trip), 5 images × 10 MB (de-hardcoded), 10 MB audio backstop. Backend authoritative on all four upload paths; frontend mirrors in `lib/constants.ts` (keep in sync).
- ✅ Client feedback: char counters at ≥ 80% of limit, recording countdown in last 10 s, `n/5` image badge + disabled buttons at cap; warning toasts parameterized
- ✅ Shared `_read_turn_input()` replaces duplicated audio read/transcode in batch + streaming turn endpoints

**Done (Material sharing — 2026-06-11, design `docs/learner-content-scope.md`, log `docs/2026-06-11-dev-log.md` §4):**
- ✅ Private link/code sharing of root books (no public library — copyright stays between consenting parents); receiver chooses **subscribe** (live reference, read-only, owner's edits propagate — the default) or **clone** (independent copy)
- ✅ `group_share_link` + `group_adoption` tables (migration `c62cb152ead5`); `app/api/share.py` (link create/revoke, no-auth preview, adopt, fork, unsubscribe, subscription list); `core/sharing.py` deep copy — mastery survives fork because items are canonical
- ✅ `GET /groups` returns subscribed trees (`subscribed` flag); access check fixed to walk to the root (child units of subscribed books were 404)
- ✅ UI: share button + paste-a-code box + subscribed badges + fork/unsubscribe + tombstones (materials page); landing page `parent/materials/share/[code]`
- Co-building deferred by decision (subscription model is its forward-compatible precursor)

**Done (Blob storage cloud tier — Qiniu, 2026-06-11):**
- ✅ `QiniuBlobStorage` (`app/adapters/storage/qiniu.py`) — private Kodo bucket, plain-httpx async (no vendor SDK): form upload, signed download URLs, stat/delete. The bucket is shared by future content domains via constructor `key_prefix="audio"` — DB keys stay unprefixed (the prefix is wiring, like the local root)
- ✅ `TieredBlobStorage` (`storage/tiered.py`) — write local → respond → background upload → verified delete of local copy; reads fall back local → remote so in-flight chats never 404; `sync_pending()` in app lifespan re-uploads blobs left behind by a crash
- ✅ `BLOB_PROVIDER` in `.env` (`local` dev / `qiniu` prod — deployment infra, deliberately not config.toml) + `QINIU_*` settings; switching vendors (TOS when Qiniu fills up) = one adapter class + one factory case, keys unchanged
- ✅ Direct-link ready with zero code: `url()` returns signed URLs only when `QINIU_DOWNLOAD_DOMAIN` is `https://`; while it is `http://` (free CDN tier) the endpoint proxies bytes server-side (`_serve_stored_audio` already 302s when `url()` is non-None)
- ✅ Tests: `tests/test_blob_storage.py` (tiered lifecycle incl. failed-upload recovery; Qiniu key prefix + url gating)

**Done (Public chat sharing — growth links, 2026-06-11):**
- ✅ `session_share_link` table (migration `e8b3f51a2c47`) — 12-char public code per session; revoke = public page 404s immediately. DB keeps full identity (session → learner); anonymity is applied at the API layer only, so a future "show name/avatar" toggle is additive, no backfill
- ✅ `app/api/chat_share.py` — owner create/revoke (auth) + public no-auth view `GET /shared-chats/{code}` (turns + has_audio flags, AI persona name only, no learner fields) and audio `GET /shared-chats/{code}/turns/{id}/audio`. Public audio serves STORED blobs only — the authenticated endpoint's on-demand TTS fallback is deliberately absent (strangers must not trigger paid TTS)
- ✅ Public page `[locale]/share/chat/[code]` (proxy.ts `PUBLIC_PREFIXES`, no auth, logged-in users not redirected) — SSR conversation + per-bubble playback via Server Action + register CTA footer
- ✅ Share button in chat title bar → dialog with explicit disclosure (link is public, audio incl. child's voice audible, revocable) before creating; copy + revoke
- ✅ nginx rate limit (stillume-nginx `talking-text.conf`) — `map $request_uri` keyed zone, 5 r/s + burst 20 on `/api/shared-chats/*` and `/{locale}/share/chat/*` only; authenticated traffic untouched. Guards the Qiniu free-tier traffic quota against scraping

**Next TODO (priority order — strategy and phase gates live in [`docs/roadmap.md`](docs/roadmap.md)):**
- [x] **Validate the core loop** with a hand-made book — 1–2 lessons + 1 real child ✅ 2026-06-10, works well (see `docs/content-lifecycle.md` §9, `docs/roadmap.md` §0)
- [x] Organize workbench V1 — inbox (capture + practice-derived) → tag tree, click-to-file/move (`parent/organize`, endpoints `/organize/*`); remaining: drag UX, AI grouping
- [x] **Phase 2 — mastery + stretch** ✅ 2026-06-10 (see Done block above; follower auto-advance deliberately deferred)
- [ ] **Phase 1 — external families** (`docs/roadmap.md`) — in progress: deploy ✅ (live 2026-06-11), book prepared ✅, families invited ✅ (classmates' parents, shared progress), material sharing shipped ✅; **remaining: audio storage admin script + boundary leakage log (both below) + watch week-2 retention / boundary leakage / latency**
- [ ] DB-backed tests for `_assemble_tag_path` / scope V1 (needs a Postgres test fixture)
- [ ] **Ingestion closed loop → lift into `core/curriculum/` (DB-aware)** — when building re-organization / inbox organizing / AI-assisted filing ("file this into the right textbook + chapter" using existing DB groups), move the extraction orchestration out of `app/api/ingest.py` into `core/curriculum/`. Reuse the two-stage seam: perception transcription is the re-runnable capture artifact (re-structure without re-OCR); the `structuring` stage becomes the extension point for an AI filing suggester that reads existing `ItemGroup`s.
- [ ] **Audio storage admin script (manual retention — decided 2026-06-11: NO auto-delete)** — no Kodo lifecycle rule; deletion is always a deliberate human act. A founder-run script (`backend/scripts/`, future admin console takes over this job) with two modes:
  - **Report**: total bytes + per-learner / per-session breakdown + age distribution, across both local staging and Qiniu (`BlobStorage` adapter only — never raw paths)
  - **Delete** (explicit filter, e.g. `--older-than-days N`, with dry-run): **exempt sessions that have an active `session_share_link`** (shared chats are marketing material — their audio must not go mute); for everything deleted, also null `turn.audio_in_path` / `audio_out_path` so chat + share pages degrade cleanly (text stays; owner-side TTS regenerates on demand, child voice is gone forever — accepted)
- [ ] **Boundary leakage log line** (Phase 1 pass-bar instrument — currently NOT measurable; the "boundary check" in the flow diagram is aspirational, no code exists) — in the orchestrator, where the mastery anchor-scan already holds the scope item list and the AI reply text (`core/dialog/orchestrator.py` ~282 and ~509), diff the reply's words against allowed scope (incl. stretch) and log `[leakage] session=… turn=… oos=[…]` to stdout. Derive-only (Rule #3, no table); crude tokenization is fine — this is a trend signal, not a grader. Reuse the anchor-scan's normalization so inflections don't all count as leaks.

> As of 2026-05-30: `just check` is fully green — backend `ruff` + `mypy` (0 errors, dead `conversation.py` removed), frontend `eslint` + `prettier` + `tsc`.
