# 课程体系设计

> 课程数据模型、掌握度追踪与 Scope Computer 集成的设计说明。
> 英文版：[`curriculum-design.md`](curriculum-design.md)

---

## 1. 产品愿景

产品的核心价值是**认出来**，然后**往外推一寸**：

> "咦，这就是我今天上课学的！"

孩子在对话里听到熟悉的词和句型，信心立刻建立起来。在此基础上，系统自然引入约 10% 的 stretch 词汇——来自下一个 lesson 或 unit——让孩子的边界每次都往外移一点点，而不是停留在舒适区。

豆包这类免费工具做不到这一点，因为它不知道孩子今天学了什么。我们的课程绑定就是产品的护城河。

家长的认知负担必须降到最低。大多数家长只知道"我们在学第 3 单元"，这已经足够了。系统从这个选择推导出完整的词表和语法范围——家长不需要说出任何学习目标。

---

## 2. 两类资源池

### 公共资源库
由团队维护。围绕可以干净提取、无版权风险的课程内容构建。家长从这个库里选择，设定孩子的练习范围。

### 私有素材
由家长个人上传，仅限本账号使用。覆盖那些永远不会进入公共库的教材长尾（培训机构自编材料、学校专供版本等）。服务条款明确：上传内容的版权合规性由家长自行负责。

### 版权策略
版权保护的是**具体表达**，不保护知识或事实本身。词汇、语法规则、句型结构均不受版权保护。以下内容**绝不**原文转录：

- 教材中的原创故事、对话或叙事文本
- 原版插图
- 在未获授权的情况下，在产品营销中使用教材名称

**公共库的安全做法：** 提取词汇表、句型和语法注意点；不引用原文；使用与出版商品牌无关的中性单元命名。

**完全不碰的内容：** 数字版授权内容（如 LingoAce 使用的 Reach Higher 课程）——家长没有持有拷贝许可。

---

## 3. 原子单位：`language_item`

任何课程最终都会分解为三种语言项：

| 类型 | 示例 | 检测方式 |
|---|---|---|
| `word`（单词） | `apple`、`purple` | 精确字符串匹配 |
| `phrase`（短语） | `make a decision`、`by the way` | 子串匹配 |
| `pattern`（句型） | `I like ___ and ___.`、`There have been ___` | anchor 子串 + session 结束时 LLM 分析 |

课程层级结构（Curriculum → Unit → Lesson）仅用于素材的录入和组织。一旦 item 被提取并关联到孩子的 scope，这个层级就不再参与练习循环。

### 语法注意点不是 item，但错误是分级的

语法规则（如"第三人称单数用 has，不用 have"；"元音前用 an"）以自由文本形式存储在 `CurriculumLesson.prompt_notes` 中，session 开始时注入 system prompt。

错误纠正遵循**优先级机制**，不是全部纠正，也不是全部忽略：

- **最高优先级（必纠）：** 冠词类错误（the + 可数名词、a/an 选择）——这类错误在中国学习者里高频且持久，不纠正会固化
- **次要优先级：** 其他语法错误，视积累程度逐步提示

**纠正方式是延迟的**，不打断孩子当前的表达——在当次 turn 结束后或 session 结束报告里呈现，不实时插话。

**V1 实现：** session 结束的 LLM 分析调用同时检测语法错误，结果存表备用，数据先收集。  
**V2 实现：** 报告 UI 上颜色分级展示（最高优先级用醒目色），点击查看规则说明，积累到阈值再主动提示孩子。

---

## 4. 层级结构：为什么 Lesson 是最小练习单位

真实课堂数据表明，每个 Unit 至少跨越两节课（通常更多），每节课有各自独立的词汇和语法重点：

```
Kids Corner Book 1 — Starter Unit 4
  Lesson 1 (4.19)：10 个颜色词 + 2 个句型，无语法注意点
  Lesson 2 (4.26)：6 个服装词 + 1 个句型 + 3 条语法注意点
```

Unit 粒度的 scope 太宽——它把不同课时的词汇和语法混在一起。Lesson 粒度的 scope 让孩子正好练今天课上学的内容。

```
Curriculum（课程/教材）
  └── CurriculumUnit（单元，用于分组/展示）
        └── CurriculumLesson（练习最小单位）
              └── LessonItem → LanguageItem
```

---

## 5. 数据库 Schema

所有 model 继承 `TimestampMixin`（`created_at`、`updated_at`）。所有主键为 UUID，在应用层生成。

### `language_item`
全局语言项目录，跨课程共享。不存 level——同一个词在不同课程里难度不同，level 由 lesson 上下文决定，不属于词本身。

