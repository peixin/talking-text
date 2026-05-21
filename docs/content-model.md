# 内容模型设计

> 本文档是 2026-05-15 头脑风暴后收敛的设计方案。它完全替代了早期的 [`curriculum-design.md`](curriculum-design.md) 中关于将 Curriculum（课程）、Unit（单元）、Lesson（课时）作为独立数据库实体的设计。

---

## 1. 为什么需要重构

在最初的设计中，`Curriculum / CurriculumUnit / CurriculumLesson` 被视为核心的底层实体。后来为了支持用户的个人单词表，又引入了独立的 `Collection / CollectionItem` 模型，并计划在其上建立一个基于 pgvector 的标签/主题系统。

这种做法导致了两个平行的实体（课程和个人集）在竞争同一个概念实体（即学习者所学习的语言项范围），从而引发了一系列问题：
- `V1ScopeComputer` 必须分支处理 `collection_id` 和 `lesson_id`。
- 内容录入流程被分裂为“保存到课时”和“保存到个人集”。
- 前端页面不得不为几乎相同的数据维护两套平行的 UI 标签页。
- 学习者的掌握度追踪、分享机制和推荐系统在两套实体下行为不一致。

本文档记录了收敛后的“统一内容模型”，彻底解决了上述分裂问题。

---

## 2. 收敛后的设计原则（核心基石）

1. **`language_item` 是唯一的原子实体。** 全局单表，通过 `UNIQUE (type, text)` 进行去重。它携带由 LLM 在录入时自动生成的轻量级标签（如 `cefr_level`、`pos`）。所有的掌握度统计、错误收集都直接挂载到语言项上。
2. **`item_group` 是唯一的组织实体。** 单个表，通过 `parent_id` 自关联实现任意层级的树状结构。通过 `kind` 字段来区分不同的群组类型，如：教科书书籍（`textbook_book`）、教科书单元（`textbook_unit`）、教科书课时（`textbook_lesson`）、个人收藏夹（`personal_collection`）、快速练习册（`quick_practice`）以及系统生成的复习集（`review_set`）。这彻底取代了原本零散的课程、单元、课时、收藏夹多张表。
3. **掌握度挂载到语言项上，而不是群组上。** 学习者对某单词的掌握度记录在 `learner_item_stats(learner_id, item_id)` 中。无论该单词是在教科书中出现的，还是在个人收藏的图片中出现的，都将写入同一行统计数据。
4. **无需海量预置数据，系统随着使用自行演进。** 运作机制：(a) 写入单词时进行全局去重，(b) 第一个录入某本书的用户声明一次书籍元数据，(c) 后续录入相同书籍的用户通过指纹匹配直接关联。大约 20 个活跃的早期用户就能覆盖国内大部分主流的 K-6 小学英语教材。
5. **内容录入 = “AI 自动识别 + 用户极简确认”。** AI 自动从图片中提取单词，识别页面元数据（如 Unit 3, Page 12），并提议书籍名称。用户只需要进行最简单的微调（如打字、拍封面或语音修改）。默认值全部由 AI 生成，用户的职责是纠错而非从零创作。
6. **分享 = 克隆，而非引用。** 分享链接会将该群组及其子树完整地克隆到接收者的账户下。由于底层的 `language_item` 是全局共享的（同一单词只有一行记录），因此克隆不会导致单词重复。同时，学习者的掌握度数据绝不在账户间共享或转移。
7. **通过展示层而非强求用户来解决“凌乱”问题。** 推荐系统根据使用热度与质量得分来过滤内容。命名随意的临时群组（如 "aaa"）绝不会出现在推荐列表中。在推荐 UI 中，单词内容预览（而非群组名称）是首要的识别特征。
8. **V1 阶段延后实现“主题标签 / pgvector 向量系统”。** 目前 CEFR 难度级别（A1-C2）加词性（Part-of-Speech）已足够使用。等未来用户规模扩大后，再引入更丰富的语义向量特征。
9. **学习历史是一个查询视图，而非独立的表。** 通过联查 `session`、`turn`、`learner_item_stats` 以及 `session_error`（V1暂存，V2展示），即可派生出所有需要的历史视图，在 V1 规模下无需额外维护聚合表。

