# 数据与模型字典 · Data Dictionary

本文档详细记录了当前数据库的表结构与后端的 SQLAlchemy 数据模型。它是整个 V1 系统的核心数据实体定义指南，随架构演进而更新。

---

## 1. 核心模型字典 (Python Models)

所有模型均继承自 `Base` 和 `TimestampMixin`（自动管理 `created_at` 与 `updated_at` 两个时区敏感的时间戳字段）。

| 模型类名 | 对应表名 | 描述 |
|---|---|---|
| `Account` | `account` | 核心账号实体（按家庭/计费主体划分） |
| `AccountCredential` | `account_credential` | 账号凭证，支持多方式登录（邮箱、手机号、第三方 OAuth 等） |
| `Learner` | `learner` | 学习者档案（一个账号下可有多个学习者，如家里的不同孩子） |
| `LanguageItem` | `language_item` | 原子学习单元（包含单词 `word`、短语 `phrase` 或句型 `pattern`） |
| `ItemGroup` | `item_group` | 命名项目组，系统唯一的组织实体（支持教科书/单元/课时或个人收藏夹） |
| `ItemGroupMember` | `item_group_member` | 多对多关系表（连接 `ItemGroup` 和 `LanguageItem`） |
| `LearnerItemStats` | `learner_item_stats` | 针对每个学习者的语言原子单元掌握度跟踪统计 |
| `LearnerCalibrationTurn` | `learner_calibration_turn` | 学习者初始对话期间的 CEFR 等级评估轮次记录 |
| `Session` | `session` | 对话会话（将单个学习者的多个对话轮次进行归组） |
| `Turn` | `turn` | 单次对话轮次（记录孩子说的话与 AI 助手 Tina 的回复） |

---

## 2. 数据库字典 (Database Schema)

### 2.1 account 表 (核心账号)

负责计费、归属以及关联多个学习者实体。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 账号唯一标识 (默认 uuid4) |
| `name` | `VARCHAR(100)` | NOT NULL | 账号显示名称（如注册时填写的家长姓名） |
| `last_active_learner_id` | `UUID` | FK(`learner.id`, SET NULL), NULL | 上次活跃的学习者档案 ID，便于切回时自动选中 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 账号创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 账号资料最后更新时间 |

**关系:**
- 一对多 `account_credential` (`credentials`)，级联删除 (`CASCADE`)
- 一对多 `learner` (`learners`)，级联删除 (`CASCADE`)

---

### 2.2 account_credential 表 (账号凭证)

解耦了“用户账号”和“登录方式”，允许单个账号绑定多种登录途径。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 凭证唯一标识 (默认 uuid4) |
| `account_id` | `UUID` | NOT NULL, FK(`account.id`, CASCADE), INDEX | 所属账号 ID |
| `provider` | `VARCHAR(20)` | NOT NULL | 登录提供方。使用 `CredentialProvider` 枚举 |
| `identifier` | `VARCHAR(254)` | NOT NULL | 唯一身份标识（如邮箱地址、手机号或微信 OpenID） |
| `password` | `VARCHAR(72)` | NULL | 密码哈希值（对于邮箱或手机号注册；微信等 OAuth 登录为 NULL） |
| `extra_data` | `JSONB` | NULL | 第三方特有信息（如微信 UnionID、OAuth Access Tokens 等） |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 凭证创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 凭证最后更新时间 |

**枚举 `CredentialProvider`:**
- `EMAIL` = `"email"`
- `PHONE` = `"phone"`
- `WECHAT` = `"wechat"`
- `WEIBO` = `"weibo"`

**唯一约束:**
- `uq_credential_provider_identifier` (`provider`, `identifier`): 防止同一提供方的同一标识绑定多个不同的账户。

---

### 2.3 learner 表 (学习者档案)

