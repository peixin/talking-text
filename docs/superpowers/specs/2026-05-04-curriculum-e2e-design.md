# Curriculum End-to-End — Design Spec

**Date:** 2026-05-04  
**Scope:** Lesson-path only (Collection path deferred, schema left ready)  
**Goal:** Child can select a lesson, chat within its vocabulary/pattern scope, and see current lesson info on the chat page.

---

## What We Are Building

One end-to-end flow:

```
Parent sets up learner lessons (Learner home page)
  → Child opens chat → sees current lesson banner
  → Session created with lesson_id
  → Scope Computer loads items + prompt_notes + focus_instructions
  → Orchestrator builds system prompt with scope
  → Child chats; Tina uses the lesson's vocabulary and patterns
```

Mastery tracking (end-of-session LLM analysis) is **out of scope** for this milestone. `learner_item_stats` table is created but not written to.

---

## Layer 1: Database

### New tables (7)

**`language_item`**
```
id      UUID PK
type    VARCHAR(10)        -- "word" | "phrase" | "pattern"
text    VARCHAR(200)
anchor  VARCHAR(200)       -- lowercase fixed substring for detection
UNIQUE (type, text)
```

**`curriculum`**
```
id                UUID PK
name              VARCHAR(200)
publisher         VARCHAR(200) NULL
is_public         BOOLEAN DEFAULT FALSE
owner_account_id  UUID NULL   FK → account ON DELETE SET NULL
```

**`curriculum_unit`**
```
id              UUID PK
curriculum_id   UUID   FK → curriculum ON DELETE CASCADE
sequence        INTEGER
unit_number     VARCHAR(50)
title           VARCHAR(200)
```

**`curriculum_lesson`**
```
id                  UUID PK
unit_id             UUID   FK → curriculum_unit ON DELETE CASCADE
sequence            INTEGER
title               VARCHAR(200) NULL
prompt_notes        TEXT NULL
focus_instructions  TEXT NULL
```

**`lesson_item`**
```
lesson_id   UUID   FK → curriculum_lesson ON DELETE CASCADE
item_id     UUID   FK → language_item ON DELETE CASCADE
PK (lesson_id, item_id)
```

**`learner_lesson`**
```
learner_id  UUID   FK → learner ON DELETE CASCADE
lesson_id   UUID   FK → curriculum_lesson ON DELETE CASCADE
PK (learner_id, lesson_id)
```

**`learner_item_stats`** *(schema only, not written in this milestone)*
```
learner_id     UUID   FK → learner ON DELETE CASCADE
item_id        UUID   FK → language_item ON DELETE CASCADE
seen_count     INTEGER DEFAULT 0
used_count     INTEGER DEFAULT 0
correct_count  INTEGER DEFAULT 0
last_seen      TIMESTAMP NULL
PK (learner_id, item_id)
```

### Existing table update

**`session`** — add two nullable columns:
```
lesson_id      UUID NULL   FK → curriculum_lesson ON DELETE SET NULL
collection_id  UUID NULL   FK → (future) ON DELETE SET NULL
```
Both are mutually exclusive. `collection_id` is added now but never set in this milestone.

### Seed script

`backend/scripts/seed_kids_corner_u4.py`

Inserts Kids Corner Book 1 → Starter Unit 4 → Lesson 1 + Lesson 2:

```
Lesson 1 (prompt_notes=NULL):
  words:    red, yellow, blue, green, orange, brown, pink, purple, black, white
  patterns: "What colors do you like?"  anchor="what colors do you like"
            "I like ___ and ___."       anchor="i like"

Lesson 2:
  prompt_notes:       "Use 'has' for he/she; 'an' before vowel sounds;
                       clothing nouns: singular vs plural."
  focus_instructions: "Topic: describing characters' colorful outfits.
                       Create scenarios with monsters or dress-up.
                       Ask: 'What is your monster wearing?'
                       Guide: 'He has a [color] [clothing].'
                       If child names item without color, prompt: 'What color is it?'"
  words:    dress, jacket, T-shirt, jeans, pants, skirt
  patterns: "He/She has a ___ ___."  anchor="has a"
```

