# Data & Model Dictionary

This document details the current database schema and backend SQLAlchemy models. Keep this updated as the architecture evolves.

---

## 1. Model Dictionary (Python Models)

All models inherit from `Base` and `TimestampMixin` (which automatically handles `created_at` and `updated_at`).

| Model Class | Table Name | Description |
|---|---|---|
| `Account` | `account` | Core account entity (billing/family unit). |
| `AccountCredential` | `account_credential` | Login credentials (supports email, phone, OAuth, etc.). |
| `Learner` | `learner` | Learner profile (multiple learners can belong to one account). |

### Enums

- `CredentialProvider` (Inherits `str, enum.Enum`)
  - `EMAIL` = `"email"`
  - `PHONE` = `"phone"`
  - `WECHAT` = `"wechat"`
  - `WEIBO` = `"weibo"`

---

## 2. Database Schema

### 2.1 account table

Handles billing and overall ownership.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Unique account identifier (uuid4) |
| `name` | `VARCHAR(100)` | NOT NULL | Display name of the account owner |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Update timestamp |

**Relationships:**
- 1-to-Many with `account_credential` (`credentials`), CASCADE
- 1-to-Many with `learner` (`learners`), CASCADE

### 2.2 account_credential table

Decouples "user" from "login method", allowing multiple ways to log into a single account.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Unique credential identifier |
| `account_id` | `UUID` | NOT NULL, FK(`account.id`), INDEX | Belongs to account. `ON DELETE CASCADE` |
| `provider` | `VARCHAR(20)` | NOT NULL | Authentication provider (`CredentialProvider` enum string) |
| `identifier` | `VARCHAR(254)` | NOT NULL | User identifier (email, phone number, or openid) |
| `password` | `VARCHAR(72)` | NULL | Hashed password (for email/phone). NULL for OAuth. |
| `extra_data` | `JSONB` | NULL | Provider-specific extras (unionid, OAuth tokens) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Update timestamp |

**Unique Constraints:** `uq_credential_provider_identifier` (`provider`, `identifier`) - Prevents the same credential from being linked to multiple accounts.

### 2.3 learner table

The core entity for learning business logic.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK | Unique learner identifier |
| `account_id` | `UUID` | NOT NULL, FK(`account.id`), INDEX | Belongs to account. `ON DELETE CASCADE` |
| `name` | `VARCHAR(100)` | NOT NULL | Learner's display name |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Update timestamp |

---
