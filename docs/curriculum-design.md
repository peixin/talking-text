# Curriculum Design

> Design notes for the curriculum data model, mastery tracking, and Scope Computer integration.
> Chinese version: [`curriculum-design.cn.md`](curriculum-design.cn.md)

---

## 1. Product Vision

The product's core value is recognition first, then incremental stretch:

> "Hey, this is exactly what I learned in class today."

A child who hears familiar words and patterns gains confidence immediately. On top of that foundation, the system naturally introduces ~10% stretch vocabulary — words from the next lesson or unit — pushing the child's boundary outward one inch at a time, without leaving the comfort zone behind.

Free LLM tools (Doubao, etc.) cannot replicate this because they have no idea what the child studied. Our curriculum binding is the product moat.

The parent's cognitive load must be minimal. Most parents only know "we're on Unit 3." That is enough. The system derives the full vocabulary and grammar scope from that selection — the parent never needs to articulate learning objectives.

---

## 2. Resource Pools

### Public library
Maintained by the team. Structured around curriculum content that can be cleanly extracted without copyright risk. Parents select from this library to set their child's scope.

### Private materials
Uploaded by individual parents for personal use only. Supports the long tail of proprietary textbooks (training center materials, school-specific editions) that will never enter the public library. Terms of service make clear that the parent is responsible for the copyright compliance of anything they upload.

### Copyright strategy
Copyright does not protect facts or knowledge — it protects specific expression. Vocabulary words, grammar rules, and sentence pattern structures are not copyrightable. What must never be reproduced verbatim:

- Original stories, dialogues, or narrative text from textbooks
- Specific illustrations
- The textbook's name in product marketing without a license

**Safe approach for the public library:** extract vocabulary lists, sentence patterns, and grammar notes; do not quote original text; use neutral unit naming independent of publisher branding.

