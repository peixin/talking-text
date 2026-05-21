# 课程管理端到端设计规格书与实施计划 · 2026-05-04

> [!WARNING]
> ### ⚠️ 重大架构演进与废弃公告 (Deprecated Warning)
> 本文档记录的 2026-05-04 课程系统设计中，关于 **`Curriculum / CurriculumUnit / CurriculumLesson / LessonItem / LearnerLesson`** 的多表关系型树状模型，在后续系统进行的**“内容模型大收敛 (Converged Content Model)”**重构中已**被全面废弃**。
>
> **演进决策与前因后果**：
> 1. **为什么废弃**：原多表树状模型虽然直观反映了实体教材的物理结构，但层级过于死板僵化。在面对绘本、个性化分级读物、多端自定义词本等异构学习材料的录入和绑定时，缺乏弹性；且多表复杂 JOIN 关联导致在 Scope 判定查询时性能低下（耗时高达约 80ms）。
> 2. **最新替代方案**：目前已全面过渡到**“万物皆组”**的自关联树模型——由统一的 **`ItemGroup`**（具备 `parent_id` 自关联指针实现无限级树状拓扑）与 **`ItemGroupMember`** 关联表取代了旧有的课程、单元、课时表。
> 3. **最新收益**：重构后不仅数据表数量由 14 张精简为 10 张（极大地减轻了底层心智和迁移负担），而且将词表判定与范围提取时间从原先的 ~80ms 极限压缩到了 **~4ms**，极大地提升了系统的运行性能。
>
> *本文档作为项目关键研发里程碑予以完整保留，以便于追溯核心的流式作用域计算与动态系统提示词组装的历史逻辑。*

---

## 第一部分：课程端到端设计规格书 (Design Spec)

### 1. 设计目标与核心流程

目标：使学生在选择特定课时后，AI 伴学助手 Tina 能够在谈话中精确运用该课时定义的单词与句型范围（Scope）进行交互，并在聊天页面顶部显示当前课时横幅。

```
家长设定学习者课时 (学习者个人主页)
  → 孩子开启对话 → 页面顶部呈现当前课时横幅 (LessonBannerClient)
  → 创建会话 (Session) 并绑定 lesson_id
  → 作用域计算器 (Scope Computer) 加载当前课时的 items + focus_instructions
  → 系统提示词组装器 (Prompt Assembler) 构造含有词汇与句型约束的系统提示词
  → 孩子开始聊天；Tina 的话语完全限制在课时大纲范围内
```

---

### 2. 数据库设计 (原 7 表树状多表设计)

#### 2.1 新增数据表结构

* **`language_item`** (语言实体原子表)
  * `id`: UUID (PK)
  * `type`: VARCHAR(10) —— `"word"` | `"phrase"` | `"pattern"`
  * `text`: VARCHAR(200) —— 文本内容 (如 "dress", "I like ___.")
  * `anchor`: VARCHAR(200) —— 用于正则或固定子串匹配的标准化锚点 (小写，如 "i like")
  * *唯一约束*: `UNIQUE (type, text)`

* **`curriculum`** (课程教材主表)
  * `id`: UUID (PK)
  * `name`: VARCHAR(200) —— 课程名称 (如 "Kids Corner Book 1")
  * `publisher`: VARCHAR(200) (Nullable) —— 出版社
  * `is_public`: BOOLEAN (Default: False) —— 是否公开
  * `owner_account_id`: UUID (Nullable) (FK → account) —— 专属所有者账号

* **`curriculum_unit`** (课程单元表)
  * `id`: UUID (PK)
  * `curriculum_id`: UUID (FK → curriculum ON DELETE CASCADE)
  * `sequence`: INTEGER —— 单元排序序号
  * `unit_number`: VARCHAR(50) —— 单元编号 (如 "Starter Unit 4")
  * `title`: VARCHAR(200) —— 单元标题

* **`curriculum_lesson`** (课程课时表)
  * `id`: UUID (PK)
  * `unit_id`: UUID (FK → curriculum_unit ON DELETE CASCADE)
  * `sequence`: INTEGER —— 课时排序序号
  * `title`: VARCHAR(200) (Nullable) —— 课时标题
  * `prompt_notes`: TEXT (Nullable) —— 教学法提示词/语法微调规则
  * `focus_instructions`: TEXT (Nullable) —— 课堂对话场景专注指导

* **`lesson_item`** (课时词汇句型关联表)
  * `lesson_id`: UUID (FK → curriculum_lesson)
  * `item_id`: UUID (FK → language_item)
  * *主键*: `PK (lesson_id, item_id)`

