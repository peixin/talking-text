# Content Lifecycle: Capture → Canonical → Library

> Design doc — finalized 2026-05-30.
> Resolves the "materials feel chaotic" problem by separating two things the
> current code conflates: **capturing fragments** and **assembling a textbook**.
> Sits above [`content-model.md`](content-model.md) (the storage schema) and
> [`learner-content-scope.md`](learner-content-scope.md) (multi-learner / sharing).
> Chinese sibling: [`content-lifecycle.cn.md`](content-lifecycle.cn.md).

---

## 1. The core distinction this doc establishes

The current implementation tries to make a daily photo **auto-file itself into a
complete textbook tree** at capture time (AI infers `parent_id`, the whole
library is stuffed into the extraction prompt, `kind` is guessed by position,
`levels` auto-builds and fuzzy-merges the tree). This is the single root cause of
the three reported symptoms: *hierarchy too complex, materials UI messy,
conceptual model unclear.*

The fix is one principle:

> **Capture is append-only and dumb. Structure is a separate, deliberate act,
> done by few people (initially the operator), and never forced onto a photo.**

"Progressive daily addition" (渐进式每日添加) does **not** mean "every photo
auto-places itself into the tree." It means fragments *accumulate* over days in a
capture stream; *becoming a structured book* is the result of a separate curation
pass.

---

## 2. Two personas (they use the product completely differently)

Most users will never capture or structure anything. The product must serve the
follower first, the contributor second.

| | **Follower** (the majority) | **Contributor** (the few + the operator) |
|---|---|---|
| Goal | Pick a ready-made textbook and have the child follow it | Build a clean textbook from fragments and publish it |
| Touches **capture**? | Never | Yes |
| Touches **structure / tree**? | Never | Yes — they are the only user of Layer 2 |
| What "progressive" means to them | A finished book whose units **unlock** day by day (pacing) | Fragments **accumulate** into a book being built |
| Edit rights | Read-only (subscribed); see `learner-content-scope.md` §9.4 | Full, on their own canonical book |

Design consequence: the elaborate auto-filing logic in `ingest.py` / `groups.py`
serves the contributor — a tiny pool — yet was built as the default path for
everyone. The majority's actual need (a stocked library to follow) does not exist
until the operator seeds it.

---

## 3. The three layers

```
┌─ Layer 1 · Capture stream (Inbox)───────────────────────────┐
│  per-learner, append-only, FLAT, zero filing decisions       │
│  photo / paste → AI extracts WORDS ONLY (no classification)  │
│  → lands in "<learner>'s captures"                           │
│  The child can talk against a capture bag IMMEDIATELY        │
│  → this is all the core loop needs to be validated           │
└───────────────────────────┬─────────────────────────────────┘
                            │  contributor deliberately "organizes":
                            │  drags items into the tag tree
                            ▼  (NOT auto-guessed at photo time)
┌─ Layer 2 · Canonical textbook (tag tree)───────────────────┐
│  a single-parent tree of TAGS (Tot Talk › Book 1 › Unit 1)   │
│  this is the "complete tree." It is a PRODUCT OF CURATION,   │
│  not a side effect of capture. Detailed in §4.               │
└───────────────────────────┬─────────────────────────────────┘
                            ▼  curated clean → published
┌─ Layer 3 · Public library (V2)─────────────────────────────┐
│  canonical groups with `owner_account_id = NULL`            │
│  followers subscribe; units unlock progressively            │
│  design seed already in learner-content-scope.md §2.7, §12  │
└─────────────────────────────────────────────────────────────┘
```

### Why the existing schema already supports this — no rebuild

`LanguageItem` is globally de-duplicated (`UNIQUE(type, text)`). Therefore
"promote a captured word into Unit 3 of a canonical book" is just **inserting one
`item_group_member` row — zero copy**. The same `apple` row is shared by the
capture bag and the canonical lesson. The "万物皆组" model was built for exactly
this; it has simply not been *used* this way yet.

---

## 4. Layer 2 in detail — the organize workbench

This is the concrete spec of the curation step. It is the only place hierarchy is
built, and it is operated by the contributor (initially the operator).

### 4.1 Nodes are TAGS, not levels

Users do not think in "level 1 / level 2 / level 3." They think in names they
recognize: `Tot Talk`, `Book 1`, `Unit 1`, `Lesson 1`. So:

- **Every `item_group` node is a tag** — just a name. There is no typed structural
  role driving the tree.
- **Depth is free.** `Tot Talk › Book 1 › Unit 1 › Lesson 1` (4 deep), or shorter,
  or a single `General Practice` (1 deep). Nothing forces "must be book/unit/lesson."