**Materials to avoid entirely:** digitally-delivered licensed content (e.g., LingoAce's Reach Higher sessions) — the parent does not hold a copy license.

---

## 3. The Atomic Unit: `language_item`

Every curriculum eventually decomposes into three types of language items:

| Type | Example | Detection |
|---|---|---|
| `word` | `apple`, `purple` | exact string match |
| `phrase` | `make a decision`, `by the way` | substring match |
| `pattern` | `I like ___ and ___.`, `There have been ___` | anchor substring + end-of-session LLM |

The curriculum hierarchy (Curriculum → Unit → Lesson) is purely an ingestion and organization structure. Once items are extracted and linked to a learner's scope, the hierarchy is no longer involved in the practice loop.

### Grammar notes are not items — but errors are prioritized

Grammar rules (e.g., "use `has` for third-person singular"; "use `an` before vowel sounds") are stored as free text in `CurriculumLesson.prompt_notes` and injected into the system prompt at session start.

Error correction follows a **priority mechanism** — not correcting everything, not ignoring everything:

- **Highest priority (must correct):** article errors (the + count noun, a/an selection) — these are persistent and high-frequency among Chinese learners; leaving them uncorrected lets them fossilize
- **Lower priority:** other grammar errors, surfaced gradually as they accumulate

**Correction is delayed** — never interrupting the child mid-expression. Feedback appears after the current turn ends or in the end-of-session report.

**V1 implementation:** the end-of-session LLM call also detects grammar errors; results are stored for future use. Data collection starts in V1.  
**V2 implementation:** report UI shows color-coded error levels (highest priority in a prominent color); click to see the rule explanation; proactively prompt the child once errors accumulate past a threshold.

---

## 4. Hierarchy: Why Lesson Is the Atomic Practice Unit

Real classroom data shows that every unit spans at least two lessons (often more), with distinct vocabulary and grammar focus per lesson:

```
Kids Corner Book 1 — Starter Unit 4
  Lesson 1 (4.19):  10 color words + 2 patterns, no grammar notes
  Lesson 2 (4.26):  6 clothing words + 1 pattern, 3 grammar notes
```

A unit-level scope would be too broad — it combines vocabulary and grammar from different class sessions. Lesson-level scope lets the child practice exactly what they learned in today's class.

```
Curriculum
  └── CurriculumUnit        (grouping / display)
        └── CurriculumLesson  (practice atom)
              └── LessonItem → LanguageItem
```

---

## 5. Database Schema

All models inherit `TimestampMixin` (`created_at`, `updated_at`). All primary keys are UUID generated in the application layer.

### `language_item`
Global catalog of all words, phrases, and patterns. Shared across curricula. No `level` field — the same word appears at different difficulty levels in different courses; level is a property of the lesson context, not the item itself.

```
id      UUID PK
type    VARCHAR(10)   -- "word" | "phrase" | "pattern"
text    VARCHAR(200)  -- "apple" / "make a decision" / "I like ___ and ___."
anchor  VARCHAR(200)  -- lowercase fixed substring for fast detection
                      -- anchor for "I like ___ and ___." = "i like"

UNIQUE (type, text)
```

### `curriculum`

```
id                 UUID PK
name               VARCHAR(200)   -- "Kids Corner Book 1"
publisher          VARCHAR(200)
is_public          BOOLEAN DEFAULT FALSE
owner_account_id   UUID NULL      -- NULL = public library
                                  -- FK → account  ON DELETE SET NULL
```

### `curriculum_unit`

```
id               UUID PK
curriculum_id    UUID    FK → curriculum  ON DELETE CASCADE
sequence         INTEGER
unit_number      VARCHAR(50)   -- "Starter Unit 4"  (flexible, not integer)
title            VARCHAR(200)  -- "A New Adventure"
```

### `curriculum_lesson`
The practice atom. Holds grammar notes for system prompt injection.

```
id             UUID PK
unit_id        UUID     FK → curriculum_unit  ON DELETE CASCADE
sequence       INTEGER
title          VARCHAR(200) NULL  -- "Lesson 1" or more descriptive title
prompt_notes   TEXT NULL          -- grammar notes injected into session system prompt
```

### `lesson_item`
Many-to-many join between lessons and language items.

```
lesson_id   UUID    FK → curriculum_lesson  ON DELETE CASCADE
item_id     UUID    FK → language_item      ON DELETE CASCADE

PK (lesson_id, item_id)
```

### `learner_lesson`
Append-only log of lessons the learner has studied. Grows continuously as the child attends classes; rows are never deleted unless the parent explicitly un-enrolls from a curriculum. `created_at` from `TimestampMixin` serves as the enrollment timestamp.

```
learner_id   UUID   FK → learner            ON DELETE CASCADE
lesson_id    UUID   FK → curriculum_lesson  ON DELETE CASCADE

PK (learner_id, lesson_id)
```

### `learner_item_stats`
Mastery tracking. A row is created only on first encounter (not pre-populated at enrollment). A missing row means the item has never appeared in a session.

```
learner_id      UUID       FK → learner        ON DELETE CASCADE
item_id         UUID       FK → language_item  ON DELETE CASCADE
seen_count      INTEGER DEFAULT 0   -- item appeared in session context
used_count      INTEGER DEFAULT 0   -- child produced the item in speech
correct_count   INTEGER DEFAULT 0   -- LLM judged usage correct
last_seen       TIMESTAMP NULL

PK (learner_id, item_id)
```

### `session` (existing table — add one field)

```
lesson_id   UUID NULL   FK → curriculum_lesson  ON DELETE SET NULL
                        -- NULL = free practice (no curriculum scope)
```

---

## 6. Two Binding Layers

```
Layer 1 — Studied lessons (append-only log, grows with each class)
  LearnerLesson: learner_id + lesson_id
  "This child has studied Kids Corner Book 1, Lessons 1 and 2."

Layer 2 — Session focus (chosen at session start)
  session.lesson_id
  "This session is practicing Lesson 2 specifically."
```

When starting a session, the UI presents recently studied lessons as quick shortcuts with the newest lesson selected by default. The child can also select older lessons to review. The Scope Computer reads `session.lesson_id` to fetch items for the active session. `LearnerLesson` is used to display the child's study history and overall progress.

---

## 7. Scope Computer Query

**Session with lesson binding:**

```sql
SELECT li.*
FROM   language_item    li
JOIN   lesson_item      lsi ON lsi.item_id  = li.id
WHERE  lsi.lesson_id = :session_lesson_id
LEFT JOIN learner_item_stats s
  ON s.item_id = li.id AND s.learner_id = :learner_id
ORDER BY COALESCE(s.correct_count, 0) ASC,
         COALESCE(s.seen_count, 0)    ASC
-- Weakest items surface first
```

**Free practice (`session.lesson_id = NULL`):** scope = all items from all lessons the learner has ever studied

```sql
SELECT DISTINCT li.*
FROM   language_item li
JOIN   lesson_item   lsi ON lsi.item_id  = li.id
JOIN   learner_lesson ll  ON ll.lesson_id = lsi.lesson_id
WHERE  ll.learner_id = :learner_id
LEFT JOIN learner_item_stats s
  ON s.item_id = li.id AND s.learner_id = :learner_id
ORDER BY COALESCE(s.correct_count, 0) ASC,
         COALESCE(s.seen_count, 0)    ASC
```

Free practice has no `prompt_notes` injection and no targeted pattern focus, but mastery data is updated normally.

`prompt_notes` for sessions with a lesson binding:
```sql
SELECT prompt_notes
FROM   curriculum_lesson
WHERE  id = :session_lesson_id
  AND  prompt_notes IS NOT NULL
```

---

## 8. Pattern Detection Strategy

Detecting whether a child used a specific pattern cannot rely on string matching alone. The approach uses two tiers:

**Tier 1 — Anchor match (real-time, zero cost)**
Each pattern stores a lowercase `anchor` (the fixed part). After STT, check whether the child's transcript contains the anchor substring. This records "item appeared."

**Tier 2 — LLM analysis (end of session, one call)**
At session end, send the full conversation transcript with the target patterns list to the LLM. Ask: "Did the child use each pattern? Was each usage correct?" Also detect grammar errors by priority category. Update `used_count` and `correct_count` in `learner_item_stats`.

One LLM call per session — not per turn. Sessions are typically 5–15 minutes; the cost is acceptable and the analysis is non-blocking.

---

## 9. Session Flow with Curriculum

```
Parent adds completed lesson to child's record
  → LearnerLesson row appended (one row per lesson attended)

Child opens practice screen
  → UI shows recently studied lessons, newest selected by default
  → Session created with lesson_id (or NULL for free practice)

Session start
  → Scope Computer loads lesson items + prompt_notes
  → system prompt assembled:
      "Vocabulary in scope: red, yellow, blue... dress, jacket..."
      "Encourage use of patterns: 'What colors do you like?', 'I like ___ and ___'"
      "Grammar notes: use 'has' for he/she; use 'an' before vowel sounds"

Each turn (real-time)
  → STT → LLM → TTS
  → Anchor scan on child's transcript → update seen_count immediately

Session end (async, non-blocking)
  → One LLM analysis call on full transcript
  → Upsert learner_item_stats (correct_count, used_count, last_seen)
  → Record grammar error data (V1: collect only; V2: display in report UI)
```

---

## 10. Kids Corner Book 1 — Starter Unit 4 (Reference Data)

The first dataset to enter the public library. Maps to the schema as:

```
curriculum:  Kids Corner Book 1  (is_public=true)
  unit:      Starter Unit 4 / "A New Adventure"  (sequence=4)

    lesson:  Lesson 1  (sequence=1, prompt_notes=NULL)
      words: red, yellow, blue, green, orange, brown,
             pink, purple, black, white
      patterns:
        "What colors do you like?"   anchor="what colors do you like"
        "I like ___ and ___."        anchor="i like"

    lesson:  Lesson 2  (sequence=2)
      prompt_notes: |
        Use 'has' for he/she (third person singular); 'have' for I/you/they.
        Clothing nouns: singular vs plural (a jacket / two jackets).
        'an' before vowel sounds: an orange T-shirt, an orange skirt.
      words: dress, jacket, T-shirt, jeans, pants, skirt
      patterns:
        "He/She has a ___ ___."      anchor="has a"
```

---

## 11. Open Questions

- **Public library seeding:** Which textbooks to cover first? Suggested priority: PEP (人教版) Grade 1–3, then Kids Corner series, then others driven by user demand.
- **Private upload pipeline:** Photo OCR → AI extraction → parent review → LessonItem rows. The teacher's WeChat lesson summary (plain text) is a better input than a raw book photo — consider making "paste teacher's message" the primary private upload UX.
- **Stretch vocabulary source:** When Scope Computer V2 introduces stretch words, where do they come from? The next unlearned lesson? Other lessons in the same unit? Needs definition at V2 design time.
- **Grammar rule priority table:** V2 color-coded error display requires a `grammar_rule` table (rule name, priority, error pattern description). High-priority rules (article errors) can begin data collection in V1.
- **Mastery definition:** What threshold marks an item as "mastered"? Not defined yet. Suggested starting point: `correct_count >= 3` across at least 2 separate sessions.
- **IELTS / adult content:** The `language_item` model supports adult-level patterns and argument phrases. Discourse strategies (methodology layer) are out of scope for V1 and would require a separate `speaking_methodology` model.