Script is idempotent (upsert on UNIQUE constraint).

---

## Layer 2: Scope Computer (`core/scope/`)

### Protocol (`core/scope/protocol.py`)

```python
@dataclass
class PatternItem:
    text: str    # "I like ___ and ___."
    anchor: str  # "i like"

@dataclass
class ScopeResult:
    words: list[str]
    phrases: list[str]
    patterns: list[PatternItem]
    prompt_notes: str | None
    focus_instructions: str | None

    @property
    def is_empty(self) -> bool:
        return not self.words and not self.phrases and not self.patterns

class ScopeComputer(Protocol):
    async def get_scope(
        self,
        learner_id: UUID,
        lesson_id: UUID | None,
        collection_id: UUID | None,
    ) -> ScopeResult: ...
```

### V1 Implementation (`core/scope/v1.py`)

- `lesson_id` has value → query `lesson_item JOIN language_item` + read `prompt_notes` / `focus_instructions` from `curriculum_lesson`
- Both `None` → return empty `ScopeResult` (free chat, no scope injection)
- `collection_id` has value → raise `NotImplementedError` (placeholder, prevents accidental use)

Scope is fetched at the start of each `process_turn()` call using `session.lesson_id` — a single DB query per turn. The orchestrator is a shared singleton; scope must be scoped to the session, not the instance. Query-level caching is a V2 concern.

---

## Layer 3: Prompt Assembler (`core/prompt/`)

### Interface (`core/prompt/assembler.py`)

Pure function, no IO:

```python
def build_system_prompt(scope: ScopeResult) -> str: ...
```

### Output structure

```
[Tina persona — always present]
You are Tina, a warm and patient English teacher chatting with an
elementary-school child in mainland China. Always respond in English.
Use simple, age-appropriate vocabulary and short sentences (≤ 15 words).
If the child speaks Chinese, gently re-phrase their idea in English and
invite them to repeat it. Stay encouraging; never correct mistakes harshly.
Each turn, ask exactly one short follow-up question to keep the conversation going.

[Vocabulary section — only when scope has words/phrases]
The child has learned these words and phrases. Use them naturally in conversation.
Do not introduce vocabulary outside this list (one or two new words per session is fine):
  Words: red, yellow, blue, dress, jacket, T-shirt, ...
  Phrases: draw and color, show me your picture

[Patterns section — only when scope has patterns]
Practice these sentence patterns today. Guide the child to use them:
  • "What colors do you like?" — ask this early; invite the child to answer
  • "I like ___ and ___." — encourage the child to fill in colors
  • "He/She has a ___ ___." — use when describing characters or pictures

[Grammar notes — only when prompt_notes is set]
Grammar notes (apply gently, do not correct harshly):
  Use 'has' for he/she; 'an' before vowel sounds; clothing nouns: singular vs plural.

[Focus instructions — only when focus_instructions is set]
Today's practice focus:
  Topic: describing characters' colorful outfits. Create scenarios with monsters or
  dress-up. Ask: "What is your monster wearing?" ...
```

When `scope.is_empty` → returns the Tina persona block only (identical to current hardcoded prompt).

### Orchestrator wiring

`DialogOrchestrator`:
- Constructor accepts `ScopeComputer` (injected via factory)
- Each `process_turn()` call: fetches `session.lesson_id` from DB, calls `scope_computer.get_scope(...)`, passes result to `build_system_prompt()`
- Result is NOT cached on the orchestrator instance (orchestrator is a shared singleton)

---

## Layer 4: Backend API

### New router: `app/api/curriculum.py`

