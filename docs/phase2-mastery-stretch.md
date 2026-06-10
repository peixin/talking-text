# Phase 2 Design — Mastery + Stretch

> Status: **approved & implemented 2026-06-10** — Decisions A (no `learner_word_stats`)
> and B1 (`item_group.position`, migration `8f2d4b7c1a90`) confirmed by the owner.
> Date: 2026-06-10 · Chinese version: [`phase2-mastery-stretch.cn.md`](phase2-mastery-stretch.cn.md)
> Context: [`roadmap.md`](roadmap.md) Phase 2 · [`architecture.md`](architecture.md) §5

---

## 0. Inventory correction — what already exists

The roadmap's Phase 2 bullet list was written as if mastery tracking started from
zero. It does not. As of `b46a6684d7e9` (content-model migration) the repo already
has a working item-level mastery pipeline:

| Piece | Where | State |
|---|---|---|
| `learner_item_stats` table — `(learner_id, item_id)` PK, `seen_count`, `used_count`, `correct_count`, `last_seen`, `mastered_at` | `storage/models/learning.py`, migration `b46a6684d7e9` | **live** |
| Per-turn anchor scan (ticks `seen_count`/`last_seen` for in-scope items found in `text_user`) | `core/mastery.py: scan_turn_for_items` | **live**, fired by orchestrator |
| Session-end LLM analysis (ticks `used_count`/`correct_count`, sets `mastered_at` at threshold 3) | `core/mastery.py: analyze_session` | **live**, fired by orchestrator |
| Mastery-aware scope slicing (>100-item groups sorted by mastery score) | `core/scope/v1.py` | **live** |

So Phase 2 is **not** "build the mastery tracker"; it is "make scope and parents
*consume* what the tracker already collects." Three work items remain:

1. Scope Computer V2 — stretch words from the next unit, mastery-weighted.
2. Parent-facing weekly report — "new words your child produced this week."
3. (Thin slice) follower progressive unlock — deliberately deferred, see §5.

---

## 1. Decision A — do we still need `learner_word_stats`? **Recommendation: no.**