- **Single-parent tree**, not orthogonal multi-tagging. Chosen because the
  product's hierarchy is genuine containment (a lesson is in exactly one unit),
  ordering matters (Unit 1 before Unit 2; 上册 before 下册), and Scope Computer's
  descendant traversal (`get_descendant_group_ids`) already assumes single parents.
  The user's own example is a clean single chain.
- **`kind` is demoted to a cosmetic label.** It may carry the AI's `kind_label`
  ("教材" / "单元" / "课次") as a small display hint next to a tag, but it **never
  drives structure and is never read by Scope**. The position-based `kind`
  deduction (`idx == total-1 → lesson`) — the very embodiment of "level N" — is
  removed.
- **What the user sees** is the breadcrumb of tag names along the parent chain.
  They never see a level number.
- **Orthogonal theme tags** (`animals`, `童话`) are explicitly deferred to V2. V1
  is the hierarchical tag path only.

### 4.2 The workbench: loose-item inbox → tag tree

```
Organize workbench
┌──────────────────────────┬─────────────────────────────────────┐
│  Left: loose-item inbox   │  Right: tag tree (canonical)         │
│                          │                                     │
│  ▸ 随手输入 (capture bags) │   Tot Talk                          │
│     apple banana run      │     └ Book 1                        │
│                          │        └ Unit 1                     │
│  ▸ practice-derived (§4.3)│        └ Unit 2  ◀── drag dragon here│
│     dragon🆕 castle🆕     │             cat, dog                │
│     AI: "looks like a     │   [+ enter tag path: Tot Talk›Book1›…]│
│         fairy-tale unit?" │                                     │
└──────────────────────────┴─────────────────────────────────────┘
  · drag an item into a node      = INSERT item_group_member (zero copy)
  · enter a tag path              = deterministic create/merge (§4.4)
  · AI proposes a grouping        = human confirms; never silent
  · dismiss an item               = it stays loose / archived
  The user only ever sees recognizable tags — no "level".
```

The workbench's entire job is **promotion**: deciding which loose `LanguageItem`s
become permanent members of which tag node. It is not a creation tool — items
already exist; structuring only adds membership.

### 4.3 Practice-derived candidates (承接 "练习后的产物")

The inbox's second source is the residue of conversation. Per `CLAUDE.md` Rule #3
(word data is derived from `turn` text, not a separate event table), these are
**derived on demand, not stored**:

- On opening the workbench, diff the learner's `turn` text against the canonical
  tree's current membership → surface words the child actually used in practice
  that are **not yet filed in any canonical node**.
- Accepting one into a node is a deliberate write: lazily create the
  `LanguageItem` (global dedup) + insert the `item_group_member`.

This closes the product's central loop: child talks → new words emerge from real
use → contributor curates the good ones into the growing book → they feed the next
session's Scope. **The book grows bottom-up from what the child actually said** —
the concrete, operational form of the product thesis "让新东西悄悄长进来 / push the
boundary outward one inch" and Krashen's i+1.

### 4.4 `tag_path`: deterministic tree assembly

The old `levels` array logic (walk a list of names, nest them, merge same-name
siblings) is **kept** — it is exactly "tags dynamically forming a tree." What made
it chaotic was *where and by whom* it ran, not the logic. The fix is to change the
trigger and strip the typing:

- **Input**: an ordered list of exact tag names, e.g.
  `["Tot Talk", "Book 1", "Unit 1", "Lesson 1"]`.
- **Assembly**: walk the path; for each tag, exact-name match an existing child
  under the current parent → reuse it; else create a node. Items attach to the leaf.
- **No `kind`-by-position.** Nodes are untyped tags.
- **One implementation** shared by create and update (the two divergent copies in
  `groups.py` are deduped into a single helper).

| | Old (chaotic) — remove | New (`tag_path`) — keep |
|---|---|---|
| Who supplies the tags | AI guesses from a photo | Human confirms exact tags |
| When | At capture time | At organize time |
| Merge basis | Fuzzy (lowercased / trimmed guess) | Exact same-name match (deterministic) |
| Side effect | Also guesses typed `kind` (level N) | None — just nests named tags |

---

## 5. The two meanings of "progressive" — keep them separate

- **Authoring-progressive** (contributor): a book is built over multiple sessions;
  words land in the capture stream daily and are periodically curated in. Pacing
  is the contributor's, driven by how fast the source material is photographed.
- **Consumption-progressive** (follower — the mass experience): the book is
  already complete; the child **unlocks** the next unit/lesson on a schedule or by
  mastery. Governed later by the mastery tracker (V2/V3, `core/mastery.py` stub,
  `LearnerItemStats` plan). Content is pre-made; only *exposure* advances.

