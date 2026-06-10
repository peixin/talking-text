# Roadmap

> Last updated: 2026-06-10 · Chinese version: [`roadmap.cn.md`](roadmap.cn.md)
>
> This is the strategy doc: what we build next and **why in this order**. Day-by-day
> records live in the dated dev logs; the content pipeline's critical path lives in
> [`content-lifecycle.md`](content-lifecycle.md) §9; product philosophy in
> [`product.md`](product.md).

---

## 0. Where we are (2026-06-10)

The core loop is **validated with one real child** — the child follows a hand-made
book, talks through real sessions, and it works ("效果不错"). Critical-path steps
1–3 of `content-lifecycle.md` §9 are done: core-loop validation, capture/canonical
split, organize workbench V1.

Be precise about what that validates and what it does not:

| Validated | Not yet validated |
|---|---|
| A child will hold an in-scope English conversation with Tina and enjoy it | **The product thesis** — mastery-driven ~10% stretch ("push the boundary outward one inch") is still a stub: Scope V1 returns empty stretch, the mastery tracker is not wired into scope |
| The capture → organize → practice pipeline works end-to-end for the operator | **Retention without the founder in the room** — strangers' kids, week 2 |
| The voice pipeline is good enough for at least one family | Latency tolerance of kids who don't get the founder's patience |

Each phase below attacks the currently riskiest assumption. Don't reorder them
without naming a riskier assumption first.

---

## Phase 1 — External families (now → ~2 weeks)

**Assumption under test: "works for strangers' kids, and they come back in week 2."**
"Works for my kid" carries founder bias — the founder is in the room, set up the
environment, and photographed the textbook. The next ring of validation needs 3–5
families who don't love us.

Two hard gates, then invite:

1. **Deploy.** The compose stack already works (`docker-compose.yml`, full-stack
   integration test) — rent one domestic VPS, add a domain + HTTPS, run it.
   Nothing more: no CI/CD, no monitoring stack; `perf_logging` to stdout is the
   observability budget.
2. **Seed the library** (critical-path step 4). A follower parent's first run must
   be *pick book → pick unit → child talks* — under 2 minutes to first value, no
   capture required. Seed the child's actual school textbook first, Tot Talk
   second.
3. **Invite 3–5 non-founder families** from the personal circle (email login is
   fine at this scale).

**Pass bar:** ≥3 of 5 families have ≥2 sessions in week 2. Also watch: boundary
check leakage rate (out-of-scope words per session) and per-stage latency from
the perf logs.

**Obligation that activates here:** other people's children's audio lands on our
server. The privacy self-discipline in CLAUDE.md becomes binding — define an audio
retention policy (e.g. auto-delete raw audio after 30 days), keep all storage
domestic, write the policy into a dev log when implemented.

## Phase 2 — Make the thesis real: mastery + stretch

**Assumption under test: "visible progress is why parents keep scheduling
sessions" — and the boundary-pushing claim itself.** This is the soul of the
product and it is currently unimplemented. Runs in parallel with Phase 1 where
possible.

- `learner_word_stats` table — incremental upsert per turn, history backfilled
  from `turn.text_user/text_ai` (Rule #3: derive from turn text, no event table).
  **Schema needs explicit confirmation before any code/migration.**
- Scope Computer V2: stretch = ~10% next-unit words, mastery-weighted.
- Parent-facing minimal report: **"new words your child produced this week"** — a
  plain list, no charts. This single artifact tests both the thesis (stretch words
  showing up in the list) and the retention hook (parents returning to see it).
- Follower progressive unlock (critical-path step 5; overlaps the subscription
  mechanics in `learner-content-scope.md`).

**Pass bar:** stretch words actually appear in children's speech within a week of
exposure; parents mention the report unprompted.

## Phase 3 — Latency, decided by data

**Assumption under test: "batch is too slow for kids outside the founder's
family."** Do not pre-build. Threshold: if real family usage shows p50 full-turn
latency > ~4–5 s, build **streaming TTS first** (largest perceived win — audio
starts playing early); leave batch STT and LLM alone until TTS streaming is no
longer the bottleneck. If the logs don't support the threshold, this phase stays
empty.

---

## Explicitly NOT now

The repository's historical failure mode is polishing periphery before the core
is proven. None of the following until the phase gates above say otherwise:

- **Billing / token metering UI** — no paying users; the registry's pricing data
  stays unconsumed until then.
- **PDF / MP3 curriculum import** — text + image capture covers the seeding work.
- **Cloud `BlobStorage` backend** — local disk until multi-device or disk pain is
  real (the adapter seam is ready).
- **Organize workbench drag-UX polish, AI filing suggester** — contributor tools;
  there is one contributor and he can click.
- **WeChat / SMS login** — email is fine for invited families; revisit with PIPL
  work before any public launch.
- **More vendor adapters / model registry expansion** — the abstraction is done;
  add entries only when a stage actually switches.

---

## Decision log

- **2026-06-10** — Core loop validated with one real child; doc created. Next
  riskiest assumption named: week-2 retention with non-founder families (Phase 1)
  and the unimplemented stretch thesis (Phase 2).
