# Content Model Design

> Converged design from the 2026-05-15 brainstorm. Supersedes [`curriculum-design.md`](curriculum-design.md), which described an earlier model with Curriculum / Unit / Lesson as separate primitives.
> Chinese sibling: TBD after design stabilizes.

---

## 1. Why this redesign

The original model treated `Curriculum / CurriculumUnit / CurriculumLesson` as primary primitives, with a separate `Collection / CollectionItem` added later for personal word lists, and a planned tag/topic system with pgvector on top. The result was parallel primitives competing for the same conceptual ground (range of items the learner studies), which leaked into:

- `V1ScopeComputer` branching on `collection_id` vs `lesson_id`
- Ingestion splitting into `save-to-lesson` vs `save-to-collection`
- Frontend tabs maintaining two parallel UIs for the same data
- Open questions about how mastery, sharing, and recommendations behave under each

This document captures the unified model that resolves the split.

---

## 2. Converged principles (load-bearing)

1. **`language_item` is the only atom.** Global table, deduped via `UNIQUE (type, text)`. Carries lightweight tags (`cefr_level`, `pos`) auto-applied by the LLM at ingest time. Mastery, errors, statistics all attach to items.

2. **`item_group` is the only organizing entity.** Single table with `parent_id` self-reference for arbitrary hierarchy. A `kind` column distinguishes textbook hierarchy levels, personal collections, quick practice, generated review sets, etc. Replaces separate Curriculum / Unit / Lesson / Collection tables.

3. **Mastery attaches to item, not group.** `learner_item_stats(learner_id, item_id)` accumulates regardless of where the item appeared. "apple" learned from a textbook and "apple" learned from a photo write to the same row.

4. **No mass seeding; substrate completes itself via usage.** Mechanisms: (a) global deduplication on item write, (b) first user declares a book's metadata once, (c) subsequent uploads matched via content fingerprint. ~20 active early users should cover the majority of mainstream mainland K–6 English textbooks.

5. **Ingestion = "AI defaults + minimum user correction".** AI extracts items, reads page-level metadata (Unit X, p.Y) from the image, proposes a book name candidate. User overrides via typing, cover photo upload, or voice — whichever is fastest. Default values are AI-generated; the user's job is correction, not authorship.

6. **Sharing = clone, not reference.** A share link clones the group subtree to the recipient's account. Items are globally shared (one row per `(type, text)`) so no item duplication occurs. Mastery never transfers between learners.

7. **Messiness is mitigated by display layer, not user discipline.** Recommendations filter by popularity + quality score. Lazy "aaa" groups exist but never surface in suggestions. Item-content preview (not name) is the primary identifier in suggestion UIs.

8. **Tag / pgvector / Topic systems deferred out of V1.** CEFR level + part-of-speech are sufficient ground truth. Re-evaluate when real user volume justifies richer semantics.

9. **History is a query view, not a separate table.** `session + turn + learner_item_stats + session_error` cover all history needs. No `learner_lesson` / `learner_group_history` aggregation table; queries on `session` are fine at V1 scale.

---

## 3. Schema

All tables inherit `TimestampMixin` (`created_at`, `updated_at`). All PKs are UUID generated in the application layer.

### 3.1 The atom

```
language_item
  id            UUID PK
  type          VARCHAR(10)    -- word | phrase | pattern
  text          VARCHAR(200)
  anchor        VARCHAR(200)   -- lowercase fixed substring for pattern matching
  cefr_level    VARCHAR(4) NULL    -- A1 | A2 | B1 | B2 | C1 | C2
  pos           VARCHAR(20) NULL   -- noun | verb | adj | adv | prep | ...

  UNIQUE (type, text)
```

### 3.2 The organizing entity

```
item_group
  id                UUID PK
  parent_id         UUID NULL    FK self → item_group   ON DELETE CASCADE
  kind              VARCHAR(30)
    -- textbook_book | textbook_unit | textbook_lesson
    -- | personal_collection | quick_practice | review_set
  name              VARCHAR(200)
  owner_account_id  UUID         FK → account            ON DELETE CASCADE

  cover_image_url   VARCHAR(500) NULL   -- meaningful for textbook_book
  prompt_notes      TEXT NULL           -- grammar / focus instructions for system prompt
  source_book_hint  VARCHAR(200) NULL   -- AI-extracted or user-declared; aids V2 matching
```