```
GET  /curricula
     Response: [{ id, name, publisher }]
     Filter: is_public=true only

GET  /curricula/{curriculum_id}/lessons
     Response: {
       curriculum: { id, name },
       units: [{
         id, unit_number, title, sequence,
         lessons: [{ id, sequence, title }]
       }]
     }

POST /learners/{learner_id}/lessons
     Body: { lesson_id: UUID }
     Auth: current account must own learner
     Behaviour: upsert — ignore if already exists
     Response: 204

DELETE /learners/{learner_id}/lessons/{lesson_id}
     Auth: current account must own learner
     Response: 204

GET  /learners/{learner_id}/lessons
     Auth: current account must own learner
     Response: [{
       lesson_id, lesson_title, lesson_sequence,
       unit_number, unit_title,
       curriculum_name,
       added_at     -- learner_lesson.created_at
     }]
     Order: added_at DESC
```

### Updated: `POST /sessions`

Add optional field `lesson_id: UUID | None = None` to request body.  
Write to `session.lesson_id`. `collection_id` column exists in DB but is not accepted by this endpoint yet.

### Auth pattern

All `/learners/{learner_id}/...` endpoints: query learner by id, verify `learner.account_id == current_account.id`, raise 403 otherwise. Extract into a shared `get_learner_for_account()` dependency.

---

## Layer 5: Frontend

### New shadcn components to install

```bash
pnpm dlx shadcn@latest add dialog badge card collapsible checkbox separator
```

### New page: Learner home

**File:** `frontend/app/[locale]/(app)/learner/[id]/page.tsx` (Server Component shell)  
**File:** `frontend/app/[locale]/(app)/learner/[id]/LearnerHomeClient.tsx`

Layout:
```
┌─────────────────────────────────────┐
│  [child name]                        │
│                                      │
│  Lessons                        [+] │
│  ┌───────────────────────────────┐  │
│  │ Kids Corner Book 1            │  │
│  │   Starter Unit 4              │  │
│  │     ✓ Lesson 1   ✓ Lesson 2  │  │
│  └───────────────────────────────┘  │
│                                      │
│         [Start Practice →]           │
└─────────────────────────────────────┘
```

- `[+]` opens `LessonPickerClient` dialog
- `[Start Practice →]` navigates to `/[locale]/(app)/chat/[learner_id]` with the most recently added `lesson_id` as a query param (or stored in a cookie)
- Lesson rows have a remove button (calls DELETE endpoint)

### Updated: Chat page

**File:** `frontend/app/[locale]/(app)/chat/[learner_id]/ChatClient.tsx` (existing, extend)  
**New file:** `frontend/components/LessonBannerClient.tsx`

Banner above the conversation area:
```
┌──────────────────────────────────────────┐
│ 📚 Starter Unit 4 · Lesson 2   [Switch] │
│    10 words · 1 pattern                  │
└──────────────────────────────────────────┘
```

States:
- **Lesson selected:** shows curriculum name, unit, lesson, word count, pattern count
- **No lesson selected:** shows "Select today's lesson to start" — record button disabled until a lesson is picked
- `[Switch]` opens `LessonPickerClient` (filtered to learner's enrolled lessons)

Session creation: when the child presses record for the first time, `POST /sessions` is called with `lesson_id` from the banner state. The `lesson_id` is fixed for the lifetime of the session.

### New shared component: `LessonPickerClient.tsx`

Used by both learner home page and chat banner.

Two modes:
- **Enroll mode** (learner home): shows full public curriculum browser, multi-select, saves via POST
- **Switch mode** (chat banner): shows only learner's enrolled lessons, single-select

Internally uses `Collapsible` for the curriculum → unit → lesson tree.

### Data flow (frontend)

All backend calls go through `lib/backend.ts` (server-only). Learner home page fetches via Server Actions. Chat banner fetches enrolled lessons via a Server Action on mount; lesson switch is also a Server Action.

---

## Out of Scope (this milestone)

- Post-session mastery tracking (end-of-session LLM call + `learner_item_stats` writes)
- Collection / free practice path
- AI-powered curriculum ingestion pipeline
- Grammar error tracking and reporting UI
- Stretch vocabulary (Scope Computer V2)
