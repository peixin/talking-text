# 数据与模型字典 · Data Dictionary

本文档记录当前数据库的表结构与后端的 SQLAlchemy 数据模型。随架构演进而更新。

---

## 1. 核心模型字典 (Python Models)

所有模型均继承自 `Base` 和 `TimestampMixin`（自动管理 `created_at` 与 `updated_at`）。

| 模型类名 | 对应表名 | 描述 |
|---|---|---|
| `Account` | `account` | 核心账号实体（按家庭/付费主体划分） |
| `AccountCredential` | `account_credential` | 账号凭证，支持多方式登录（邮箱、手机、微信等） |
| `Learner` | `learner` | 学习者档案（一个账号下可有多个） |

### 枚举 (Enums)

- `CredentialProvider` (继承 `str, enum.Enum`)
  - `EMAIL` = `"email"`
  - `PHONE` = `"phone"`
  - `WECHAT` = `"wechat"`
  - `WEIBO` = `"weibo"`

---

## 2. 数据库字典 (Database Schema)

### 2.1 account 表 (核心账号)

负责计费和总体归属。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 账号唯一标识 (uuid4) |
| `name` | `VARCHAR(100)` | NOT NULL | 账号显示名称（如注册时填写的名字） |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 更新时间 (由 DB 自动维护) |

**关联:**
- 一对多 `account_credential` (`credentials`)，CASCADE
- 一对多 `learner` (`learners`)，CASCADE

### 2.2 account_credential 表 (账号凭证)

解耦了“用户”和“登录方式”，允许单个账号绑定多种登录途径。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 凭证记录唯一标识 |
| `account_id` | `UUID` | NOT NULL, FK(`account.id`), INDEX | 所属账号 ID。外键约束 `ON DELETE CASCADE` |
| `provider` | `VARCHAR(20)` | NOT NULL | 登录提供方。使用 Python 层的 `CredentialProvider` 枚举 |
| `identifier` | `VARCHAR(254)` | NOT NULL | 用户标识（如邮箱地址、手机号或第三方 openid） |
| `password` | `VARCHAR(72)` | NULL | 密码哈希值（仅限邮箱、手机等使用密码的登录方式），第三方登录为 NULL |
| `extra_data` | `JSONB` | NULL | 第三方特有信息存储（如微信 unionid, OAuth tokens 等） |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 更新时间 |

**唯一约束:** `uq_credential_provider_identifier` (`provider`, `identifier`) - 同一方式的同一标识不可被多个账号绑定。

### 2.3 learner 表 (学习者档案)

承载核心学习业务逻辑的对象。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 学习者唯一标识 |
| `account_id` | `UUID` | NOT NULL, FK(`account.id`), INDEX | 所属账号 ID。外键约束 `ON DELETE CASCADE` |
| `name` | `VARCHAR(100)` | NOT NULL | 学习者称呼/名字 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 更新时间 |

---
