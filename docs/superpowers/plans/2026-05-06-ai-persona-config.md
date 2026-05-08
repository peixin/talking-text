# AI Persona Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parents can configure the AI tutor's name, gender, and persona prompt per learner; the learner's real name is injected into every conversation so the AI addresses the child personally.

**Architecture:** Three new columns on `learner` (`ai_name`, `ai_gender`, `ai_persona_prompt`). The prompt assembler gains optional `persona_prompt` and `learner_name` parameters; the orchestrator fetches both from the `Learner` row per turn. A `POST /learners/{id}/persona/sync` endpoint uses the LLM to keep name/gender/prompt bidirectionally consistent. The frontend adds a collapsible "AI Settings" section on the learner home page with debounced sync.

**Tech Stack:** SQLAlchemy 2.0 async, Alembic, FastAPI, Pydantic v2, Next.js App Router, React 19, Tailwind v4, shadcn/ui

---

## File Structure

**Backend — modified:**
- `backend/app/storage/models/learner.py` — add `ai_name`, `ai_gender`, `ai_persona_prompt` columns
- `backend/alembic/versions/<hash>_add_learner_persona.py` — migration (auto-generated)
- `backend/app/core/prompt/assembler.py` — add `persona_prompt` + `learner_name` params to `build_system_prompt`
- `backend/app/core/dialog/orchestrator.py` — fetch learner row, pass persona + name to assembler
- `backend/app/api/learner.py` — update `LearnerOut`/`LearnerUpdate`; add `PATCH /learners/{id}/persona` and `POST /learners/{id}/persona/sync`
- `backend/tests/test_prompt_assembler.py` — extend with persona + learner_name tests

**Frontend — modified:**
- `frontend/lib/backend.ts` — add persona fields to `LearnerOut`; add `updatePersona`, `syncPersona`
- `frontend/lib/api.ts` — add `updatePersona`, `syncPersona` wrappers
- `frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts` — add `updatePersona`, `syncPersona` server actions
- `frontend/app/[locale]/(app)/learner/[learnerId]/page.tsx` — pass `learner.ai_name/ai_gender/ai_persona_prompt` to client
- `frontend/app/[locale]/(app)/learner/[learnerId]/LearnerHomeClient.tsx` — add `AIPersonaSettings` section

**Frontend — created:**
- `frontend/components/AIPersonaSettingsClient.tsx` — collapsible form: name input, gender radio, prompt textarea, debounced sync

---

### Task 1: DB — Add persona columns to Learner + Migration

**Files:**
- Modify: `backend/app/storage/models/learner.py`
- Create: `backend/alembic/versions/<hash>_add_learner_persona.py` (auto-generated)

> No unit test for pure migration. Verification is running `just db-up` and checking `\d learner` in psql.

- [ ] **Step 1: Add three columns to the Learner model**

Edit `backend/app/storage/models/learner.py` — final file:

```python
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.storage.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.storage.models.account import Account


class Learner(Base, TimestampMixin):
    __tablename__ = "learner"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("account.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    ai_name: Mapped[str] = mapped_column(String(100), nullable=False, server_default="Tina")
    ai_gender: Mapped[str] = mapped_column(String(10), nullable=False, server_default="female")
    ai_persona_prompt: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    account: Mapped[Account] = relationship(
        "Account", back_populates="learners", foreign_keys=[account_id]
    )
```