The roadmap (and CLAUDE.md rule #3) planned a `learner_word_stats (learner_id, word)`
table with per-turn incremental upsert. Re-examining its two intended consumers:

- **Stretch weighting** needs mastery state for *curriculum items* — that is
  `learner_item_stats`, which already exists. Stretch candidates are
  `LanguageItem`s from the next unit; their state is item-level, not
  surface-word-level.
- **The weekly report** needs "words in this week's `text_user` not present in any
  earlier turn." That is a read-time set difference over the learner's own turns.
  The organize inbox already does exactly this computation live
  (`groups.py: _tokenize_words` + diff) with no table behind it. At Phase 1 scale
  (3–5 families, minutes of speech per session) the scan is milliseconds.

Rule #3's own premise — *word frequency is derivable from turn text at any time;
it is not an independent source of truth* — argues for not materializing it until
a real read-path bottleneck appears. **Proposal: build nothing; compute the report
at read time. Revisit if/when report latency or turn volume hurts.** This makes
Phase 2 require **at most one** schema change (Decision B), possibly zero.

---

## 2. Decision B — "next unit" needs an ordering. **Schema choice — needs approval.**

Stretch = "~10% next-unit words." But `item_group` has **no sibling ordering
column**. Units exist as sibling `ItemGroup` rows under a book node; nothing
records that Unit 2 follows Unit 1 except the name.

| Option | Schema change | Behavior |
|---|---|---|
| **B1 (recommended)** — add nullable `item_group.position: int`; order siblings by `(position NULLS LAST, natural-sort(name))` | one nullable column + migration, no backfill needed | Natural-sort fallback means existing trees work untouched ("Unit 2" < "Unit 10" handled correctly); the organize workbench can expose explicit reordering later without another migration |
| B2 — natural-sort on `name` only | none | Zero migration, but breaks silently on non-numbered names ("Food", "My Family") — exactly what hand-made books and Tot Talk have |
| B3 — order by `created_at` | none | Capture order ≠ curriculum order; photographing pages out of order corrupts the sequence permanently |

Proposed column for B1:

```python
# item_group
position: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
# No index: only ever read together with parent_id, which is already indexed.
```

"Next unit" definition (kept deliberately narrow for V2):

- The next **sibling** of the session's anchored group, under the same parent,
  in the order above.
- Anchored at a lesson → next lesson; anchored at a unit → next unit.
- Last sibling, root group, or free/calibration mode → **stretch is empty**.
  Crossing parents (last lesson of Unit 1 → first lesson of Unit 2) is a
  non-goal for V2.

---

## 3. Scope Computer V2 — stretch selection

### 3.1 Protocol extension (additive — does not break the frozen interface)

```python
@dataclass
class ScopeResult:
    ...existing fields unchanged...
    stretch_words: list[str] = field(default_factory=list)   # NEW
    stretch_ratio: float = 0.0                                # NEW, echoes config
```

### 3.2 Selection algorithm (in `core/scope/v2.py`, group mode only)

1. Resolve the next sibling group (§2); collect its descendant items of
   `type == "word"`. None → return V1 result unchanged.
2. Exclude words already in the base scope (dedup against `words`).
3. Exclude already-mastered words (`learner_item_stats.mastered_at IS NOT NULL`).
4. Budget = `ceil(stretch_ratio × len(base_words))`, capped at `stretch_max_words`.
   (50 base words × 0.10 → 5 stretch words.)
5. **Mastery-weighted ordering**, two tiers:
   - Tier 1: glimpsed but not mastered (`seen_count > 0`) — reinforce what the
     child has already brushed against.
   - Tier 2: never seen.
   Within each tier, shuffle **seeded by `session_id`** — deterministic within a
   session (same words every turn, so the LLM can build on them and the
   selection is reproducible without persisting it), rotated across sessions
   (the same 5 words don't monopolize stretch forever).

### 3.3 Config (business params → `config.toml`, per configuration layering)

```toml
[scope]
stretch_ratio = 0.10
stretch_max_words = 8
```

### 3.4 Prompt assembler — new section (group mode, when stretch non-empty)

Placed after the base-vocab section; wording to the effect of:

> "Stretch words — the child has NOT learned these yet: {words}. You may weave in
> AT MOST one or two per conversation, only where context makes the meaning
> obvious (gesture-level clarity), and casually glossing it once is fine. Never
> quiz, never list, never make the child feel these are 'test words'. If the
> child picks one up and uses it, celebrate briefly."

The existing base-vocab instruction says "do not introduce vocabulary outside
this list (one or two new words per session is fine)" — V2 changes that escape
hatch to point at the stretch list instead of leaving the LLM free to invent:
"if you introduce new words, take them from the stretch list."

### 3.5 Measuring the thesis — close the loop in `core/mastery.py`

The pass bar is "stretch words actually appear in children's speech within a
week of exposure." Today `scan_turn_for_items` and `analyze_session` only look
at the anchored group's items, so a child *using* a stretch word is invisible.

Fix, with no schema change: both functions extend their item set with the next
sibling group's word items (same resolution as §2 — recomputed, not persisted).
Any next-unit word the child produces then lands in `learner_item_stats` via the
existing seen/used/correct machinery. Exposure is implied by `seen_count` on
next-unit items; production by `used_count`. The weekly report (§4) surfaces it.

Deliberate simplification: we track usage against the *whole* next unit rather
than only the ~5 offered words. A child spontaneously producing a next-unit word
Tina never said is an even stronger thesis signal, and it spares us persisting
per-session stretch selections.

---

## 4. Parent weekly report — "new words your child produced this week"

Per the roadmap: **a plain list, no charts.** One artifact testing both the
thesis (stretch words showing up) and the retention hook (parents returning).

### 4.1 Computation (read-time, no new tables — see Decision A)

For the learner, over turns in the last 7 days:

1. `this_week = tokenize(text_user of turns in window)` (reuse `_tokenize_words`).
2. `before = tokenize(text_user of all turns before window)`.
3. `new = this_week − before`, with first-said date and count.
4. Tag each word:
   - **curriculum** — matches a word-type `LanguageItem` in the learner's
     assigned groups' scope;
   - **stretch** — matches a next-unit item relative to any group the learner
     had sessions on this week (the thesis column);
   - **wild** — neither (out-of-curriculum speech; same set the organize inbox
     already harvests as practice candidates).

No stop-word filtering in this round — the premium noise-reduction pipeline is
already specced separately in `feature-proposal-spoken-vocabulary.md` and stays
deferred. If the raw list proves noisy for parents, the cheap first lever is
hiding one-letter/two-letter tokens, not a vocabulary database.

### 4.2 Surfaces

- Backend: `GET /learners/{learner_id}/report/weekly` →
  `{week_start, week_end, new_words: [{text, first_said_at, count, tag}]}`.
  Owner-account auth, same dependency chain as existing learner endpoints.
- Frontend: a section on the existing parent page (Server Component, data via
  `lib/backend.ts`; labels in `i18n/messages/*`). No new route needed unless the
  parent page is already crowded.

### 4.3 Out of scope for this slice

Push/notification of the report, week-over-week comparison, per-session
breakdown, charts. The pass bar is "parents mention the report unprompted" — a
list they pull up is enough to test that.

---

## 5. Follower progressive unlock — deliberately thin

The roadmap lists it (critical-path step 5, overlapping
[`learner-content-scope.md`](learner-content-scope.md) subscription mechanics).
Subscriptions already exist (`item_group_subscription`, clone/reference/fork).
What "progressive unlock" adds — auto-advancing a follower's anchor unit as
mastery crosses thresholds — depends on exactly the mastery + stretch data this
phase starts generating.

**Proposal: defer auto-advance out of this round.** A follower parent picking
the unit at session start *is* manual progressive unlock, and it already works.
Revisit once weekly-report data shows mastery thresholds are trustworthy enough
to drive advancement — wrong auto-advance is worse than none.

---

## 6. Summary of approvals requested

| # | Decision | Recommendation |
|---|---|---|
| 1 | `learner_word_stats` table | **Don't build** — compute report at read time (Decision A) |
| 2 | Sibling ordering for "next unit" | **B1**: nullable `item_group.position` + natural-sort fallback (only schema change in Phase 2) |
| 3 | `ScopeResult` gains `stretch_words` / `stretch_ratio` (additive) | Approve |
| 4 | Mastery scan widened to next-unit items (no schema change) | Approve |
| 5 | Weekly report endpoint + parent-page section, no new tables | Approve |
| 6 | Follower auto-advance | **Defer** (manual unit pick already works) |

Implementation order once approved: §2 migration → §3 scope V2 + assembler +
mastery widening (backend-only, testable with existing fixtures) → §4 report →
manual validation with the founder's child before Phase 1 families see stretch.