```
item_group_member
  group_id  UUID  FK → item_group     ON DELETE CASCADE
  item_id   UUID  FK → language_item  ON DELETE CASCADE
  PK (group_id, item_id)
```

### 3.3 Sharing

```
group_share_link
  id          UUID PK
  group_id    UUID            FK → item_group  ON DELETE CASCADE
  code        VARCHAR(32) UNIQUE
  created_by  UUID            FK → account
  expires_at  TIMESTAMP NULL
```

```
group_adoption
  source_group_id  UUID  FK → item_group  ON DELETE SET NULL
  target_group_id  UUID  FK → item_group  ON DELETE CASCADE  -- the clone
  adopted_by       UUID  FK → account
  PK (source_group_id, target_group_id)
```

Adoption rows accumulate to compute quality scores (clones per source) for V2 recommendation surfacing.

### 3.4 Mastery

```
learner_item_stats
  learner_id     UUID         FK → learner        ON DELETE CASCADE
  item_id        UUID         FK → language_item  ON DELETE CASCADE
  seen_count     INTEGER  DEFAULT 0
  used_count     INTEGER  DEFAULT 0
  correct_count  INTEGER  DEFAULT 0
  last_seen      TIMESTAMP NULL
  mastered_at    TIMESTAMP NULL    -- first time threshold crossed
  PK (learner_id, item_id)
```

Mastery threshold: V1 starting point `correct_count >= 3 AND used_count >= 3 across >= 2 distinct sessions`. Refine after real data.

### 3.5 Session linkage

```
session  (existing table — add one field)
  group_id  UUID NULL  FK → item_group  ON DELETE SET NULL
            -- NULL = free practice (scope = items the learner has previously seen)
```

### 3.6 Error collection

```
session_error
  id                UUID PK
  session_id        UUID         FK → session  ON DELETE CASCADE
  learner_id        UUID         FK → learner  ON DELETE CASCADE
  error_type        VARCHAR(40)
    -- article | tense | agreement | preposition | word_order | ...
  excerpt           TEXT         -- child's actual phrase
  correction        TEXT         -- correct version
  rule_explanation  TEXT NULL
```

V1: collect only. V2: display in parent report UI.

---

## 4. Ingestion flow (three maturity tiers)

### V1 — single account, own materials

```
Upload photos OR paste text
  ↓
AI vision call extracts:
  - language items: { text, type, anchor, cefr_level, pos }
  - page-level metadata if visible: { unit_name, page_number, lesson_hint }
  - book-name candidate if cover detected
  ↓
System checks within this account's existing books:
  - source_book_hint or extracted book name matches existing book?  → propose attach
  - else                                                            → propose new book
  ↓
User confirms or overrides (type / scan cover / voice)
  ↓
Persist:
  - language_item rows (insert or link via UNIQUE constraint)
  - item_group tree (create or extend; respect parent_id)
  - item_group_member M2M rows
```

### V2 — cross-account fingerprint matching

Adds: when items overlap ≥ threshold with any existing group across all accounts, surface the top N matches sorted by adoption count. User clicks "use ParentA's version" → clone via share link mechanism.

### V3 — canonical emergence

Adds: groups with high adoption + high name quality + recent activity flagged as "community canonical" and surfaced first in recommendations. Optional manual merge tooling for near-duplicates.

---

## 5. Sharing model

```
1. Owner generates a group_share_link (any group, any kind)
2. Recipient opens link → server clones the subtree:
     - new item_group rows under recipient's account (new IDs)
     - item_group_member rows reference the same global language_item rows
     - recursive clone for descendant groups
     - group_adoption row written (source → target)
3. Recipient can rename / reorganize freely; source is unaffected
4. Mastery never copies; recipient starts fresh on each item
```