- [ ] **Step 2: Generate the migration**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text
just migrate "add learner persona"
```

Expected: a new file appears in `backend/alembic/versions/` with `add_learner_persona` in the name.

- [ ] **Step 3: Verify the migration looks correct**

Open the generated file. It should have `op.add_column("learner", ...)` three times for `ai_name`, `ai_gender`, `ai_persona_prompt`. Confirm `server_default` values are present for `ai_name` and `ai_gender`.

- [ ] **Step 4: Apply the migration**

```bash
just db-up
```

Expected: `INFO  [alembic.runtime.migration] Running upgrade ... -> <hash>, add learner persona`

- [ ] **Step 5: Commit**

```bash
git add backend/app/storage/models/learner.py backend/alembic/versions/
git commit -m "feat: add ai_name/ai_gender/ai_persona_prompt to learner"
```

---

### Task 2: Backend — Update Prompt Assembler

**Files:**
- Modify: `backend/app/core/prompt/assembler.py`
- Modify: `backend/tests/test_prompt_assembler.py`

- [ ] **Step 1: Write the new tests first**

Append to `backend/tests/test_prompt_assembler.py`:

```python
def test_custom_persona_prompt_replaces_tina_persona():
    scope = ScopeResult()
    result = build_system_prompt(scope, persona_prompt="You are Bob, a friendly tutor.")
    assert result == "You are Bob, a friendly tutor."
    assert "Tina" not in result


def test_learner_name_injected_after_persona():
    scope = ScopeResult()
    result = build_system_prompt(scope, learner_name="Emma")
    assert "Emma" in result
    persona_pos = result.index(_TINA_PERSONA)
    name_pos = result.index("Emma")
    assert name_pos > persona_pos


def test_learner_name_with_custom_persona():
    scope = ScopeResult(words=["red"])
    result = build_system_prompt(
        scope,
        persona_prompt="You are Lily, a kind teacher.",
        learner_name="Tom",
    )
    assert "Lily" in result
    assert "Tom" in result
    assert "red" in result


def test_no_learner_name_no_name_section():
    scope = ScopeResult()
    result = build_system_prompt(scope)
    assert "child's name is" not in result


def test_custom_persona_with_scope():
    scope = ScopeResult(words=["blue"], patterns=[PatternItem("I see ___.", "i see")])
    result = build_system_prompt(
        scope,
        persona_prompt="You are Max, a cool teacher.",
        learner_name="Lily",
    )
    assert "You are Max" in result
    assert "Lily" in result
    assert "blue" in result
    assert '"I see ___."' in result
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/backend
poetry run pytest tests/test_prompt_assembler.py -v -k "custom_persona or learner_name or no_learner_name"
```

Expected: 5 FAILED (function signature mismatch).

- [ ] **Step 3: Update the assembler implementation**

Replace `backend/app/core/prompt/assembler.py` entirely:

```python
"""Build the LLM system prompt from a ScopeResult.

Pure function — no I/O. The output is a multi-section string that is passed
as the ``system`` message to the LLM. Each section is only included when its
data is present, so the empty-scope case degrades to the plain Tina persona.
"""

from __future__ import annotations

from app.core.scope.protocol import ScopeResult

_TINA_PERSONA = (
    "You are Tina, a warm and patient English teacher chatting with an "
    "elementary-school child in mainland China. Always respond in English. "
    "Use simple, age-appropriate vocabulary and short sentences (≤ 15 words). "
    "If the child speaks Chinese, gently re-phrase their idea in English and "
    "invite them to repeat it. Stay encouraging; never correct mistakes "
    "harshly. Each turn, ask exactly one short follow-up question to keep "
    "the conversation going."
)


def build_system_prompt(
    scope: ScopeResult,
    persona_prompt: str = _TINA_PERSONA,
    learner_name: str | None = None,
) -> str:
    """Return the full system prompt string for a session."""
    sections: list[str] = [persona_prompt]

    if learner_name:
        sections.append(
            f"The child's name is {learner_name}. "
            "Use their name naturally in conversation to make it feel warm and personal."
        )

    if scope.words or scope.phrases:
        vocab_lines: list[str] = []
        if scope.words:
            vocab_lines.append(f"Words: {', '.join(scope.words)}")
        if scope.phrases:
            vocab_lines.append(f"Phrases: {', '.join(scope.phrases)}")
        sections.append(
            "The child has learned these vocabulary items. Use them naturally in "
            "conversation. Do not introduce vocabulary outside this list "
            "(one or two new words per session is fine):\n" + "\n".join(vocab_lines)
        )

    if scope.patterns:
        pattern_lines = "\n".join(f'  • "{p.text}"' for p in scope.patterns)
        sections.append(
            "Practice these sentence patterns today. "
            "Guide the child to use them:\n" + pattern_lines
        )

    if scope.prompt_notes:
        sections.append(
            "Grammar notes (apply gently, never correct harshly):\n" + scope.prompt_notes
        )

    if scope.focus_instructions:
        sections.append("Today's practice focus:\n" + scope.focus_instructions)

    return "\n\n".join(sections)
