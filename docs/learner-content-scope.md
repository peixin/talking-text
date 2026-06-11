# Multi-Learner Content Scope & Sharing

> **Implementation status:** sharing (§6 UC-5/6/7, §8.4) shipped 2026-06-11 — see `2026-06-11-dev-log.md` §4.
> Design doc — finalized on 2026-05-27, synthesizing the discussion that revised parts of [`content-model.md`](content-model.md).
> This doc **supersedes** `content-model.md` §5 (sharing dynamics) and **amends** its §2 principle #6.
> Chinese sibling: [`learner-content-scope.cn.md`](learner-content-scope.cn.md).

---

## 1. Purpose & Audience

This document specifies how `item_group` (textbooks, collections) relates to multiple learners within a single account, and how groups are shared across accounts.

It is written for an engineer implementing the feature end-to-end (schema migration, backend API, frontend wiring). All decisions in §7 have been pre-made; the doc reads top-to-bottom as an implementation brief.

It answers:

- How is a textbook visible to and editable by which learner?
- What happens when a parent creates a textbook for one learner vs. when a child learner creates their own?
- How does sharing work when the receiver may want either an independent copy or a live subscription?
- What can a child learner edit vs. what is reserved for the account owner?

It does **not** cover: vendor adapters, Scope Computer, mastery tracker, voice pipeline, or curriculum ingestion AI flow. Those are governed by other docs.

---

## 2. Guiding Principles (主旨)

### 2.1 Separate three concerns: ownership, visibility, usage scope

| Concern | Mechanism | Meaning |
|---|---|---|
| **Ownership** (billing, hard delete) | `item_group.owner_account_id` (existing) | "This belongs to the family account" |
| **Usage scope** (which learner can use this) | `item_group_learner` (new join table) | "This learner is assigned this textbook" |
| **Provenance** (attribution, default behavior) | `item_group.created_by_learner_id` (new column) | "Originally created for this learner" |

These three are independent. A single textbook owned by Account A can be assigned to learners A1 and A2, while being marked as "originally created for A1."

### 2.2 Within an account, one source of truth — never clone

Within a single account, **the same textbook is one row**. Multi-learner support is via the join table, not by duplication. Edits to the textbook propagate to all assigned learners. This matches how a family treats a school textbook: one physical copy, whoever needs it picks it up.

### 2.3 Across accounts, sharing offers two semantics — receiver chooses

When a user opens a share link from another account, **the receiver chooses at adoption time**:

- **Clone** — deep copy of the group subtree into the receiver's account. Independent ever after. Source owner's later edits do **not** propagate.
- **Reference (subscription)** — no copy is created. The receiver subscribes to the source group; the source owner's edits are visible to the receiver in real time. Receiver **cannot edit** a referenced group in any way — all edit controls are hidden; if they want to modify it, they must "fork" the subscription into a clone.

The share link does **not** encode the mode. The same link can be adopted as clone by one receiver and as subscription by another.

### 2.4 Edit-capable defaults, parent oversight available

Many families have parents too busy to actively manage the child's app. Children must be able to:

- Photograph their textbook
- Confirm/correct AI-extracted content
- Add the textbook to their daily practice

Edit permissions are designed for this self-driven case. Parents retain hard-delete, audit visibility (`last_edited_by_learner_id`), and an optional `locked` flag.

### 2.5 Learner edits "what their eyes see"; AI/parent owns "tags and orchestration"

Children can fix anything they can verify against their physical textbook — text content, unit name, page number, missing/extra words. Children cannot mutate semantic tags (`cefr_level`, `pos`, `type`) or LLM orchestration parameters (`prompt_notes`). Those are determined by AI extraction (automated) and may be corrected by the account owner (parent). The rationale: most parents also lack the linguistic expertise to judge these values reliably; the system (AI) is the authoritative source. `type` in particular is immutable post-insert.

### 2.6 Soft delete only for learners

Hard delete is exclusively the account owner's action. Anything a learner "deletes" is soft-archived (`archived = true`) and remains restorable by the owner.

### 2.7 Defer canonical / global textbooks to V2