```
id      UUID PK
type    VARCHAR(10)   -- "word" | "phrase" | "pattern"
text    VARCHAR(200)  -- "apple" / "make a decision" / "I like ___ and ___."
anchor  VARCHAR(200)  -- 小写固定子串，用于快速检测
                      -- "I like ___ and ___." 的 anchor = "i like"

UNIQUE (type, text)
```

### `curriculum`

```
id                UUID PK
name              VARCHAR(200)   -- "Kids Corner Book 1"
publisher         VARCHAR(200)
is_public         BOOLEAN DEFAULT FALSE
owner_account_id  UUID NULL      -- NULL = 公共库
                                 -- FK → account  ON DELETE SET NULL
```

### `curriculum_unit`

```
id              UUID PK
curriculum_id   UUID    FK → curriculum  ON DELETE CASCADE
sequence        INTEGER
unit_number     VARCHAR(50)   -- "Starter Unit 4"（灵活，不强制整数）
title           VARCHAR(200)  -- "A New Adventure"
```

### `curriculum_lesson`
练习最小单位。存储注入 system prompt 的语法注意点和引导指令。

```
id            UUID PK
unit_id       UUID     FK → curriculum_unit  ON DELETE CASCADE
sequence      INTEGER
title         VARCHAR(200) NULL  -- "Lesson 1" 或更具体的标题
prompt_notes  TEXT NULL          -- 语法注意点，session 开始时注入 system prompt
focus_instructions TEXT NULL     -- 引导指令，指定 AI 在该节课中特定的互动方式或角色
```

### `lesson_item`
lesson 与 language_item 的多对多关联表。

```
lesson_id  UUID    FK → curriculum_lesson  ON DELETE CASCADE
item_id    UUID    FK → language_item      ON DELETE CASCADE

PK (lesson_id, item_id)
```

### `learner` (新增 AI 设定字段)
学生配置，包含用户自定义的 AI 导师人设。每次 Session 都会将这里设定的角色信息注入给 LLM。

```
id                 UUID PK
account_id         UUID     FK → account  ON DELETE CASCADE
name               VARCHAR(100)
ai_name            VARCHAR(100) DEFAULT 'Tina'
ai_gender          VARCHAR(10)  DEFAULT 'female'
ai_persona_prompt  TEXT NULL    -- 用户设置的 AI 角色设定（例如"你是一个幽默的海盗"）
```

### `learner_lesson`
孩子已学 lesson 的追加日志。随着孩子持续上课，行数持续增长；只增不删（除非家长主动退出某个课程）。`TimestampMixin` 的 `created_at` 即为添加时间。

```
learner_id  UUID   FK → learner            ON DELETE CASCADE
lesson_id   UUID   FK → curriculum_lesson  ON DELETE CASCADE

PK (learner_id, lesson_id)
```

### `learner_item_stats`
掌握度追踪。**仅在 item 第一次出现时才创建该行**（不在 enrollment 时预填充）。没有对应行意味着该 item 从未在 session 中出现过。

```
learner_id     UUID       FK → learner        ON DELETE CASCADE
item_id        UUID       FK → language_item  ON DELETE CASCADE
seen_count     INTEGER DEFAULT 0   -- item 出现在 session 上下文中
used_count     INTEGER DEFAULT 0   -- 孩子在发言中使用了该 item
correct_count  INTEGER DEFAULT 0   -- LLM 判断用法正确
last_seen      TIMESTAMP NULL

PK (learner_id, item_id)
```

### `session`（现有表，新增一个字段）

```
lesson_id   UUID NULL   FK → curriculum_lesson  ON DELETE SET NULL
                        -- NULL = 自由练习（无课程绑定）
```

---

## 6. 两层绑定关系

```
第一层 — 已学 lesson（追加式，随上课持续增长）
  LearnerLesson：learner_id + lesson_id
  "这个孩子已学过 Kids Corner Book 1 的 Lesson 1 和 Lesson 2。"

第二层 — Session 焦点（开始练习时选择）
  session.lesson_id
  "这次 session 专练 Lesson 2。"
```

开 session 时，UI 展示"最近学的几节课"作为快捷入口，最新一节默认选中。孩子也可以往回选旧 lesson 复习。Scope Computer 读 `session.lesson_id` 来获取当次 session 的 item 范围。`LearnerLesson` 用于展示孩子的学习历史和整体进度。

---

## 7. Scope Computer 查询

**有 lesson 绑定的 session：**

```sql
SELECT li.*
FROM   language_item li
JOIN   lesson_item   lsi ON lsi.item_id  = li.id
WHERE  lsi.lesson_id = :session_lesson_id
LEFT JOIN learner_item_stats s
  ON s.item_id = li.id AND s.learner_id = :learner_id
ORDER BY COALESCE(s.correct_count, 0) ASC,
         COALESCE(s.seen_count, 0)    ASC
-- 最弱的 item 优先出现
```