```

- [ ] **Step 4: Run all assembler tests**

```bash
poetry run pytest tests/test_prompt_assembler.py -v
```

Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/prompt/assembler.py backend/tests/test_prompt_assembler.py
git commit -m "feat: build_system_prompt accepts persona_prompt and learner_name"
```

---

### Task 3: Backend — Orchestrator Passes Persona + Learner Name

**Files:**
- Modify: `backend/app/core/dialog/orchestrator.py`

The current `_resolve_system_prompt` queries only the `Session` row. It needs to also query the `Learner` row to get `learner.name`, `learner.ai_persona_prompt`. The `learner_id` is already a parameter.

- [ ] **Step 1: Update the import block**

At the top of `orchestrator.py`, add the `Learner` import. Existing imports already have `Session` and `Turn`; add `Learner`:

```python
from app.storage.models.learner import Learner
from app.storage.models.session import Session
from app.storage.models.turn import Turn
```

Also add `build_system_prompt`'s default constant import (it's already imported as `build_system_prompt`). Add the `_TINA_PERSONA` import:

```python
from app.core.prompt import build_system_prompt, _TINA_PERSONA
```

- [ ] **Step 2: Update `_resolve_system_prompt`**

Replace the existing `_resolve_system_prompt` method body:

```python
async def _resolve_system_prompt(
    self,
    db: AsyncSession,
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
) -> str:
    """Fetch session lesson binding and learner persona, then build the system prompt."""
    session_row = await db.execute(select(Session).where(Session.id == session_id))
    session = session_row.scalar_one_or_none()
    lesson_id = session.lesson_id if session else None
    collection_id = session.collection_id if session else None

    learner_row = await db.execute(select(Learner).where(Learner.id == learner_id))
    learner = learner_row.scalar_one_or_none()
    learner_name = learner.name if learner else None
    persona_prompt = (learner.ai_persona_prompt if learner else None) or _TINA_PERSONA

    scope = await self._scope.get_scope(db, learner_id, lesson_id, collection_id)
    return build_system_prompt(scope, persona_prompt=persona_prompt, learner_name=learner_name)
```

- [ ] **Step 3: Update `__init__.py` to also export `_TINA_PERSONA`**

`backend/app/core/prompt/__init__.py` currently contains only:
```python
from app.core.prompt.assembler import build_system_prompt

__all__ = ["build_system_prompt"]
```

Replace it with:
```python
from app.core.prompt.assembler import _TINA_PERSONA, build_system_prompt

__all__ = ["_TINA_PERSONA", "build_system_prompt"]
```

- [ ] **Step 4: Lint check**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/backend
poetry run ruff check app/core/dialog/orchestrator.py app/core/prompt/__init__.py
```

Expected: `All checks passed!`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/dialog/orchestrator.py backend/app/core/prompt/__init__.py
git commit -m "feat: inject learner name and persona prompt into system prompt per turn"
```

---

### Task 4: Backend — Learner Persona API

**Files:**
- Modify: `backend/app/api/learner.py`

Add three things:
1. Update `LearnerOut` to include persona fields
2. Add `PATCH /learners/{id}/persona` for direct field updates (saves immediately, no LLM)
3. Add `POST /learners/{id}/persona/sync` which sends all three fields to the LLM, reconciles them, saves, and returns the updated learner