---

## 3. 数据库表结构

所有数据表都继承 `TimestampMixin`（自动管理 `created_at` 和 `updated_at` 字段）。所有主键均由应用层生成 UUID。

### 3.1 原子语言项 (The Atom)

```
language_item
  id            UUID PK
  type          VARCHAR(10)        -- 类别: word | phrase | pattern
  text          VARCHAR(200)       -- 文本内容
  anchor        VARCHAR(200)       -- 小写固定子串，用于句型检测 (如 pattern "I like ___" 对应 anchor "i like")
  cefr_level    VARCHAR(4) NULL    -- 难度: A1 | A2 | B1 | B2 | C1 | C2
  pos           VARCHAR(20) NULL   -- 词性: noun | verb | adj | adv | prep | ...

  UNIQUE (type, text)
```

### 3.2 组织实体 (The Organizing Entity)

```
item_group
  id                UUID PK
  parent_id         UUID NULL          -- 自关联外键 FK → item_group.id (ON DELETE CASCADE)
  kind              VARCHAR(30)        -- 类型: textbook_book | textbook_unit | textbook_lesson | personal_collection | quick_practice | review_set
  name              VARCHAR(200)       -- 显示名称
  owner_account_id  UUID               -- 所属账户外键 FK → account (ON DELETE CASCADE)

  cover_image_url   VARCHAR(500) NULL  -- 封面图片 (在书籍级别有意义)
  prompt_notes      TEXT NULL          -- 专为 System Prompt 生成的语法重点与引导提示
  source_book_hint  VARCHAR(200) NULL  -- AI 提取或用户声明的来源书名，供未来匹配
```

```
item_group_member
  group_id  UUID  外键 FK → item_group.id     (ON DELETE CASCADE)
  item_id   UUID  外键 FK → language_item.id  (ON DELETE CASCADE)
  PK (group_id, item_id)
```

### 3.3 分享与克隆（V2 支持，V1 留空）

```
group_share_link
  id          UUID PK
  group_id    UUID            外键 FK → item_group.id (ON DELETE CASCADE)
  code        VARCHAR(32) UNIQUE
  created_by  UUID            外键 FK → account.id
  expires_at  TIMESTAMP NULL
```

```
group_adoption
  source_group_id  UUID  外键 FK → item_group.id (ON DELETE SET NULL)
  target_group_id  UUID  外键 FK → item_group.id (ON DELETE CASCADE) -- 即克隆体
  adopted_by       UUID  外键 FK → account.id
  PK (source_group_id, target_group_id)
```

克隆关系表可用于统计群组的“采纳次数”，从而在未来计算群组的质量分并进行推荐。

### 3.4 掌握度 (Mastery)

```
learner_item_stats
  learner_id     UUID         外键 FK → learner.id        (ON DELETE CASCADE)
  item_id        UUID         外键 FK → language_item.id  (ON DELETE CASCADE)
  seen_count     INTEGER  DEFAULT 0
  used_count     INTEGER  DEFAULT 0
  correct_count  INTEGER  DEFAULT 0
  last_seen      TIMESTAMP NULL
  mastered_at    TIMESTAMP NULL    -- 首次达到掌握阈值的时间
  PK (learner_id, item_id)
```

**掌握判定阈值：** V1 初始标准定为 `correct_count >= 3` 且 `used_count >= 3`，且跨越 `2 次及以上不同的对话会话`。上线后根据真实数据优化。

### 3.5 会话关联 (Session Linkage)

```
session （在原有表上增加一个字段）
  group_id  UUID NULL  外键 FK → item_group.id (ON DELETE SET NULL)
            -- NULL 表示自由对话（练习范围默认为学习者已掌握或接触过的全部词表）
```

### 3.6 错误收集 (Error Collection)

```
session_error
  id                UUID PK
  session_id        UUID         外键 FK → session.id  (ON DELETE CASCADE)
  learner_id        UUID         外键 FK → learner.id  (ON DELETE CASCADE)
  error_type        VARCHAR(40)  -- 错误类别: article | tense | agreement | preposition | word_order | ...
  excerpt           TEXT         -- 孩子实际说出的话语片段
  correction        TEXT         -- 系统给出的纠正版本
  rule_explanation  TEXT NULL    -- 语法规则中文解析
```