V1: clone-on-adopt only. Source edits never propagate to clones. Diverging copies are an accepted side effect.

---

## 6. History views (all derivable from existing tables)

| View | Query sketch |
|---|---|
| Recent sessions | `SELECT * FROM session WHERE learner_id ORDER BY started_at DESC LIMIT N` |
| Groups practiced | `SELECT DISTINCT group_id, MAX(started_at) FROM session WHERE learner_id GROUP BY group_id` |
| Vocabulary mastered this week | `COUNT(*) FROM learner_item_stats WHERE learner_id AND mastered_at > date_trunc('week', now())` |
| Total practice time | `SUM(ended_at - started_at) FROM session WHERE learner_id` |
| Error pattern frequency | `SELECT error_type, COUNT(*) FROM session_error WHERE learner_id GROUP BY error_type` |
| CEFR level progress | `JOIN learner_item_stats × language_item GROUP BY cefr_level` |
| Conversation replay | `SELECT * FROM turn WHERE session_id ORDER BY sequence` |

Two UIs, same data:
- **Learner-facing:** calendar heatmap, streaks, badges, new words mastered
- **Parent-facing:** error trends, CEFR progression chart, vocab growth curve

---

## 7. V1 scope cut

| In V1 | Deferred |
|---|---|
| `language_item` with CEFR + POS auto-tag at ingest | Topic tags |
| `item_group` with `parent_id` hierarchy | Embedding-based similarity (pgvector) |
| Account-scoped book matching at ingest | Cross-account matching |
| One-time book declaration UX (cover photo / type / voice) | Community canonical groups |
| Mastery via end-of-session LLM analysis call | Per-turn micro-mastery updates |
| `session_error` data collection | Error display UI |
| Group cloning via share link | Public discovery / browse |
| Learner-facing history (basic) | Parent analytics dashboard |

---

## 8. Migration from current state

Current uncommitted state has parallel `Curriculum / CurriculumUnit / CurriculumLesson / LessonItem / LearnerLesson / Collection / CollectionItem` tables. Approach: full rebuild — no production data, nothing to preserve.

**Delete:**
- `backend/app/storage/models/curriculum.py`
- `backend/app/storage/models/collection.py`
- `backend/alembic/versions/bc83439525f9_add_collection_tables.py`
- `backend/app/api/collection.py`
- `backend/app/api/ingestion.py` (current draft)
- `backend/app/api/curriculum.py`
- Uncommitted frontend ingest / collections UI

**Create:**
- `backend/app/storage/models/content.py` — `LanguageItem`, `ItemGroup`, `ItemGroupMember`
- `backend/app/storage/models/learning.py` — `LearnerItemStats`, `SessionError`
- `backend/app/storage/models/sharing.py` — `GroupShareLink`, `GroupAdoption`
- New alembic migration: full schema per §3
- New `backend/app/api/ingest.py` — unified upload → extract → save flow
- New `backend/app/api/groups.py` — CRUD over item_group tree
- Rewire `backend/app/core/scope/v1.py` to query item_group + item_group_member
- Add `cefr_level` / `pos` extraction to the ingestion LLM prompt

---

## 9. Open questions

- **Mastery threshold tuning.** Starting point `correct_count >= 3 AND used_count >= 3 across >= 2 sessions`. Validate from real data.
- **Cover image storage.** TOS bucket vs. local for V1 dev?
- **Voice input for book declaration.** Worth the STT round-trip cost on a one-time-per-book input?
- **Group adoption update semantics.** V1: never propagate source → clone. V2: TBD; likely still never to preserve clone autonomy.
- **Unsubscribe from a group.** Soft-delete (`kind='archived'`)? Hard cascade? Probably soft-delete to preserve mastery history.
- **Free-practice scope cap.** When `session.group_id IS NULL`, items pool could grow unbounded over time. Need a cap (most recent N items? items seen in last 30 days?) before prompt-caching breaks.
- **`session_error` rule_id linkage.** Defer the `grammar_rule` table to V2; V1 stores `error_type` + free-text explanation only.