- [ ] **Step 1: Update `LearnerOut` and add new schemas**

At the top of `backend/app/api/learner.py`, add imports:

```python
import json

from app.adapters.factory import llm
from app.adapters.llm.protocol import LLMMessage
```

Update `LearnerOut`:

```python
class LearnerOut(BaseModel):
    id: uuid.UUID
    name: str
    ai_name: str
    ai_gender: str
    ai_persona_prompt: str | None
```

Add new schemas after existing ones:

```python
class UpdatePersonaBody(BaseModel):
    ai_name: str | None = None
    ai_gender: str | None = None
    ai_persona_prompt: str | None = None


class SyncPersonaBody(BaseModel):
    ai_name: str
    ai_gender: str
    ai_persona_prompt: str


class PersonaSyncOut(BaseModel):
    ai_name: str
    ai_gender: str
    ai_persona_prompt: str
```

- [ ] **Step 2: Update `LearnerOut` construction everywhere in `learner.py`**

The file constructs `LearnerOut(id=..., name=...)` in three places. Update all of them to include persona fields. Add a helper at module level to avoid repetition:

```python
def _learner_out(l: Learner) -> LearnerOut:
    return LearnerOut(
        id=l.id,
        name=l.name,
        ai_name=l.ai_name,
        ai_gender=l.ai_gender,
        ai_persona_prompt=l.ai_persona_prompt,
    )
```

Replace all `LearnerOut(id=l.id, name=l.name)` occurrences with `_learner_out(l)`.

- [ ] **Step 3: Add `PATCH /learners/{id}/persona` endpoint**

```python
@router.patch("/{learner_id}/persona")
async def update_persona(
    learner_id: uuid.UUID,
    body: UpdatePersonaBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = result.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    if body.ai_name is not None:
        learner.ai_name = body.ai_name
    if body.ai_gender is not None:
        learner.ai_gender = body.ai_gender
    if body.ai_persona_prompt is not None:
        learner.ai_persona_prompt = body.ai_persona_prompt

    await db.commit()
    await db.refresh(learner)
    return _learner_out(learner)
```

- [ ] **Step 4: Add `POST /learners/{id}/persona/sync` endpoint**

```python
_SYNC_PROMPT = """\
You help parents customize an AI tutor persona for a children's English learning app.

Given:
- AI name: {name}
- AI gender: {gender}  (options: female / male / neutral)
- Persona prompt: {prompt}

Task: Return a JSON object with exactly three keys: "ai_name", "ai_gender", "ai_persona_prompt".

Rules:
1. The name used inside the prompt must match the given AI name. Update if they differ.
2. Gender pronouns in the prompt must match the given gender. Update if they differ.
3. If the prompt does not mention gender pronouns at all, append the appropriate sentence:
   - female → "She uses she/her pronouns."
   - male   → "He uses he/him pronouns."
   - neutral → "They use they/them pronouns."
4. Preserve all other content in the prompt exactly.
5. Return only valid JSON — no explanation, no code fences.\
"""


@router.post("/{learner_id}/persona/sync")
async def sync_persona(
    learner_id: uuid.UUID,
    body: SyncPersonaBody,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LearnerOut:
    result = await db.execute(
        select(Learner).where(Learner.id == learner_id, Learner.account_id == account.id)
    )
    learner = result.scalar_one_or_none()
    if not learner:
        raise HTTPException(status_code=404, detail="Learner not found")

    user_msg = _SYNC_PROMPT.format(
        name=body.ai_name,
        gender=body.ai_gender,
        prompt=body.ai_persona_prompt,
    )
    response = await llm.invoke(
        [LLMMessage(role="user", content=user_msg)],
        temperature=0.2,
        max_tokens=600,
    )
    try:
        synced = json.loads(response.text)
        learner.ai_name = str(synced["ai_name"])
        learner.ai_gender = str(synced["ai_gender"])
        learner.ai_persona_prompt = str(synced["ai_persona_prompt"])
    except (json.JSONDecodeError, KeyError):
        # LLM returned garbage — save as-is without sync
        learner.ai_name = body.ai_name
        learner.ai_gender = body.ai_gender
        learner.ai_persona_prompt = body.ai_persona_prompt

    await db.commit()
    await db.refresh(learner)
    return _learner_out(learner)
```

