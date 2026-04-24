# Session Log · 2026-04-24

> Full record: from a single idea to a working scaffold.
> Not a timeline—a memory of *why we decided what we did*.
> Chinese version: [session-log.cn.md](session-log.cn.md)

---

## Phase 1: Brand & Philosophy

### 1.1 The core observation

Kids spend plenty of time studying English but almost never get to *speak* it. General-purpose AI chat (Doubao, etc.) has no scope—it surfaces words the child hasn't learned, the child hits a wall, frustration turns "chat" into a test.

Core idea: **feed the child's textbook into the AI and let it chat only within that scope.**

The goal isn't to teach new things—it's to make learned things truly the child's own.

### 1.2 Naming

**English name:** *Talking Text* — Text is the subject; Talking is its state. "Text that speaks," not two features bolted together.

**Chinese name:** *字有天地* — "Within words, there are worlds." Wittgenstein compressed into four characters: the limits of language are the limits of world.

**Slogan:** *言出成界* — four characters carrying two souls:
- 言出 = Li Bai's embroidered mouth pouring forth (action)
- 成界 = Wittgenstein's language-is-world (result)

### 1.3 Philosophical pillars

Two thinkers, one product:

- **Wittgenstein** (boundary): "The limits of my language mean the limits of my world." — *Tractatus*, 1921
- **Yu Guangzhong** (center, writing *to* Li Bai): "One breath from an embroidered mouth, and half the Tang Dynasty spills forth." — *Searching for Li Bai*, 1980

Product philosophy: **don't make the child hit the boundary. Let them speak from the center of their own world—and push the boundary outward, one inch at a time.**

### 1.4 Krashen i+1

Pure repetition of the known doesn't cause growth. Krashen's **i+1**: effective input is current level plus a little stretch. This became the design source for `stretch_vocab` in the Scope Computer: ~90% known + ~10% next-unit words absorbed through context.

### 1.5 Opening phrase library

English and Chinese each stand independently—not literal translations:

| Chinese | English |
|---|---|
| 开口，便是一个世界。 | Words become your world. |
| 开口一次，世界就大一寸。 | One word, one world. |
| 说得出，才算你的。 | If you can say it, it's yours. |
| 用你懂的，说出你的世界。 | Your voice creates your world. |

Easter egg: *word* → *world*, one extra letter **l** — the visual "inch" by which the world grows.

---

## Phase 2: Architecture Decisions

### 2.1 Product form: Web PWA

**Decision:** Next.js + Python, no native app.
**Reason:** App store update cycles are slow; cross-platform (iOS/Android/HarmonyOS) means three codebases.

### 2.2 Key stack decisions

| Question | Decision | Reason |
|---|---|---|
| Voice + LLM vendor? | Volcengine Ark full stack | One account, one bill |
| DB? | PostgreSQL 16 | Cloud-hosted parity + mature toolchain |
| Frontend framework? | Next.js 16 | SSR benefits for landing + login |
| Backend language? | Python 3.12 + FastAPI | Familiar + mature async ecosystem |
| ORM? | SQLAlchemy 2.0 | Prisma isn't a real Python option |
| UI library? | Tailwind v4 + shadcn/ui | Minimal + you own the source |

### 2.3 Eight architecture rules (locked in, written into CLAUDE.md)

1. **Adapter Pattern** — all external SDK calls in `adapters/`; `core/` depends only on Protocols
2. **Scope Computer** — interface frozen at V1; implementations evolve per version
3. **VocabEvent** — write in V1, read in V2 (mastery training data)
4. **Voice pipeline** — batch in V1, adapter interface exposes both `invoke()` and `stream()` from day one
5. **Account vs Learner** — Account = billing; Learner = study profile; logic only at Learner level
6. **Full Next.js paradigm** — default Server Component; Client Component only where necessary
7. **Canonical curriculum schema** — all input formats → `Curriculum → Unit → (vocab, articles, grammar, ...)`
8. **Docker-ready, not Docker-ized** — deferred to release; code must not require Docker to work

### 2.4 Scope constraint strategy: Level 0 + Level 1

No RAG (vocab is small and structured—overkill). Two layers:
- **Level 0:** ALLOWED_VOCAB in prompt + prompt caching
- **Level 1:** post-hoc tokenize comparison; out-of-scope → retry once

Expected reliability: ~95%+.

---

## Phase 3: Scaffold Build

### 3.1 Repo structure

```
talking-text/
├── backend/           # Python FastAPI (Poetry)
├── frontend/          # Next.js 16 + React 19 (pnpm)
├── docs/
├── justfile
├── lefthook.yml
├── README.md
└── CLAUDE.md
```