V1 阶段：仅静默收集，不干扰对话。V2 阶段：在家长后台报告中呈现。

---

## 4. 教材录入流 (Ingestion Flow)

### 阶段一：单账号录入自有教材 (V1 当前)
- 家长拍照上传或粘贴单词表文本。
- 调用 AI 提取语言项列表、页面元数据（如单元数、页码）以及可能的书籍名称。
- 系统在当前账号已有的书籍中进行匹配：匹配成功则将页面合并入旧书；匹配失败则建议创建新书。
- 家长对 AI 识别结果进行极简确认或覆盖修改。
- 写入数据库：将生成的 `language_item` 进行唯一去重并与新的 `item_group` 树相关联。

### 阶段二：跨账号指纹匹配 (V2 阶段)
- 当用户录入时，如果提取出的单词重合度与全网其他用户的某本书重合度大于设定阈值，系统主动弹出“是否直接使用其他家长的版本”。确认后直接采用克隆机制，省去校对成本。

### 阶段三：全网权威数据浮现 (V3 阶段)
- 通过克隆采纳数量和活跃度，自动浮现并精选出“全网最优质教科书版本”，置顶展示在公共浏览库中。

---

## 5. 分享与克隆动力学

1. 拥有者生成一个 `group_share_link`。
2. 接收者打开链接，系统为接收者克隆整棵群组子树：
   - 在接收者账户下创建全新的 `item_group`（拥有独立的 ID）。
   - 新群组的 `item_group_member` 直接关联全局唯一的 `language_item` ID。
   - 级联克隆所有子群组。
   - 记录 `group_adoption`。
3. 接收者可以自由重命名、增删克隆出来的群组，对原分享者毫无影响。
4. 掌握度数据永不克隆，接收者从 0 开始累计。

V1 只支持“克隆式采纳”。后续原分享者的修改默认不会同步给克隆体，以保证用户对自身收藏夹的绝对修改自主权。

---

## 6. 历史视图数据派生

所有学习进度和历史视图均可通过现有表快速联查派生，无需建立任何累赘的中间同步表：

| 历史视图需求 | SQL 派生逻辑草图 |
|---|---|
| 最近对话记录 | `SELECT * FROM session WHERE learner_id ORDER BY started_at DESC LIMIT N` |
| 已练习的群组 | `SELECT DISTINCT group_id, MAX(started_at) FROM session WHERE learner_id GROUP BY group_id` |
| 本周掌握的新词 | `COUNT(*) FROM learner_item_stats WHERE learner_id AND mastered_at > date_trunc('week', now())` |
| 累计练习时长 | `SUM(ended_at - started_at) FROM session WHERE learner_id` |
| 语法语法频次排行 | `SELECT error_type, COUNT(*) FROM session_error WHERE learner_id GROUP BY error_type` |
| 难度级别 CEFR 进度 | `JOIN learner_item_stats × language_item GROUP BY cefr_level` |
| 对话内容回放 | `SELECT * FROM turn WHERE session_id ORDER BY sequence` |

---

## 7. V1 功能裁剪清单 (V1 Scope Cut)

| 已在 V1 实现 | 延后到 V2 阶段实现 |
|---|---|
| 录入时自动识别并打上 CEFR 与 POS 标签 | 主题和标签细分体系（Topic Tags） |
| 基于 `parent_id` 的群组树状层级关系 | 基于 pgvector 向量相似度进行内容关联 |
| 单个账号层面的教材指纹匹配 | 跨账号全网教材匹配 |
| 一键声明书籍元数据与封面管理 | 全网精选权威教材大厅（Discovery） |
| 通过会话结束后的 LLM 异步分析评估掌握度 | 每一轮对话完即时计算微掌握度 |
| `session_error` 语法错误静默收集 | 家长端语法纠错可视化与图表分析 |
| 基于克隆的群组分享链接机制 | 原作修改自动向下游克隆体广播同步 |