- [ ] **Step 5: Lint and format**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/backend
poetry run ruff check app/api/learner.py
poetry run ruff format app/api/learner.py
```

Expected: `All checks passed!` (format may rewrite spacing).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/learner.py
git commit -m "feat: learner persona CRUD and LLM sync endpoints"
```

---

### Task 5: Frontend — Types, API Client, Server Actions

**Files:**
- Modify: `frontend/lib/backend.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts`

- [ ] **Step 1: Update `LearnerOut` in `backend.ts`**

Find:
```ts
export type LearnerOut = { id: string; name: string };
```

Replace:
```ts
export type LearnerOut = {
  id: string;
  name: string;
  ai_name: string;
  ai_gender: string;
  ai_persona_prompt: string | null;
};

export type UpdatePersonaBody = {
  ai_name?: string;
  ai_gender?: string;
  ai_persona_prompt?: string | null;
};

export type SyncPersonaBody = {
  ai_name: string;
  ai_gender: string;
  ai_persona_prompt: string;
};
```

- [ ] **Step 2: Add `updatePersona` and `syncPersona` to `backend.learners`**

In `backend.ts`, inside the `learners` object, add:

```ts
updatePersona: (id: string, body: UpdatePersonaBody, headers?: HeadersInit) =>
  request<LearnerOut>(`/learners/${id}/persona`, {
    method: "PATCH",
    body: body as Record<string, unknown>,
    headers,
  }),
syncPersona: (id: string, body: SyncPersonaBody, headers?: HeadersInit) =>
  request<LearnerOut>(`/learners/${id}/persona/sync`, {
    method: "POST",
    body: body as Record<string, unknown>,
    headers,
  }),
```

- [ ] **Step 3: Add wrappers in `api.ts`**

In `frontend/lib/api.ts`, inside the `learners` object, add:

```ts
updatePersona: (id: string, body: UpdatePersonaBody) =>
  c((h) => backend.learners.updatePersona(id, body, h)),
syncPersona: (id: string, body: SyncPersonaBody) =>
  c((h) => backend.learners.syncPersona(id, body, h)),
```

Add the import for the new types at the top:

```ts
import { BackendError, backend } from "@/lib/backend";
import type { UpdatePersonaBody, SyncPersonaBody } from "@/lib/backend";
```

- [ ] **Step 4: Add server actions**

Append to `frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts`:

```ts
import type { SyncPersonaBody } from "@/lib/backend";

export async function syncPersona(
  learnerId: string,
  body: SyncPersonaBody
): Promise<import("@/lib/backend").LearnerOut> {
  const api = await createApi();
  const updated = await api.learners.syncPersona(learnerId, body);
  revalidatePath(`/learner/${learnerId}`);
  return updated;
}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/backend.ts frontend/lib/api.ts \
  "frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts"
git commit -m "feat: frontend types and API wrappers for learner persona"
```

---

### Task 6: Frontend — AI Settings UI

**Files:**
- Create: `frontend/components/AIPersonaSettingsClient.tsx`
- Modify: `frontend/app/[locale]/(app)/learner/[learnerId]/page.tsx`
- Modify: `frontend/app/[locale]/(app)/learner/[learnerId]/LearnerHomeClient.tsx`

The settings section is a collapsible block (using shadcn `Collapsible`). It has:
- AI name: `<Input>` (plain text)
- Gender: three radio buttons (Female / Male / Neutral) built with shadcn `RadioGroup`
- Persona prompt: `<Textarea>`
- Any change debounces 800 ms then calls `syncPersona`; while pending, an "Syncing…" indicator shows