承载核心学习业务逻辑的对象。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 学习者唯一标识 (默认 uuid4) |
| `account_id` | `UUID` | NOT NULL, FK(`account.id`, CASCADE), INDEX | 所属账号 ID |
| `name` | `VARCHAR(100)` | NOT NULL | 学习者称呼/名字 |
| `ai_name` | `VARCHAR(100)` | NOT NULL, DEFAULT `'Tina'` | 陪伴学习的 AI 助手的名字 |
| `ai_gender` | `VARCHAR(10)` | NOT NULL, DEFAULT `'female'` | AI 助手的性别（`female` / `male` 等） |
| `ai_persona_prompt` | `TEXT` | NULL | 该学习者专属的 AI 人设 System Prompt 覆盖，留空则使用全局默认 |
| `cefr_level` | `VARCHAR(4)` | NULL | 评估/校准出的 CEFR 英语等级（如 `A1`, `A2`），初始状态为 NULL |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 档案创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 档案最后更新时间 |

---

### 2.4 language_item 表 (原子学习单元)

系统中最基础的知识颗粒度，表示单词、短语或句型。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 原子单元唯一标识 (默认 uuid4) |
| `type` | `VARCHAR(10)` | NOT NULL | 类型：支持 `word` (单词)、`phrase` (短语) 或 `pattern` (句型) |
| `text` | `VARCHAR(200)` | NOT NULL | 实际的文本内容 (如 `"apple"`, `"good morning"`, `"I want a..."`) |
| `anchor` | `VARCHAR(200)` | NOT NULL | 归一化文本锚点，主要用于去重和精准匹配检索 |
| `cefr_level` | `VARCHAR(4)` | NULL | 该词汇/句型的官方 CEFR 分级 (如 `A1`, `B2` 等) |
| `pos` | `VARCHAR(20)` | NULL | 词性（如 `noun`, `verb`, `adj`），仅对单词或部分短语有效 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 最后更新时间 |

**唯一约束:**
- `uq_language_item_type_text` (`type`, `text`): 确保相同类型下的文本条目只存在一条，以防数据污染。

---

### 2.5 item_group 表 (学习项目组)

唯一的组织层级。支持多层嵌套，完美替代了已废弃的旧 `Curriculum/Unit/Lesson` 面向对象设计。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 组唯一标识 (默认 uuid4) |
| `parent_id` | `UUID` | FK(`item_group.id`, CASCADE), NULL, INDEX | 父组 ID。允许建立无限层级的树形关系（如 书 → 单元 → 课时） |
| `kind` | `VARCHAR(30)` | NOT NULL | 组类型：`textbook_book` (教科书), `textbook_unit` (单元), `textbook_lesson` (课时), `personal_collection` (个人收藏夹), `quick_practice` (快速练习), `review_set` (复习集) 等 |
| `name` | `VARCHAR(200)` | NOT NULL | 组名称 (如 `"Grade 3 Unit 1"`) |
| `owner_account_id` | `UUID` | NOT NULL, FK(`account.id`, CASCADE), INDEX | 所有者账号 ID |
| `cover_image_url` | `VARCHAR(500)` | NULL | 书籍或单元的封面图 URL |
| `prompt_notes` | `TEXT` | NULL | 提示词备注：当以此组为大纲对话时，该属性会被注入 LLM System Prompt |
| `source_book_hint` | `VARCHAR(200)` | NULL | 来源教材备注提示 |
| `archived` | `BOOLEAN` | NOT NULL, DEFAULT `false` | 是否已归档 (归档后在前端学习列表隐藏) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 最后更新时间 |

---

### 2.6 item_group_member 表 (项目组成员关系)

多对多关联表，将学习项目组与原子单元建立物理连接。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `group_id` | `UUID` | PK, FK(`item_group.id`, CASCADE) | 所属项目组 ID |
| `item_id` | `UUID` | PK, FK(`language_item.id`, CASCADE) | 对应的原子学习单元 ID |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 关联创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 关联更新时间 |

---

### 2.7 learner_item_stats 表 (掌握度统计)

针对每个具体学习者对于每个原子知识点的掌握程度和次数统计。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `learner_id` | `UUID` | PK, FK(`learner.id`, CASCADE) | 学习者 ID |
| `item_id` | `UUID` | PK, FK(`language_item.id`, CASCADE) | 原子单元 ID |
| `seen_count` | `INTEGER` | NOT NULL, DEFAULT `0` | 在对话中被学习者**听到/看到**的次数 (AI 说了这个词) |
| `used_count` | `INTEGER` | NOT NULL, DEFAULT `0` | 学习者在对话中**主动说出/使用**的次数 |
| `correct_count` | `INTEGER` | NOT NULL, DEFAULT `0` | 主动使用且发音或语法**正确**的次数 |
| `last_seen` | `TIMESTAMPTZ` | NULL | 上次在对话中碰到该词汇的时间 |
| `mastered_at` | `TIMESTAMPTZ` | NULL | 掌握该词汇的时间点。为 NULL 表示尚未达到掌握阈值 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 首次产生交互的记录时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 统计信息最后更新时间 |