A V2 vision is "the same textbook should be one row across the whole world, not per-family." This requires immutable versioned canonical groups with content-addressed overlay paths to survive structural mutation. **Out of scope for V1.** V1 keeps `owner_account_id NOT NULL` and uses cross-account Reference (§2.3) as the lightweight stand-in.

---

## 3. Concept Glossary

| Term | Definition |
|---|---|
| **Account** | Login + billing entity. One per family. (model: `account`) |
| **Learner** | Study profile inside an account. Multiple per account. No independent login; switched in-app via picker. (model: `learner`) |
| **Active learner** | The learner the current session is acting on behalf of. Stored on `account.last_active_learner_id`. |
| **Group** | A node in the content organization tree. Books, units, lessons, personal collections — all are `item_group` rows. |
| **Root group** | An `item_group` with `parent_id IS NULL`. Typically `kind = textbook_book` or top-level `personal_collection`. Library lists root groups only. |
| **Owned group** | An `item_group` with `owner_account_id = <my account>`. |
| **Subscribed group** | A group owned by another account, exposed via `item_group_subscription`. |
| **Assignment** | A row in `item_group_learner`. Always at root level. |
| **Adoption** | The act of taking a shared group into one's library, in either Clone or Reference mode. |

---

## 4. Data Model

This section is **additive** to the schema in `content-model.md` unless explicitly noted as a modification.

### 4.1 Modifications to `item_group`

Add four columns:

```
item_group (existing table — additions only)
  + created_by_learner_id      UUID NULL  FK → learner.id      ON DELETE SET NULL
  + last_edited_by_learner_id  UUID NULL  FK → learner.id      ON DELETE SET NULL
  + locked              BOOLEAN    NOT NULL  DEFAULT false
  + cloned_from_group_id       UUID NULL  FK → item_group.id   ON DELETE SET NULL
```

Note: `cover_image_url` is **not** added in V1. Decorative metadata is deferred.

Semantics:

- `created_by_learner_id` — the active learner when this group was created. Used for parent-side attribution ("Created by 小红") and as a default in some UI flows. Immutable after insert.
- `last_edited_by_learner_id` — the active learner who most recently performed a user-initiated mutation on this group (rename, member add/remove, re-parent, archive toggle). Set ONLY by user-initiated actions. AI/background processes do not stamp this field.
- `locked` — when `true`, only the account owner may mutate **this node and any of its descendants**. Applies to any level (book, unit, lesson, or collection) — not just the root. Lock a unit to freeze only that unit; lock the book to freeze the whole tree. Default `false`. UI exposes a lock toggle on every level card in the parent management view.
- `cloned_from_group_id` — populated when this group came into existence via Clone-mode adoption (§7.2). Points to the source group. NULL for groups created from scratch.

Existing `owner_account_id` remains `NOT NULL`. Canonical-textbook concept (nullable owner) is deferred to V2.

### 4.2 New table: `item_group_learner`

Many-to-many assignment of root groups to learners within an account.

```
item_group_learner (new table)
  group_id    UUID NOT NULL  FK → item_group.id  ON DELETE CASCADE
  learner_id  UUID NOT NULL  FK → learner.id     ON DELETE CASCADE
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (group_id, learner_id)
```

Index: `(learner_id)` for "list groups assigned to me" queries.

Constraints (enforced in the application, not the schema, because they cross tables):