Check that `RadioGroup` and `Textarea` are available:

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend
grep -r "radio-group" components/ui/ | head -3
grep -r "textarea" components/ui/ | head -3
```

If either is missing, install:
```bash
pnpm dlx shadcn@latest add radio-group textarea
```

- [ ] **Step 1: Install missing shadcn components if needed**

Run the grep check above. Install any missing ones.

- [ ] **Step 2: Create `AIPersonaSettingsClient.tsx`**

`onSync` is passed as a prop (a server action) so this component stays decoupled from the specific route's `actions.ts`.

```tsx
"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { LearnerOut, SyncPersonaBody } from "@/lib/backend";

interface Props {
  initial: Pick<LearnerOut, "ai_name" | "ai_gender" | "ai_persona_prompt">;
  onSync: (body: SyncPersonaBody) => Promise<LearnerOut>;
}

const DEFAULT_PROMPT =
  "You are Tina, a warm and patient English teacher chatting with an " +
  "elementary-school child in mainland China. Always respond in English. " +
  "Use simple, age-appropriate vocabulary and short sentences (≤ 15 words). " +
  "If the child speaks Chinese, gently re-phrase their idea in English and " +
  "invite them to repeat it. Stay encouraging; never correct mistakes " +
  "harshly. Each turn, ask exactly one short follow-up question to keep " +
  "the conversation going. She uses she/her pronouns.";