**自由练习（`session.lesson_id = NULL`）：** scope = 孩子所有已学 lesson 的全量词汇

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

自由练习没有 `prompt_notes` 注入，没有 pattern 练习焦点，但掌握度数据同样正常更新。

获取当次 session 的 `prompt_notes`（仅有 lesson 绑定时）：
```sql
SELECT prompt_notes
FROM   curriculum_lesson
WHERE  id = :session_lesson_id
  AND  prompt_notes IS NOT NULL
```

---

## 8. Pattern 检测策略

检测孩子是否使用了某个 pattern，不能单靠字符串匹配。采用两层方案：

**第一层 — anchor 匹配（实时，零成本）**
每个 pattern 存储一个小写 `anchor`（固定部分）。STT 完成后，检查孩子的文本中是否包含该 anchor 子串。用于记录"item 出现了"。

**第二层 — LLM 分析（session 结束时，一次调用）**
Session 结束后，将完整对话记录和目标 pattern 列表发给 LLM，询问："孩子是否使用了每个 pattern？用法是否正确？"同时检测语法错误（按优先级分类）。然后更新 `learner_item_stats` 的 `used_count` 和 `correct_count`。

每个 session 只调用一次 LLM，而不是每个 turn 调用一次。Session 通常持续 5–15 分钟，这个成本可以接受，且为异步非阻塞操作。

---

## 9. 完整 Session 流程（含课程绑定）

```
家长给孩子添加已学 lesson
  → 写入 LearnerLesson 行（每上完一节课追加一行）

孩子打开练习界面
  → UI 展示最近学的 lesson，最新一节默认选中
  → 创建 session，写入 lesson_id（或 NULL 自由练习）

Session 开始
  → Scope Computer 加载 item 列表、prompt_notes 和 focus_instructions
  → 从 Learner 表读取 ai_name 和 ai_persona_prompt
  → 组装 system prompt：
      "AI 角色：你的名字是 {ai_name}。{ai_persona_prompt}"
      "词汇范围：red, yellow, blue... dress, jacket..."
      "引导孩子使用以下句型：'What colors do you like?'、'I like ___ and ___'"
      "语法注意点：he/she 用 has；元音前用 an"
      "课程引导：{focus_instructions}"

每个 turn（实时）
  → STT → LLM → TTS
  → 对孩子的文本做 anchor 扫描 → 立即更新 seen_count

Session 结束（异步，不阻塞用户）
  → 对完整对话做一次 LLM 分析
  → upsert learner_item_stats（correct_count、used_count、last_seen）
  → 记录语法错误数据（V1 收集，V2 展示）
```

---

## 10. Kids Corner Book 1 — Starter Unit 4（参考数据）

首批进入公共库的数据集，对应 schema 如下：

```
curriculum:  Kids Corner Book 1  (is_public=true)
  unit:      Starter Unit 4 / "A New Adventure"  (sequence=4)

    lesson:  Lesson 1  (sequence=1, prompt_notes=NULL)
      单词：red, yellow, blue, green, orange, brown,
            pink, purple, black, white
      句型：
        "What colors do you like?"   anchor="what colors do you like"
        "I like ___ and ___."        anchor="i like"

    lesson:  Lesson 2  (sequence=2)
      prompt_notes: |
        Use 'has' for he/she (third person singular); 'have' for I/you/they.
        Clothing nouns: singular vs plural (a jacket / two jackets).
        'an' before vowel sounds: an orange T-shirt, an orange skirt.
      单词：dress, jacket, T-shirt, jeans, pants, skirt
      句型：
        "He/She has a ___ ___."      anchor="has a"
```

---

## 11. 待决问题

- **公共库种子数据：** 优先覆盖哪些教材？建议顺序：人教版 1–3 年级，然后 Kids Corner 系列，之后根据用户需求驱动。
- **私有上传 pipeline：** 拍照 OCR → AI 提取 → 家长确认 → 写入 LessonItem。老师在微信群发的课堂总结（纯文本）比书本照片更有用——考虑把"粘贴老师消息"作为主要的私有上传入口。
- **Stretch 词汇来源：** Scope Computer V2 引入 stretch 时，stretch 词从哪里来？下一个未学 lesson？同 unit 的其他 lesson？需要在 V2 设计时明确。
- **语法错误优先级表：** V2 实现错误分级展示时，需要定义完整的 `grammar_rule` 表（rule name、priority、error pattern 描述）。高优先级规则（冠词类）可以在 V1 就开始数据收集。
- **掌握度定义：** 什么阈值表示"已掌握"？尚未定义。建议初始值：在至少 2 个不同 session 中 `correct_count >= 3`。
- **IELTS / 成人内容：** `language_item` 模型支持成人级别的 pattern 和论点短语。话语策略（methodology 层）V1 不在范围内，将来需要独立的 `speaking_methodology` 模型。