* **`learner_lesson`** (学习者选课日志表)
  * `learner_id`: UUID (FK → learner)
  * `lesson_id`: UUID (FK → curriculum_lesson)
  * *主键*: `PK (learner_id, lesson_id)`

* **`learner_item_stats`** (学习者词汇掌握度度量表 - 暂不写入)
  * `learner_id`: UUID (FK → learner)
  * `item_id`: UUID (FK → language_item)
  * `seen_count`: INTEGER (Default: 0) —— 见过次数
  * `used_count`: INTEGER (Default: 0) —— 主动使用次数
  * `correct_count`: INTEGER (Default: 0) —— 正确次数
  * `last_seen`: TIMESTAMP (Nullable) —— 上次相遇时间
  * *主键*: `PK (learner_id, item_id)`

#### 2.2 现有会话表扩展
* **`session`** —— 新增两个可为空的绑定外键列：
  * `lesson_id`: UUID (Nullable) (FK → curriculum_lesson) —— 绑定单一课时
  * `collection_id`: UUID (Nullable) —— 绑定特定语集 (留作未来扩展)

---

### 3. 核心机制设计

#### 3.1 作用域计算器协议 (Scope Computer Protocol)
在每次 `process_turn()` 处理对话之初，依据 `session.lesson_id` 触发一次数据库查询，提取该课时关联的所有单词、短语和句型模式：

```python
class ScopeComputer(Protocol):
    async def get_scope(
        self,
        db: AsyncSession,
        learner_id: UUID,
        lesson_id: UUID | None,
        collection_id: UUID | None,
    ) -> ScopeResult: ...
```

#### 3.2 动态系统提示词组装器 (Prompt Assembler)
输入获取的作用域结果，动态拼接输出纯英文的系统级 Prompt 提示词：

```python
def build_system_prompt(scope: ScopeResult) -> str: ...
```

**输出的 Prompt 结构示意**：
```
[Tina Persona (基础人设 - 恒常渲染)]
You are Tina, a warm and patient English teacher... (限制在 15 词内短句，温和纠错，一次一问)

[Vocabulary Section (词汇与短语节 - 仅在 Scope 含有词汇时渲染)]
The child has learned these vocabulary items. Use them naturally:
  Words: red, yellow, blue, dress, jacket...

[Patterns Section (句型句式节 - 仅在 Scope 含有句型时渲染)]
Practice these sentence patterns today. Guide the child to use them:
  • "What colors do you like?"
  • "I like ___ and ___."

[Grammar notes & Focus instructions (教学与聚焦指导节)]
Grammar notes: Use 'has' for he/she; 'an' before vowel sounds...
Today's practice focus: Topic describing characters' colorful outfits...
```

---

## 第二部分：课程端到端实施计划 (Implementation Plan)

### Task 1: 课程 DB 模型定义与导出

在后端编写核心的课程、课时及关联表的映射。
* **文件**：`backend/app/storage/models/curriculum.py` 及 `backend/app/storage/models/__init__.py`

**主要代码实现**：
1. 声明 `LanguageItem` 映射表，支持 `word`, `phrase`, `pattern` 类型的定义与标准化小写 `anchor` 字段存储。
2. 声明 `Curriculum`、`CurriculumUnit`、`CurriculumLesson` 树状表结构，设立合理的 `ondelete="CASCADE"` 级联删除机制。
3. 声明多对多关系表 `LessonItem` 以及用户侧的绑定关系表 `LearnerLesson`。

---

### Task 2: 会话 Session 表级扩展

在 `backend/app/storage/models/session.py` 中引入 `lesson_id` 与 `collection_id` 属性，用于锁定该会话绑定的教学上下文，并在接口输出层增加相应的输出转换映射。

---

### Task 3: 数据库迁移 Alembic 执行与校验

使用 Alembic 自动生成迁移脚本，检查迁移逻辑是否包含：
1. 在时间字段上配置合理的 `server_default=sa.text("now()")` 默认时间戳。
2. `session` 变更时建立可靠的 `lesson_id` 到 `curriculum_lesson` 的 SET NULL 外键级联，确保课时即使被物理删除，用户的历史对话记录依然安全不丢失。
3. 运行 `just db-up` 将迁移应用到本地 PostgreSQL，确保全部新表健康建立。

---

### Task 4: 基础数据 Seed 数据写入

编写幂等的 Seed 初始脚本 `backend/scripts/seed_kids_corner_u4.py`，用于导入系统首个体验包（剑桥 **Kids Corner Book 1 - Starter Unit 4**）。