export function AIPersonaSettingsClient({ initial, onSync }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.ai_name);
  const [gender, setGender] = useState(initial.ai_gender);
  const [prompt, setPrompt] = useState(initial.ai_persona_prompt ?? DEFAULT_PROMPT);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skip sync on initial mount — only fire when user actually edits.
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const updated = await onSync({
          ai_name: name,
          ai_gender: gender,
          ai_persona_prompt: prompt,
        });
        // Reflect whatever the LLM reconciled back into the fields
        setName(updated.ai_name);
        setGender(updated.ai_gender);
        setPrompt(updated.ai_persona_prompt ?? DEFAULT_PROMPT);
      });
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [name, gender, prompt, onSync]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="flex w-full items-center justify-between px-0 font-medium">
          <span>AI Settings</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {isPending
              ? "Syncing…"
              : open
                ? <ChevronDown className="h-4 w-4" />
                : <ChevronRight className="h-4 w-4" />}
          </span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 pt-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-name">AI name</Label>
          <Input
            id="ai-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tina"
            className="max-w-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Gender</Label>
          <RadioGroup
            value={gender}
            onValueChange={setGender}
            className="flex gap-4"
          >
            {(["female", "male", "neutral"] as const).map((g) => (
              <div key={g} className="flex items-center gap-1.5">
                <RadioGroupItem value={g} id={`gender-${g}`} />
                <Label htmlFor={`gender-${g}`} className="capitalize cursor-pointer font-normal">
                  {g}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-prompt">Persona prompt</Label>
          <Textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="resize-y text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Changing name or gender above will automatically update this prompt via AI.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 3: Update `LearnerHomePage` server component to pass persona fields**

In `frontend/app/[locale]/(app)/learner/[learnerId]/page.tsx`, the `learners` list is fetched. The first learner matching `learnerId` is found. We need persona fields.

The `LearnerOut` type now includes `ai_name`, `ai_gender`, `ai_persona_prompt`. The learner object already has them after Task 5. Update the page to pass them to the client component:

```tsx
import { createApi } from "@/lib/api";
import { LearnerHomeClient } from "./LearnerHomeClient";

interface Props {
  params: Promise<{ learnerId: string; locale: string }>;
}

export default async function LearnerHomePage({ params }: Props) {
  const { learnerId } = await params;
  const api = await createApi();

  const [learners, enrolledLessons, curricula] = await Promise.all([
    api.learners.list(),
    api.learnerLessons.list(learnerId),
    api.curricula.list(),
  ]);

  const learner = learners.find((l) => l.id === learnerId);
  if (!learner) return <div>Learner not found.</div>;

  return (
    <LearnerHomeClient
      learnerId={learnerId}
      learnerName={learner.name}
      aiName={learner.ai_name}
      aiGender={learner.ai_gender}
      aiPersonaPrompt={learner.ai_persona_prompt}
      enrolledLessons={enrolledLessons}
      curricula={curricula}
    />
  );
}
```

- [ ] **Step 4: Update `LearnerHomeClient.tsx` to accept and render the settings section**

Update the `Props` interface and add the `AIPersonaSettingsClient` at the bottom:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LessonEnrollDialog } from "@/components/LessonPickerClient";
import { AIPersonaSettingsClient } from "@/components/AIPersonaSettingsClient";
import type { CurriculumSummary, LessonInfoOut } from "@/lib/backend";
import { addLesson, removeLesson, fetchCurriculumLessons, syncPersona } from "./actions";

interface Props {
  learnerId: string;
  learnerName: string;
  aiName: string;
  aiGender: string;
  aiPersonaPrompt: string | null;
  enrolledLessons: LessonInfoOut[];
  curricula: CurriculumSummary[];
}

export function LearnerHomeClient({
  learnerId,
  learnerName,
  aiName,
  aiGender,
  aiPersonaPrompt,
  enrolledLessons,
  curricula,
}: Props) {
  const router = useRouter();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const latestLesson = enrolledLessons[0];

  const handleEnroll = async (lessonIds: string[]) => {
    for (const id of lessonIds) {
      await addLesson(learnerId, id);
    }
  };

  const handleRemove = (lessonId: string) => {
    startTransition(async () => {
      await removeLesson(learnerId, lessonId);
    });
  };

  const handleStartPractice = () => {
    const params = latestLesson ? `?lessonId=${latestLesson.lesson_id}` : "";
    router.push(`/chat${params}`);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{learnerName}</h1>
        <Button onClick={handleStartPractice}>Start Practice →</Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Lessons</h2>
          <Button variant="outline" size="sm" onClick={() => setEnrollOpen(true)}>
            + Add
          </Button>
        </div>

        {enrolledLessons.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No lessons added yet. Click &quot;+ Add&quot; to browse the curriculum.
          </p>
        )}

        {enrolledLessons.map((l) => (
          <Card key={l.lesson_id} className="flex items-center justify-between p-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">
                {l.curriculum_name} · {l.unit_number}
              </div>
              <div className="text-muted-foreground text-xs">
                {l.lesson_title ?? `Lesson ${l.lesson_sequence}`}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => handleRemove(l.lesson_id)}
              className="text-muted-foreground hover:text-destructive"
            >
              Remove
            </Button>
          </Card>
        ))}
      </div>

      <Separator />

      <AIPersonaSettingsClient
        initial={{ ai_name: aiName, ai_gender: aiGender, ai_persona_prompt: aiPersonaPrompt }}
        onSync={(body) => syncPersona(learnerId, body)}
      />

      <LessonEnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        curricula={curricula}
        getLessons={fetchCurriculumLessons}
        onEnroll={handleEnroll}
      />
    </div>
  );
}
```

- [ ] **Step 5: TypeScript check and lint**

```bash
cd /Users/peixinliu/Develop/github/_peixin/talking-text/frontend
pnpm tsc --noEmit
pnpm lint 2>&1 | grep -v "^$" | head -30
```

Expected: no new type errors; lint passes or shows only the same pre-existing errors as before.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/AIPersonaSettingsClient.tsx \
  "frontend/app/[locale]/(app)/learner/[learnerId]/page.tsx" \
  "frontend/app/[locale]/(app)/learner/[learnerId]/LearnerHomeClient.tsx"
git commit -m "feat: AI persona settings UI on learner home page"
```
