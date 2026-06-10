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

1. **Deploy.** The production infra already exists (2026-06-10 audit): remote
   compose (`docker-compose-remote.yml` on `stillume-net`), one-click
   `just docker-deploy`, and a `talking-text.stillume.com` vhost in the shared
   stillume-nginx stack (body-size + SSE-buffering fixes applied). Remaining is
   key-turning, not building: fill `.env.deploy`, issue the cert, create
   `.env.app` on the server (`SESSION_COOKIE_SECURE=true`), run the deploy.
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

Design + decisions: [`phase2-mastery-stretch.md`](phase2-mastery-stretch.md).
Implemented 2026-06-10:

- ~~`learner_word_stats` table~~ — **dropped by design** (Decision A): item-level
  `learner_item_stats` already existed and covers stretch weighting; the report
  computes from turn text at read time (Rule #3: derive, don't materialize).
- Scope Computer V2 ✅ — stretch = ~10% next-unit words, mastery-weighted,
  session-seeded rotation. "Next unit" ordering via `item_group.position`
  (nullable, natural-sort fallback — the phase's only schema change).
- Parent-facing minimal report ✅ — **"new words your child produced this week"**,
  a plain list tagged stretch/curriculum/wild, on the parent dashboard. Tests both
  the thesis (stretch words showing up) and the retention hook (parents returning).
- Follower progressive unlock — **deferred**: manual unit pick at session start
  already is progressive unlock; auto-advance waits for trustworthy mastery data.

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
- **2026-06-10** — Phase 2 designed and implemented (`phase2-mastery-stretch.md`):
  `learner_word_stats` dropped (item-level stats already existed), scope V2 stretch
  + weekly report shipped; the stretch thesis is now measurable via
  `learner_item_stats` on next-unit words. Pass bar unchanged.