### 3.2 Backend skeleton

- `app/{api,core,adapters,curriculum,storage}` directory tree
- `GET /health` working
- Pydantic Settings reading `.env`
- CORS middleware
- `core/` subdivided into scope / prompt / dialog / mastery
- `adapters/` subdivided into stt / llm / tts

### 3.3 Frontend skeleton

- Next.js 16 App Router (noted: this is not the Next.js from training data)
- Read `node_modules/next/dist/docs/` upgrade guide; documented breaking changes
- Pages: landing (Server Component, SSR hits `/health`), login, (app) route group (chat / parent)
- Tailwind v4 + shadcn/ui initialized; `--primary` set to vermillion `oklch(0.52 0.175 25)`
- Font: Geist + system Chinese fallback (no Google Fonts — unstable in mainland China)

### 3.4 Database

- PostgreSQL 16 (brew) + Redis (brew) running locally
- `talking_text` user + database created
- Alembic initialized with `-t async` template; `env.py` reads DB URL from settings

### 3.5 DX toolchain

| Tool | Choice | Rejected alternative |
|---|---|---|
| Python lint/format | Ruff | Black + isort + flake8 (fragmented) |
| Python types | mypy | Pyright (worse Pydantic/SQLA compat) |
| TS lint | ESLint 9 + eslint-config-next 16 Flat Config | Biome (drops Next plugin ecosystem) |
| TS format | Prettier + prettier-plugin-tailwindcss | ESLint formatting (weak) |
| Git hooks | lefthook (brew) | husky (JS-only), pre-commit (Python-flavored) |
| Commit format | commitlint + Conventional Commits | None (team growth will hurt) |
| Task runner | just (Rust Makefile) | Makefile (tab trap), npm scripts (JS-only) |

Pre-commit hooks: ruff check/format + eslint + prettier + tsc
Commit-msg hook: commitlint

### 3.6 Bugs hit during scaffolding

1. **Poetry 2.0 `package-mode`** — default requires a publishable package; we don't ship one → added `package-mode = false`
2. **ESLint 10 + FlatCompat circular JSON bug** — `TypeError: Converting circular structure to JSON` — downgraded to ESLint 9 and imported eslint-config-next's native Flat Config exports directly
3. **shadcn init overwrote globals.css** — shadcn replaced all CSS vars, breaking the landing page; migrated all pages to Tailwind utility classes and rewrote `--primary` to vermillion

---

## Phase 4: Final State (end of session)

### Working

```
just dev              → backend + frontend start together
curl /health          → {"status": "ok"}
http://localhost:3000 → landing SSR shows 字有天地 / 言出成界 + random phrase; backend: ok
```

### Toolchain verified

```
just check            → ruff + eslint + prettier + tsc all green
just migrate "..."    → generates Alembic migration
just db-up            → applies migration
git commit            → lefthook enforces: ruff/eslint/prettier/tsc + commitlint all pass
```

### Next session TODO (priority order)

1. Account system (Account + Learner + password login + Server Action + proxy.ts auth)
2. Volcengine Ark LLM adapter (`invoke()` batch first)
3. Curriculum ingestion MVP (paste text → LLM extract → human review → DB)
4. Scope Computer V1 stub + Prompt assembly + boundary check
5. Conversation API (`POST /conversation/turn`)
6. Frontend chat page MVP (hold-to-record → HTTP → play audio)
7. Volcengine STT / TTS adapter
8. First-party textbook data (Tot Talk series — user to provide materials)

---

## Key reversals (would we decide differently?)

1. **Full Next.js paradigm** — started with "SSR shell + SPA core" compromise; reversed mid-session to full Next. Correct call: Server Actions + RSC eliminate a lot of manual SPA fetch logic.

2. **Docker deferred** — initially planned docker-compose in V1; user stopped it: "constantly changing in dev, not worth the Dockerfile churn." Correct: saved significant setup time.

3. **ESLint 9 vs 10** — ESLint 10 had FlatCompat circular JSON bug with Next. Dropped to 9, immediately stable. Lesson: newest tool version isn't always best, especially when major dependencies haven't caught up.

4. **UI library** — shadcn confirmed quickly. Correct in hindsight: the "you own the code" model gives maximum freedom.

---

## Mantras worth re-reading at the start of every session

- The child speaks from the center; the boundary moves outward one inch at a time.
- Every `vocab_event` is fuel for V2. V1 writes but doesn't read.
- Adapter Pattern is non-negotiable. `core/` may not import third-party SDKs.
- Scope Computer interface is frozen at V1. Implementations evolve.
- Correctness first. Performance after a real bottleneck.
- Docker-ready, not Docker-ized.