---

### 2.8 learner_calibration_turn 表 (定级评估轮次)

记录初次对话中对学习者进行 CEFR 英语能力的校准轮次记录。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 评级记录唯一标识 (默认 uuid4) |
| `learner_id` | `UUID` | NOT NULL, FK(`learner.id`, CASCADE), INDEX | 学习者 ID |
| `session_id` | `UUID` | NOT NULL, FK(`session.id`, CASCADE) | 当前评估所依附的会话 ID |
| `turn_sequence` | `INTEGER` | NOT NULL | 该会话中的对话轮次序号 (从 1 开始) |
| `estimated_level` | `VARCHAR(4)` | NOT NULL | 该轮评估得出的 CEFR 水平 (如 `A1`, `A2` 等) |
| `confidence` | `VARCHAR(10)` | NOT NULL | 评估置信度 (如 `high`, `medium`, `low`) |
| `evidence` | `TEXT` | NULL | 评估依据：LLM 定级时给出的语法、词汇和流利度分析证据 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 评级时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 更新时间 |

---

### 2.9 session 表 (会话记录)

一个完整的对话会话，将一个学习者在某个特定目标下的多次来回问答汇聚在一起。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 会话唯一标识 (默认 uuid4) |
| `learner_id` | `UUID` | NOT NULL, FK(`learner.id`, CASCADE), INDEX | 参与会话的学习者 ID |
| `title` | `VARCHAR(200)` | NULL | 会话标题（初始为 NULL，在第一轮对话后由后台轻量 LLM 提炼生成，支持用户手动修改） |
| `deleted` | `BOOLEAN` | NOT NULL, DEFAULT `false` | 软删除标志。UI 过滤隐藏但 DB 保留用于结算审计与数据挖掘 |
| `group_id` | `UUID` | FK(`item_group.id`, SET NULL), NULL | 关联的学习组 ID。为 NULL 代表无大纲的自由练习模式 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 会话创建时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 最后活动时间 (每当有新轮次时触发 `TOUCH` 动作) |

---

### 2.10 turn 表 (对话轮次)

记录会话中的每次人机交互的详尽元数据。

| 字段名 | 类型 | 约束 | 描述 |
|---|---|---|---|
| `id` | `UUID` | PK | 轮次唯一标识 (默认 uuid4) |
| `learner_id` | `UUID` | NOT NULL, FK(`learner.id`, CASCADE), INDEX | 学习者 ID |
| `session_id` | `UUID` | NOT NULL, FK(`session.id`, CASCADE), INDEX | 归属的会话 ID |
| `sequence` | `INTEGER` | NOT NULL | 当前会话中的对话次序 (从 1 开始，单调递增) |
| `text_user` | `TEXT` | NOT NULL | 孩子所说的英语文本（经 STT 转译后） |
| `text_ai` | `TEXT` | NOT NULL | 陪伴机器人 Tina 的英语回复文本 |
| `audio_in_path` | `VARCHAR(512)` | NULL | 孩子语音输入的物理存放路径 (V1 存放在本地 `AUDIO_STORAGE_DIR`) |
| `audio_out_path` | `VARCHAR(512)` | NULL | AI 语音输出的物理存放路径 (由边缘云 TTS 生成) |
| `stt_audio_seconds` | `DOUBLE PRECISION` | NOT NULL, DEFAULT `0` | 输入语音的时长 (以秒计，用于核算成本与语速) |
| `llm_input_tokens` | `INTEGER` | NOT NULL, DEFAULT `0` | 本轮调用大模型消耗的输入 Token 数 |
| `llm_output_tokens` | `INTEGER` | NOT NULL, DEFAULT `0` | 本轮大模型返回的输出 Token 数 |
| `tts_chars` | `INTEGER` | NOT NULL, DEFAULT `0` | 合成 AI 语音所消耗的字符数 |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 本轮对话产生时间 |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | 更新时间 |
