# Talking Text · 字有天地

> **言出成界** · Words become your world.

An English speaking companion for children. The AI chats only within what the child has learned (plus a little stretch just beyond)—turning the static words on a textbook page into everyday spoken language.

---

## Docs

| Document | Content |
|---|---|
| [Product](docs/product.md) | Origin, philosophy (Wittgenstein × Li Bai / Yu Guangzhong), brand, opening phrase library |
| [Architecture](docs/architecture.md) | Tech stack, repo layout, data models, Scope Computer, conversation flow, Adapter pattern, deployment |
| [Tech Stack](docs/tech-stack.md) | Every tech decision: what, why, alternatives considered, why not |
| [Session Log](docs/session-log.md) | From idea to working scaffold — key decisions and reversals |
| [CLAUDE.md](CLAUDE.md) | Project context for Claude Code and future contributors |

Chinese versions: [README.cn.md](README.cn.md) · [docs/*.cn.md](docs/)

---

## At a glance

- **Problem** — Kids study English for hours but rarely get to speak. General-purpose AI chat has no vocabulary boundaries; kids hit the wall and get frustrated.
- **Solution** — Feed the child's textbook to the AI, let it chat within "learned vocab + 10% stretch." Every conversation starts from a confident center and pushes the boundary outward, one inch at a time.
- **Philosophy** — Wittgenstein: the limits of language are the limits of world × Yu Guangzhong / Li Bai: one breath from an embroidered mouth, and half the Tang Dynasty spills forth.
- **Tech** — Web PWA (Next.js full paradigm + FastAPI) · Volcengine Ark STT/LLM/TTS · PostgreSQL + Redis + Volcengine TOS.

---

## Quick start

```bash
just install        # install backend + frontend deps
just dev            # start both backend and frontend
just api            # backend only (http://localhost:8000)
just web            # frontend only (http://localhost:3000)
just                # list all available commands
```

Requires local Postgres + Redis (no Docker in V1; see [architecture docs](docs/architecture.md) for details).

---

## License

Not yet published.
