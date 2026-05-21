# 课程与教学大纲设计 · Curriculum Design

> [!WARNING]
> **重要弃用声明与架构演进说明**  
> 本文档记录的旧版 `Curriculum` / `CurriculumUnit` / `CurriculumLesson` / `LessonItem` / `LearnerLesson` 数据库多表树形模型已在 V1 生产版本中**完全废弃**。  
> 
> 为了解决层级结构锁死、查询性能低下、无法灵活拓展自定义单词本等弊端，整个系统的数据底层已收敛为以 **`LanguageItem` (原子单元) + `ItemGroup` (万物皆组) + `ItemGroupMember` (多对多关联)** 为核心的统一内容模型。  
> 最新设计与数据标准请首要参阅：
> 1. [统一内容模型规范 · content-model.md](content-model.md)
> 2. [数据库结构字典 · data-dictionary.md](data-dictionary.md)

---

## 1. 核心产品愿景 (未变)

尽管底层的物理数据表结构发生了重大重构，但产品最核心的教学理念依然保持不变：**认得出已知词汇，并自然地向外踮脚推一寸 (i + 1)**。

当孩子在和 AI 机器人 Tina 对话时，听到刚好是今天课上学的新词，那种“我听懂了！”的正面反馈会带来无与伦比的开口自信。在 90% 已知词汇建立的安全感边界内，系统悄悄混入约 10% 的未学“进阶词汇” (Stretch Vocabulary)，从而实现边界的渐进式扩张。

市面上常见的闲聊 AI 无法实现这一核心价值，因为它们对孩子的学习进度毫无概念。我们的“大纲绑定与范围计算 (Scope Computing)”正是这款口语陪伴产品的核心商业护城河。

---

## 2. 废弃的旧设计方案归档与复盘

### 2.1 废弃的旧实体关系图 (Entity-Relationship)

在旧设计中，我们试图用一套非常死板的面向对象表关系来映射现实教材的编排方式：

```text
[已废弃]
Curriculum (课程/教材表)
  └── CurriculumUnit (单元表)
        └── CurriculumLesson (课时表/最小练习单位)
              ├── LessonItem (课时单词多对多映射) ──► LanguageItem (原子单元)
              └── LearnerLesson (学生已学记录表)
```

### 2.2 为什么必须废弃这套设计？

在前期开发和首批种子教材录入时，这套设计暴露出了严重的工程隐患和业务硬伤：

1. **层级结构完全锁死**：  
   现实生活中的教学材料千奇百怪。有些分级读物只有“Level”和“Book”，没有“Unit”；而日常英文绘本更是扁平的一本书一个词表，没有“Lesson”概念。旧表结构强行要求存在 `CurriculumUnit` 和 `CurriculumLesson`，导致我们在录入非传统教科书时，必须伪造大量的临时记录（如“Default Unit”、“Dummy Lesson”），造成严重的数据库垃圾。
   
2. **多表关联带来的高延迟**：  
   在每一轮对话发起前，Scope Computer 需要瞬间计算出孩子当前已学的所有词汇。在旧结构下，系统需要对 `learner_lesson`、`curriculum_lesson`、`lesson_item` 和 `language_item` 四张表做深度的 `JOIN` 查询。当学习历史变长后，高频的多表联查严重拖慢了 API 的响应首字延迟（TTFT）。
   
3. **功能孤岛问题**：  
   在旧架构下，“教科书教材”和用户自己上传创建的“自定义生词本”、“错词本”是完全隔绝的两套逻辑。这意味着如果我们想给生词本添加掌握度追踪，就必须为生词本单独再建一套表结构，代码复用率极低。

---

## 3. 全新演进方案：万物皆组 (Converged ItemGroup)

为了彻底根治上述痛点，我们将系统中的“层级组织”这一概念剥离出来，用单一的“组”实体完成自我迭代。

### 3.1 核心替代路径

旧关系体系被无缝收缩入以下三张表：

- **`LanguageItem`**：原子语言项。不再关心它属于哪本书，只记录它本身（如单词、短语、句型文本和 CEFR 等级）。
- **`ItemGroup`**：统一的项目组。新增 `parent_id` 自关联外键和 `kind` 字段。
- **`ItemGroupMember`**：原子项与组的多对多物理连接。

### 3.2 如何映射复杂的教材层级？

借助 `ItemGroup` 强大的自关联自嵌套树形结构，我们能够完美模拟且超越原有的任何复杂层级：

```text
[ItemGroup] ── (Book 节点: kind="textbook_book")
    └── [ItemGroup] (Unit 子节点: kind="textbook_unit", parent_id=Book.id)
          └── [ItemGroup] (Lesson 叶子节点: kind="textbook_lesson", parent_id=Unit.id)
                └── 连接多对多成员 ──► [LanguageItem] (单词/短语/句型)
```

而对于扁平化的“绘本大纲”或“个人生词本”，我们仅需要创建一个普通的 `ItemGroup` 记录即可：

```text
[ItemGroup] (个人词单: kind="personal_collection", parent_id=NULL)
    └── 连接多对多成员 ──► [LanguageItem] (单词)
```

这种“万物皆组”的设计完美兼顾了严谨的大纲约束与极度的业务灵活性。

---

## 4. 重构后的核心业务运转闭环

### 4.1 练习范围的计算 (Scope Computing)

- **课时专注模式**：当孩子开始某个特定课时 (如 Lesson 2) 的对话时，`session.group_id` 绑定对应的 `ItemGroup.id` (其 `kind` 为 `textbook_lesson`)。系统只加载该课时及前序所有课时组中的 `LanguageItem` 词汇。
- **自由对话模式**：`session.group_id` 设为 `NULL`。Scope Computer 会拉取该学习者名下所有已学过的 `ItemGroup` 包含的去重词汇合集，作为本次自由闲聊的已知安全范围。

### 4.2 句型与语法的智能检测 (Pattern Detection)

为了检验孩子是否掌握了大纲要求的句型 (Sentence Pattern)，系统采用分层检测策略：
- **实时扫描 (无感)**：在每一轮 turn 结束后，通过 Pydantic 快速进行小写 `anchor` 子串匹配，实时更新“该句型已被听到或说出”的状态。
- **离线分析 (Session 结束)**：当整个对话会话结束时，启动后台异步线程，调用一次 LLM 对完整的聊天上下文做全面的语法结构和语义合理性评估，并将详细分析写入 `learner_item_stats`。这避免了在每轮实时聊天中引入昂贵的句型判别延迟。