* **包含数据**：
  * **Lesson 1**：颜色词汇 (red, yellow, blue, green 等)，包含句型 `"What colors do you like?"` 及 `"I like ___ and ___."`。
  * **Lesson 2**：衣物词汇 (dress, jacket, T-shirt, jeans, pants, skirt)，包含句型 `"He/She has a ___ ___."`；在 `prompt_notes` 中加入单复数及冠词 vowel sounds 辅音纠偏策略，并在 `focus_instructions` 中指定关于描述怪物穿衣（monster dress-up）的口语练习话题。

---

### Task 5: 作用域计算协议与实现

* **协议文件**：`backend/app/core/scope/protocol.py`
* **实现文件**：`backend/app/core/scope/v1.py`

在 `V1ScopeComputer` 中通过对 `LessonItem` 与 `LanguageItem` 执行 `JOIN` 关联查询，将当前绑定 `lesson_id` 下的全部类型元素拉出，并在内存中进行划分与组装：
```python
words = [item.text for item in items if item.type == "word"]
patterns = [PatternItem(text=item.text, anchor=item.anchor) for item in items if item.type == "pattern"]
```

---

### Task 6: 系统提示词动态组装器实现

* **文件**：`backend/app/core/prompt/assembler.py`

实现无副作用的纯函数 `build_system_prompt`：
1. 永远以 `_TINA_PERSONA` 作为基底前缀。
2. 动态依据 `ScopeResult` 的内容进行拼接。如果 Scope 为空（例如自由练习对话模式），直接降级退化返回基础的 Tina 陪伴提示词，杜绝空标头和排版错误。
3. 在 `tests/test_prompt_assembler.py` 中编写完备的单体测试用例，覆盖：
   * 正常状态下的词汇与句型组装拼装；
   * 空 Scope 的零注入退化回归；
   * 特殊教学法备注与课程聚焦提示的条件性追加。

---

### Task 7: 接口路由与鉴权逻辑

* **文件**：`backend/app/api/curriculum.py`

新增以下 5 个 API 路由端点：
1. `GET /curricula` —— 获取当前系统内公开（`is_public=true`）的课程大纲列表。
2. `GET /curricula/{curriculum_id}/lessons` —— 递归以树状拓扑输出某个课程下单元及课时的嵌套字典树。
3. `POST /learners/{learner_id}/lessons` —— 学习者绑定选课关系接口（校验当前操作人必须为该学习者的所有者，即 `learner.account_id == current_account.id`）。
4. `DELETE /learners/{learner_id}/lessons/{lesson_id}` —— 解绑或移除某个当前学习者的已选课时。
5. `GET /learners/{learner_id}/lessons` —— 查询当前学习者所有已被 enroll 的学习路线任务，依选课时间降序排列。

---

### Task 8: 前端界面集成

#### 8.1 学习者选课管理面板 (Learner Home Page)
* **文件路径**：`frontend/app/[locale]/(app)/learner/[learnerId]/`
* **交互细节**：
  * 家长端主界面：显示当前孩子已添加的课程教材包（如 "Kids Corner Book 1"）。
  * 引入 `Collapsible` 组件以树状折叠面板形式展示大纲。
  * 提供 `LessonPickerClient` 弹窗对话框（通过 enroll 模式）实现大纲浏览与多选添加。
  * 点击“开始练习”后，将定位至最新绑定的课时 `lesson_id`，并无缝跳转到聊天会话中。

#### 8.2 聊天界面横幅联动 (Chat Lesson Banner)
* **文件路径**：`frontend/components/LessonBannerClient.tsx`
* **横幅设计**：
  * 在聊天输入对话流头部固定一个醒目的课时状态条，展示类似于：`📚 Starter Unit 4 · Lesson 2 (6 words · 1 pattern)` 的元信息。
  * 点击 `[Switch]` 可以切换为在当前学习者已 enrolled 的课时中进行单选跳转。
  * 若当前没有绑定任何课时，横幅展现提示“请先选择今日课时以开始练习”，录音按钮临时禁用。
  * 在首次录音或发送文字触发 `POST /sessions` 时，请求参数里会明确附带当前的 `lesson_id` 进行关联落库。

---

## 值得复盘的历史经验 (Lessons Learned)

1. **关系型表映射的心智开销**：最初把整个实体书本结构完整复刻成了 7 张高度嵌套的表，使得编写 Alembic 迁移脚本以及构建多层折叠组件时的级联处理及其繁复。这也是后期将其大幅合并收拢到 converged 统一内容模型（`ItemGroup` 统一自关联模型）的核心原动力。
2. **鉴权依赖抽离**：针对 `/learners/{learner_id}/...` 下的防越权检验，抽离为一个统一的 FastAPI Dependecy 拦截器，极大地避免了在每一个 PATCH 或 POST 下重复编写 ownership check 逻辑的技术债。