1. Assignment is only valid for **root groups** (`item_group.parent_id IS NULL`). Reject insertion otherwise.
2. For **owned groups** (`item_group.owner_account_id IS NOT NULL`): `learner.account_id` must equal `item_group.owner_account_id`. (A learner cannot be assigned content their account doesn't own.)
3. For **subscribed groups** (a row exists in `item_group_subscription` for the calling account): `learner.account_id` must equal the subscriber account. (Subscription is at the account level; assignment is at the learner level within that account.)

Effect: assignment implies the learner sees this group AND its entire subtree (units/lessons) in their library, and can practice from any leaf within it. Sub-groups are reached by recursive `parent_id` traversal — there are NO sub-tree assignment rows.

### 4.3 Existing table updates: `group_share_link`

`content-model.md` §3.3 already defines `group_share_link`. It does **not** need a `share_mode` column. The mode is chosen by the receiver at adoption time, not encoded in the link.

If the table is not yet implemented, create it per `content-model.md` §3.3.

### 4.4 New table: `item_group_subscription`

Cross-account reference. No content is copied.

```
item_group_subscription (new table)
  subscriber_account_id  UUID NOT NULL  FK → account.id     ON DELETE CASCADE
  source_group_id        UUID NULL      FK → item_group.id  ON DELETE SET NULL
  subscribed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (subscriber_account_id, source_group_id)
```

Notes:

- `source_group_id` may be set to NULL when the source group is hard-deleted by its owner (§7.1). The row is retained as a tombstone.
- Because of the SET NULL behavior, the primary key needs special handling: PostgreSQL allows multiple `(account_id, NULL)` pairs (NULL is not considered equal to NULL in unique constraints). This is acceptable — tombstones can pile up; cleanup is an explicit user action.
- A subscriber cannot subscribe to a group they own (enforced in application).
- A subscriber cannot subscribe to a group that is itself a subscription (no nesting — see §7.3). Enforced in application via "the source group's `owner_account_id` must be non-null and not equal to the subscriber."

### 4.5 Existing table: `group_adoption` (clone-mode provenance)

`group_adoption` (per `content-model.md` §3.3) is used **only** for Clone adoptions. Reference adoptions are tracked in `item_group_subscription` exclusively.

`item_group.cloned_from_group_id` (§4.1) is a denormalized direct pointer that duplicates information in `group_adoption`. We keep both: `group_adoption` is the analytics-friendly normalized form; `cloned_from_group_id` allows a single-row read to know provenance.

### 4.6 No changes required to `account` for active-learner state

`account.last_active_learner_id` already exists and is wired through auth. Reuse it as the "current learner" mechanism (§5).

---

## 5. Active Learner: Server-Side Session State

The frontend needs a globally-readable "who is studying right now" value to drive UC-1 through UC-4 (§6).

### 5.1 Storage

Already in place: `account.last_active_learner_id` (`UUID NULL`, FK → `learner.id` ON DELETE SET NULL).

### 5.2 Endpoints

(See §8 for the full API surface. Some of these may already exist; if not, add.)

- `GET /me/active-learner` → `{ learner_id: UUID | null }`
- `POST /me/active-learner` body `{ learner_id }` → 204. Validates `learner.account_id == caller.account_id`.

### 5.3 Frontend behavior

- On login: if `last_active_learner_id` is NULL, route to the learner picker.
- On every authenticated page: top navigation displays the active learner with a quick switcher.
- Server Actions that create or edit groups read `last_active_learner_id` from the session and stamp `created_by_learner_id` / `last_edited_by_learner_id` from it.
- Switching learners is a single POST + page revalidation. No data migration.

---

## 6. Use Cases (Sequence Walkthroughs)

These are the user-visible scenarios that drive §4 and §7. Each walks through the data writes step by step.

### UC-1: Parent creates a textbook for the active learner

Precondition: Parent logged in; `last_active_learner_id = 小明`.

1. Parent opens "新建教材" page.
2. UI top bar shows: 「当前 learner: 小明 — 切换」.
3. Parent uploads photo / pastes text.
4. AI extracts language items + suggests metadata.
5. Parent confirms; clicks save. Server Action:
   - INSERT `item_group` with:
     - `owner_account_id = parent_account_id`
     - `created_by_learner_id = 小明_id`
     - `last_edited_by_learner_id = 小明_id`
   - INSERT child `item_group` rows for units/lessons.
   - INSERT `item_group_member` rows linking to (deduplicated) `language_item` rows.
   - INSERT `item_group_learner (root_group_id, 小明_id)`.

### UC-2: Child opens app, switches identity, creates their own textbook

Precondition: Account already exists; child opens app on shared device.

1. App boot: shows learner picker ("谁在学习？").
2. Child taps "小红"; `POST /me/active-learner { learner_id: 小红_id }`.
3. Same flow as UC-1 from step 3. Result: group is `owned by account`, `created_by 小红`, `assigned to 小红`.
4. Account owner (parent), next time they view the library, sees this textbook with attribution "由 小红 创建于 5/27".

### UC-3: Parent assigns an existing textbook to a sibling

1. Parent navigates to a textbook in their library.
2. UI shows "已分配给: 小明" with a "管理分配" button.
3. Parent opens the dialog, toggles on "小红".
4. Frontend: `POST /item-groups/{group_id}/learners { learner_id: 小红_id }`.
5. Backend INSERTs `item_group_learner (group_id, 小红_id)`.
6. Both 小明 and 小红 now see the same group, same content, same row. No clone.

### UC-4: Child edits a textbook that AI got wrong

1. Active learner = 小红. Child opens the textbook.
2. Notices AI missed two words on a page.
3. Child taps "add word", types them. Server Action:
   - For each new word: INSERT `language_item` if not exists (global dedup by `UNIQUE (type, text)`); INSERT `item_group_member`.
   - UPDATE `item_group.last_edited_by_learner_id = 小红_id` on the affected leaf.
4. Parent's "最近活动" view (V2) shows: "小红 在 Unit 3 添加了 2 个词".

If `locked = true` on this group or any ancestor, step 3 is rejected with `403 GROUP_LOCKED`.

### UC-5: Parent shares a textbook with another family (Account B)

1. Parent A clicks "生成分享链接" on a root group.
2. Frontend: `POST /item-groups/{group_id}/share-link`. Backend INSERTs `group_share_link` with a unique `code`; returns `{ code, expires_at }`.
3. Parent A sends the link to Parent B (out of band).
4. Parent B opens the link. Frontend calls `GET /share-links/{code}/preview` (no auth required for preview metadata). UI shows: name, kind, item count, cover, source account handle.
5. Parent B logs in (if not already), then sees two buttons:
   - 「复制一份到我的库」(Clone)
   - 「订阅原版」(Reference)
6a. **Clone**: `POST /share-links/{code}/adopt { mode: "clone" }`. Backend:
    - Deep-copies the `item_group` subtree (new UUIDs).
    - Re-inserts `item_group_member` rows pointing to the same global `language_item` ids.
    - Sets the new root's `owner_account_id = B`, `cloned_from_group_id = source.id`.
    - Inserts `group_adoption (source_group_id=source.id, target_group_id=new_root.id, adopted_by=B)`.
    - Returns `{ adopted_group_id: new_root.id }`.
6b. **Reference**: `POST /share-links/{code}/adopt { mode: "reference" }`. Backend:
    - INSERTs `item_group_subscription (subscriber_account_id=B, source_group_id=source.id)`.
    - Returns `{ adopted_group_id: source.id }` (note: this id is owned by A, not B).
7. Parent B (or 小军, B's active learner) now sees the group in their library. To make it usable, B assigns it to a learner via UC-3 mechanics — `item_group_learner` works the same whether the group is owned or subscribed.

### UC-6: Subscriber wants to customize a referenced textbook (Fork)

1. Account B opened a group via Reference (UC-5b). Later, B wants to add 3 of their own words.
2. UI on a subscribed group disables all edit controls and shows a banner: "这是订阅的教材，无法直接编辑。Fork 一份以自由修改 →"
3. B clicks Fork. Frontend: `POST /item-group-subscriptions/{source_group_id}/fork`.
4. Backend (single transaction):
   - Deep-copy the source subtree (identical to Clone, §6 UC-5 step 6a).
   - Re-write any `item_group_learner` rows from `group_id = source.id` to `group_id = new_root.id` — this preserves B's learner assignments.
   - DELETE the `item_group_subscription` row.
   - Returns `{ new_group_id }`.
5. B can now edit freely. Source owner A's future edits no longer reach B.

### UC-8: Learner encounters a subscribed group

1. Active learner = 小明. Parent B assigned the subscribed group to 小明 (via `item_group_learner`).
2. 小明 opens the group in the learner-facing app. The group renders in **read-only** mode:
   - All edit controls are hidden (no rename input, no add-word button, no delete button).
   - A banner at the top of the page reads: "此教材来自订阅，仅供学习使用。"
3. 小明 can still start a practice session from any leaf group (session creation is unaffected by subscription status).
4. If Parent B opens the same group in the parent view, Parent B sees the Fork banner with a call-to-action button. Learners never see the Fork option — it is a parent-level account management action.

### UC-9: Parent manages which learners can see a textbook

1. Parent navigates to `/parent/materials/{groupId}/learners`.
2. The page lists all learners in the account, each with a toggle showing their current assignment status for this root group.
3. Parent toggles a learner on → `POST /item-groups/{id}/learners { learner_id }`.
4. Parent toggles a learner off → `DELETE /item-groups/{id}/learners/{learner_id}`.
5. The assignment takes effect immediately. The learner's library view updates on next load.

### UC-7: Source owner deletes a group that subscribers reference

(See §7.1 for the policy. Here is the walkthrough.)

1. Account A hard-deletes a root group. Backend: `DELETE FROM item_group WHERE id = ...`.
2. CASCADE deletes child `item_group`, `item_group_member`, `item_group_learner` rows.
3. `item_group_subscription.source_group_id` is SET NULL for any subscriber.
4. Account B's library list query (§8.5) now returns this subscription as a tombstone. UI renders: "原作者已删除此教材 (订阅于 2026-04-12) — 移除".
5. B clicks "移除"; backend DELETEs the tombstone row.
6. Any `item_group_learner` rows that pointed to the now-deleted group are gone (CASCADE), so no learner assignments are orphaned.

---

## 7. Decisions on Edge Cases

These three were the live decisions during design. They are pre-made; the implementation should follow them.

### 7.1 Source owner deletes a group that has active subscribers

**Decision: SET NULL + tombstone UI.**

- `item_group_subscription.source_group_id` is SET NULL when the source is deleted.
- Subscriber's UI shows a tombstone entry: "原作者已删除此教材".
- Tombstone offers a "移除" action that deletes the subscription row.
- Any `item_group_learner` rows that referenced the deleted group are gone (CASCADE on `item_group.id`), so the learner's assignment list cleans itself up.

Rejected alternatives:

- CASCADE delete on `item_group_subscription` → too abrupt; user loses awareness.
- RESTRICT → source owner can't delete; anti-social.

### 7.2 Fork operation semantics

**Decision: Fork = deep clone identical to a Clone-mode adoption, with subscription replaced.**

- Identical mechanics to Clone (UC-5 step 6a).
- Additional step: rewrite all `item_group_learner` rows where `group_id = source.id AND learner_id IN (subscriber's learners)` to point to the new clone's root id. This preserves learner assignments.
- The `item_group_subscription` row is DELETEd in the same transaction.
- `cloned_from_group_id` on the new clone points to the source.
- The new clone's `created_by_learner_id` is set to the **forking** account's active learner (clean slate; do not copy from source).

### 7.3 Nesting subscriptions / re-sharing

**Decision: V1 disallows nesting.**

- A subscriber cannot generate a `group_share_link` for a subscribed group.
- Backend enforces by checking `item_group.owner_account_id == caller.account_id` on the create-share endpoint. Subscribed groups have a different `owner_account_id`, so the check fails naturally. Return `403 CANNOT_SHARE_NON_OWNED_GROUP`.
- If the subscriber wants to share, they must Fork first, then share the fork.

---

## 8. API Surface

Paths are illustrative; conform to project conventions in `backend/app/api/`. All endpoints require authentication unless noted.

### 8.1 Active learner

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me/active-learner` | — | `{ learner_id: UUID \| null }` |
| POST | `/me/active-learner` | `{ learner_id }` | 204 |

Validation: `learner.account_id == caller.account_id`.

### 8.2 Library listing

| Method | Path | Returns |
|---|---|---|
| GET | `/me/library` | `[{ id, name, kind, cover_image_url, source: "owned" \| "subscribed", subscribed_at?, last_edited_by_learner_id?, ... }]` |
| GET | `/me/library/tombstones` | `[{ subscription_subscribed_at, source_account_handle }]` |

Query for the main list — see §8.5 SQL sketch.

### 8.3 Assignment

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/item-groups/{id}/learners` | — | `[{ learner_id, learner_name, assigned_at }]` |
| POST | `/item-groups/{id}/learners` | `{ learner_id }` | 201 |
| DELETE | `/item-groups/{id}/learners/{learner_id}` | — | 204 |

Validation:

- Caller must own the group OR be subscribed to it.
- `learner_id` must belong to caller's account.
- Group must be a root group (`parent_id IS NULL`).

### 8.4 Sharing

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/item-groups/{id}/share-link` | `{ expires_at? }` | `{ code, expires_at }` |
| GET | `/share-links/{code}/preview` | — | `{ name, kind, item_count, cover_image_url, source_account_handle }` (no auth) |
| POST | `/share-links/{code}/adopt` | `{ mode: "clone" \| "reference" }` | `{ adopted_group_id }` |
| POST | `/item-group-subscriptions/{source_group_id}/fork` | — | `{ new_group_id }` |
| DELETE | `/item-group-subscriptions/{source_group_id}` | — | 204 (unsubscribe / dismiss tombstone) |

Validation on `share-link` POST: caller owns the group AND group's `parent_id IS NULL` (only share at root level).

### 8.5 Library listing — SQL sketch

```sql
-- Owned root groups
SELECT
  g.id, g.name, g.kind, g.cover_image_url,
  g.created_by_learner_id, g.last_edited_by_learner_id,
  'owned' AS source,
  NULL AS subscribed_at
FROM item_group g
WHERE g.owner_account_id = :me
  AND g.archived = false
  AND g.parent_id IS NULL

UNION ALL

-- Subscribed root groups (not tombstones)
SELECT
  g.id, g.name, g.kind, g.cover_image_url,
  g.created_by_learner_id, g.last_edited_by_learner_id,
  'subscribed' AS source,
  s.subscribed_at
FROM item_group g
JOIN item_group_subscription s ON s.source_group_id = g.id
WHERE s.subscriber_account_id = :me
  AND g.archived = false
  AND g.parent_id IS NULL
;

-- Tombstones (separate query, distinct UI rendering)
SELECT subscribed_at
FROM item_group_subscription
WHERE subscriber_account_id = :me
  AND source_group_id IS NULL
;
```

Optionally filter the second SELECT by `JOIN item_group_learner` if the listing is per-learner rather than per-account.

### 8.6 Authoritative permission check on writes

Every write endpoint on an `item_group` (rename, member add/remove, re-parent, archive toggle) must:

1. Load the group.
2. If `locked` is true on this group OR any ancestor, and caller is not the account owner, reject with `403 GROUP_LOCKED`.
3. If group is subscribed (no `owner_account_id` match), reject with `403 CANNOT_EDIT_SUBSCRIBED_GROUP`.
4. Perform the write. UPDATE `last_edited_by_learner_id = :active_learner_id` on the same group (only for user-initiated writes; AI/system writes leave it untouched).

---

## 9. Permission Matrix

This is the source of truth for who can do what. Backend authorization must mirror this exactly.

### 9.1 Notation

- **Owner** = caller's account id equals `item_group.owner_account_id`.
- **Assigned learner** = a learner referenced by `item_group_learner` for this group, where that learner's `account_id == caller.account_id`.
- **Active learner** = `account.last_active_learner_id` for the caller.
- **Subscriber** = caller's account has a row in `item_group_subscription` referencing this group.

### 9.2 `item_group` field-level permissions (owned, not subscribed)

| Field | Account owner | Active learner is creator | Active learner is assigned (not creator) | When `locked = true` |
|---|---|---|---|---|
| `name` | ✓ | ✓ | ✓ | learners ✗, owner ✓ |
| `source_book_hint` | ✓ | ✓ | ✓ | learners ✗, owner ✓ |
| `parent_id` (re-parent within same root tree) | ✓ | ✓ | ✓ | learners ✗, owner ✓ |
| `parent_id` (move across root trees) | ✓ | ✗ | ✗ | learners ✗, owner ✓ |
| `archived = true` (soft delete) | ✓ | ✓ | ✓ | learners ✗, owner ✓ |
| `archived = false` (restore) | ✓ | ✓ | ✓ | learners ✗, owner ✓ |
| Hard delete (`DELETE FROM item_group`) | ✓ | ✗ | ✗ | learners always ✗ |
| `kind` | ✓ | ✗ | ✗ | learners ✗, owner ✓ |
| `cefr_level` / `pos` (on language_item) | ✓ (parent corrects AI) | ✗ | ✗ | learners ✗, owner ✓ |
| `prompt_notes` | ✓ | ✗ | ✗ | learners ✗, owner ✓ |
| `owner_account_id` | ✗ (immutable post-insert) | ✗ | ✗ | — |
| `locked` | ✓ | ✗ | ✗ | — |
| `created_by_learner_id` | ✗ (immutable post-insert) | ✗ | ✗ | — |
| `last_edited_by_learner_id` | system-stamped | system-stamped | system-stamped | — |
| `cloned_from_group_id` | ✗ (immutable post-insert) | ✗ | ✗ | — |

Note: `cover_image_url` is **not** a V1 field; row omitted. `name` is intentionally editable by any assigned learner — the account owner may use `locked` to restrict when needed.

### 9.3 `language_item` operations within an owned group

| Operation | Account owner | Active learner | When `locked = true` |
|---|---|---|---|
| Add member (link existing or create new `language_item`) | ✓ | ✓ | learners ✗ |
| Remove member (delete `item_group_member` row) | ✓ | ✓ | learners ✗ |
| Edit `language_item.text` directly | ✗ | ✗ | — (always ✗) |
| Edit `language_item.cefr_level` / `pos` / `type` | ✗ | ✗ | — (always ✗) |

Note on text fixes: because `language_item` is globally deduplicated (`UNIQUE (type, text)`), mutating `text` would change the meaning for every other group across all accounts referring to this row. The correct fix-flow is **remove + add**: remove the wrong member, add the correct one (which lazily creates a new `language_item` if it doesn't exist). UI exposes this as "fix word" but implements it as atomic remove+add.

### 9.4 Subscribed groups

| Operation | Subscriber | Source owner |
|---|---|---|
| Read group + descendants | ✓ | ✓ |
| Assign to subscriber's learners (`item_group_learner`) | ✓ | n/a |
| Unassign from subscriber's learners | ✓ | n/a |
| Any write to the group itself (rename, add words, delete) | ✗ — must Fork first | ✓ |
| Fork (convert subscription into clone) | ✓ | — |
| Unsubscribe (DELETE the subscription) | ✓ | — |
| Generate share link from this group | ✗ (§7.3) | ✓ |

**UI rule for subscribed groups**: All edit controls (rename, add/remove words, delete, re-parent) are completely hidden. The page renders a top banner: "此教材来自订阅，仅供学习使用，无法编辑。如需自定义，请 Fork 一份 →". Only the Fork and Unsubscribe actions are visible.

---

## 10. Migration Plan

### 10.1 Single Alembic migration

One migration file adds:

1. Columns on `item_group`:
   - `created_by_learner_id UUID NULL` (FK SET NULL → `learner.id`)
   - `last_edited_by_learner_id UUID NULL` (FK SET NULL → `learner.id`)
   - `locked BOOLEAN NOT NULL DEFAULT false` with `server_default=sa.text("false")`
   - `cloned_from_group_id UUID NULL` (FK SET NULL → `item_group.id`)
2. New table `item_group_learner` per §4.2, with `TimestampMixin` columns also added (`created_at`, `updated_at`) per project rule.
3. New table `item_group_subscription` per §4.4, with timestamp columns.
4. Verify `group_share_link` and `group_adoption` exist per `content-model.md` §3.3; create if not.
5. Indexes:
   - `item_group_learner (learner_id)` for reverse lookup.
   - `item_group_subscription (subscriber_account_id)` for library listing.
   - `item_group (last_edited_by_learner_id)` for parent-side activity feeds.

### 10.2 Data backfill (run inside the same migration)

1. `item_group.created_by_learner_id`: leave NULL — no prior signal exists.
2. `item_group.last_edited_by_learner_id`: leave NULL.
3. `item_group.locked`: default false (already correct).
4. `item_group.cloned_from_group_id`: NULL (already correct).
5. `item_group_learner` **backfill required**. For each existing `item_group` row with `parent_id IS NULL`, insert one row per learner in that account:
   ```sql
   INSERT INTO item_group_learner (group_id, learner_id)
   SELECT g.id, l.id
   FROM item_group g
   JOIN learner l ON l.account_id = g.owner_account_id
   WHERE g.parent_id IS NULL;
   ```
   This preserves the current "everyone in the account sees everything" behavior. Without this backfill, existing learners would lose access to existing groups.

### 10.3 Rollout sequencing across PRs

The schema migration can ship as one PR. Subsequent feature PRs in this order:

1. **Schema migration** (above). After this lands, the app behaves identically; the new tables are populated but unused.
2. **Scope filtering by assignment** — update Scope Computer / session-creation guards to check `item_group_learner` instead of falling back to `owner_account_id`. After this, a learner sees only their assigned groups.
3. **Active-learner endpoints + frontend wiring** — UI top bar, learner picker, Server Action plumbing.
4. **Assignment management UI** — the "管理分配" dialog from UC-3.
5. **Cross-account share flow with mode choice** — `share-link/adopt` accepts `mode`. UI offers Clone vs Reference.
6. **Fork + tombstone** — completes the subscription lifecycle.
7. **Parent-lock toggle** — settings-area UI.

Each step is independently shippable.

---

## 11. Cross-Reference with Other Docs

- `content-model.md` §2 principle #6 ("分享 = 克隆，而非引用"): **amended** — sharing offers clone OR reference; receiver chooses.
- `content-model.md` §5 (sharing dynamics): **replaced** by this doc's §6 UC-5, §6 UC-6, §7.
- `content-model.md` §3.5 `session.group_id`: unchanged — a session's group still points to a single `item_group` (owned or subscribed; identical from the session's perspective).
- `architecture.md` Scope Computer section: clarification — scope queries should filter by `item_group_learner` for the active learner, not by `owner_account_id`.
- `CLAUDE.md` Eight Architecture Rules #5 (Account vs Learner): reinforced — Account is the ownership / billing layer, Learner is the scope layer. This doc operationalizes the distinction.

---

## 12. Out of V1 Scope (Deferred to V2+)

The following are intentionally NOT addressed here:

1. **Canonical / global textbooks** (`owner_account_id IS NULL`). V2 introduces immutable versioned canonical groups with content-addressed overlay paths.
2. **Per-learner overlays within an account** (e.g., per-learner display name). Considered and rejected: not needed in V1, and UUID-anchored overlays don't survive structural mutation. If the need re-emerges, design alongside canonical-textbooks.
3. **Subscription version stamps & upgrade prompts**. V1 subscriptions track source live; no version awareness.
4. **Re-sharing subscribed groups** (subscription nesting).
5. **Full audit log of structural changes**. Only `last_edited_by_learner_id` (most recent edit) is tracked. A `group_audit` table is V2.
6. **Cross-family shared learners**. V1 assumes a learner belongs to exactly one account.
7. **Notifications to parent on destructive learner actions**. V1 logs (`last_edited_by_learner_id`); a real notification system is V2.

---

## 13. Open Questions Engineers May Encounter

These have a recommended answer; raise them with product if you want to change direction.

- **Q1**: Should the `locked` toggle be visible on every level card in the management UI, or hidden in an advanced settings area?
  → Visible on every level card. Parents can lock a specific unit without locking the whole book. A small lock icon button is sufficient; no need for a separate "advanced settings" page.
- **Q2**: When a learner takes a destructive action (e.g., archives a whole unit), should the parent get a notification?
  → V1 no. Audit field is enough. V2 adds an activity feed.
- **Q3**: On Fork, copy `created_by_learner_id` from source or stamp the forking learner?
  → Stamp the forking learner. Clean slate.
- **Q4**: When a subscription source is updated (owner adds words), notify the subscriber?
  → V1 no. V2 may add a quiet "原作者新增 N 条" badge.
- **Q5**: If the active learner is deleted, what happens to groups they "created"?
  → `created_by_learner_id` SET NULL (already configured). The group remains owned by the account; attribution becomes anonymous.
- **Q6**: What if a parent assigns the same group to a learner twice via UI race condition?
  → Composite PK on `item_group_learner` prevents this. The second INSERT 409s; the UI treats 409 as no-op.

---

End of document.