Conflating these two is part of the current confusion. The mass "渐进式" is
consumption-progressive over pre-made content, not authoring.

---

## 6. Where AI actually "takes over"

The operator's intent — "let AI take over as much as possible because parents
can't judge English" — maps to two clean places, **not** to silent per-photo
filing:

1. **The library is pre-stocked.** A follower opening a ready book *is* the form
   "AI/the operator already handled it." This is the dominant takeover.
2. **AI-assisted curation for the contributor.** In the workbench (§4.2), AI does
   batch extraction and *proposes* structure ("these 8 new words look like a
   fairy-tale unit") in one focused, reviewable pass — a human confirms. This is
   deliberate and auditable, the opposite of scattered per-photo guessing that is
   always slightly wrong and never converges.

Rejected: AI silently inferring `parent_id` / tag path / tree placement on every
ingest for every parent. It serves the wrong persona and cannot be made reliable.

---

## 7. Cold-start reality

"Most people just follow a ready book" requires the library to be **stocked
first**. Who stocks it? The operator, using Layer 1 + Layer 2 + AI-assisted
curation, to produce 1–2 clean canonical books (e.g. the Tot Talk series named in
`CLAUDE.md`). Until that seed exists, the follower journey has nothing to follow.

This makes the operator the **first and most important contributor**. The
contributor tooling is therefore not "advanced / later" — it is what the operator
needs *now* to seed the library. But it is needed as a **deliberate build
workbench** (§4), not as auto-magic on every capture.

---

## 8. What to cut / change in current code

| Now (source of chaos) | Change to |
|---|---|
| `ingest.py` infers `parent_id` / `levels` / `book_name` / `unit` / `lesson` and stuffs the whole library into the prompt (`groups.py` existing-materials block) | AI returns **items only** + a suggested `name` + `cefr`. It does **not** return tree placement. No librarian role. |
| `create_group` / `update_group` `levels` auto-tree run at ingest time, with two divergent copies and `kind`-by-position | **Repurpose, don't delete.** Keep the nest-and-merge logic as the organize-time `tag_path` assembler (§4.4): exact same-name merge, **remove** `kind`-by-position, dedupe into one helper, and trigger it only from human confirmation in the workbench. |
| `kind` as a structural enum (`textbook_book/unit/lesson`) | Demote to an **optional cosmetic label** (§4.1), fed by AI `kind_label`. Never structural; never read by Scope. |
| One screen does both capture and tree-building | Split into: ① **Capture** (camera → confirm words → done, ~5s) ② **Organize workbench** (§4; the hierarchy workbench already started in commit `c4bbca7`). |

Note: `get_descendant_group_ids` is **retained** — Scope still traverses the tag
tree. Its current full-table-scan implementation is a separate performance cleanup
(replace with a recursive CTE) for later, not part of this change.

---

## 9. Critical path (do this order)

1. **Validate the core loop with a hand-made book.** Paste/seed ONE small
   canonical book directly — even 1–2 lessons of hand-entered practice is enough
   (no capture pipeline needed). One child follows it, talks 20 turns. Watch Scope
   for out-of-scope leakage; watch whether it is fun.
2. **Cut / repurpose the auto-filing** (§8). Capture becomes a flat bag; ingest
   extracts words only; the tag-path assembler moves into the workbench.
3. **Build the organize workbench** (§4) — the contributor's tool to turn loose
   items (capture + practice-derived) into a clean tag tree. AI proposes, human
   confirms.
4. **Seed the library** with 1–2 canonical books (cold-start, §7).
5. **Follower path**: subscribe a public book + progressive unlock (overlaps with
   `learner-content-scope.md` subscription mechanics and the V2 mastery tracker).

Step 1 is unblocked even with minimal material. Step 2 is the cleanup. Steps 3–5
build the "everyone follows a ready book" vision on a clean foundation.

---

## 10. Relationship to other docs

- `content-model.md`: storage schema unchanged. This doc only changes *how the
  schema is used* (capture bags vs. curated tag trees; promotion via
  `item_group_member`; `kind` demoted to cosmetic).
- `learner-content-scope.md`: the follower's read-only / subscription behavior
  (§9.4, §2.3) is exactly the mass-consumption path described here. Public library
  (§2.7, §12) is Layer 3.
- `architecture.md` §8 (Curriculum Pipeline): **amended** — the pipeline's
  "AI infers hierarchy and parent_id" step is removed; extraction returns items
  only, structuring is the deliberate workbench action of §4.
- `CLAUDE.md` Rule #7 (canonical schema): reinforced — external input still
  converges to a `Curriculum → Unit → ...` shape, but the convergence happens at
  *curation* time via `tag_path`, not at *capture* time.
