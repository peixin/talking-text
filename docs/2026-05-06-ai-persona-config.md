# AI 伴学助手个性化定制 (AI Persona Config) 实施计划 · 2026-05-06

> **目标**：允许家长为每一位学习者 (Learner) 自定义配置 AI 伴学助手的名字 (Name)、性别 (Gender) 及人设提示词 (Persona Prompt)；同时将学习者的真实姓名动态注入到每次对话的 System Prompt 中，使得 AI 能够亲切地直接称呼孩子，极大地提高口语学习的陪伴浸润感。

---

## 一、 整体架构设计 (Architecture)

### 1. 数据模型与底层存储
* **`learner` 表扩展**：
  * `ai_name`: VARCHAR(100), 默认值为 `"Tina"`，作为 AI 的对名称。
  * `ai_gender`: VARCHAR(10), 默认值为 `"female"`，控制 AI 的性别呈现 (选项: `female` | `male` | `neutral`)。
  * `ai_persona_prompt`: TEXT (Nullable)，存放该学习者专属的 AI 个性提示词。

### 2. 编排层与提示词动态组装
* **`build_system_prompt` 升级**：
  * 函数签名扩展为：`build_system_prompt(scope: ScopeResult, persona_prompt: str, learner_name: str | None = None)`。
  * 若提供 `learner_name`，会在 Persona Prompt 后方自动追加特定上下文语句，如：`The child's name is Emma. Use their name naturally in conversation...`。
* **`DialogOrchestrator` 每回合动态拉取**：
  * 在 `_resolve_system_prompt` 方法中，不仅读取 Session，还会查询对应的 `Learner` 记录，拉取学习者姓名与自定义 AI 提示词，无状态拼装系统指令。

### 3. 家长端个性化同步路由
* **`PATCH /learners/{id}/persona`**：供直接编辑并快速保存。
* **`POST /learners/{id}/persona/sync`**：智能双向对齐路由。利用大语言模型（LLM）校验家长输入的自定义人设，当家长仅修改了“名字”或“性别”时，智能改写个性提示词内的称谓代词（如把 `She` 改为 `He`），保持数据强一致性。

### 4. 前端自动防抖同步
* **`AIPersonaSettingsClient.tsx`**：在学习者主页提供优雅的折叠抽屉，通过 React 19 的 `useTransition` 捕获过渡态，并使用 `useRef` + `setTimeout` 建立 800ms 防抖自动提交，无需手动点击“保存”。

---

## 二、 后端核心实施细节 (Backend Steps)

### Task 1: 学习者数据表级扩展与 Alembic 迁移
在 `backend/app/storage/models/learner.py` 中为 `Learner` 类添加三列属性，并生成 Alembic 迁移记录执行 `just db-up`：
```python
ai_name: Mapped[str] = mapped_column(String(100), nullable=False, server_default="Tina")
ai_gender: Mapped[str] = mapped_column(String(10), nullable=False, server_default="female")
ai_persona_prompt: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
```

---

### Task 2: 系统提示词组装器改写
* **文件**：`backend/app/core/prompt/assembler.py`
支持形参 `persona_prompt` 及 `learner_name`，完美融合词汇 Scope 范围，保证在不提供自定义值时自动退化为默认的 `_TINA_PERSONA`。
同时，在 `backend/tests/test_prompt_assembler.py` 中编写 5 组针对“自定义 Prompt 替换”、“真实姓名注入”、“名字拼接时序”的单体用例，运行 `poetry run pytest` 确保 100% 绿色通过。

---

### Task 3: 编排器 (Orchestrator) 联动集成
* **文件**：`backend/app/core/dialog/orchestrator.py`
重写 `_resolve_system_prompt`：
```python
async def _resolve_system_prompt(self, db: AsyncSession, learner_id: uuid.UUID, session_id: uuid.UUID) -> str:
    session = (await db.execute(select(Session).where(Session.id == session_id))).scalar_one_or_none()
    lesson_id = session.lesson_id if session else None
    
    learner = (await db.execute(select(Learner).where(Learner.id == learner_id))).scalar_one_or_none()
    learner_name = learner.name if learner else None
    persona_prompt = (learner.ai_persona_prompt if learner else None) or _TINA_PERSONA
    
    scope = await self._scope.get_scope(db, learner_id, lesson_id, None)
    return build_system_prompt(scope, persona_prompt=persona_prompt, learner_name=learner_name)
```

---

### Task 4: 一致性智能同步接口逻辑
* **文件**：`backend/app/api/learner.py`
定义智能同步指令 `_SYNC_PROMPT`，让 LLM 智能融合输入，自动将人设提示词内的指代词、称谓词与名字/性别同步一致。
```python
_SYNC_PROMPT = """\
You help parents customize an AI tutor persona for a children's English learning app.
Given:
- AI name: {name}
- AI gender: {gender}  (options: female / male / neutral)
- Persona prompt: {prompt}

Task: Return a JSON object with exactly three keys: "ai_name", "ai_gender", "ai_persona_prompt".
Rules:
1. The name used inside the prompt must match the given AI name.
2. Gender pronouns (he/she/they) in the prompt must match the given gender.
3. If the prompt does not mention pronouns, append the appropriate pronouns statement.
...
"""
```

---

## 三、 前端核心实施细节 (Frontend Steps)

### Task 1: API薄层与 Server Actions 编写
1. 在 `lib/backend.ts` 内扩展 `LearnerOut` 数据结构，并在 `learners` 对象上编写 `updatePersona` 与 `syncPersona` 原生 Fetch 请求方法。
2. 在 `lib/api.ts` 中暴露客户端 API 通信接口。
3. 在 `frontend/app/[locale]/(app)/learner/[learnerId]/actions.ts` 中编写 `syncPersona` 的 Next.js Server Action 动作，支持重新激活路由页面缓存数据刷新 (`revalidatePath`)。

---

### Task 2: 折叠式自动防抖同步设置卡片
* **文件**：`frontend/components/AIPersonaSettingsClient.tsx`
* **关键策略**：
  1. 采用 `Collapsible` 折叠卡片，确保学习者主页面板干净端庄。
  2. 新增 AI 姓名输入框、性别 `RadioGroup` 单选框及个性提示词 `Textarea` 自定义输入域。
  3. **基于 `useEffect` 闭包与 `useRef` 的防抖重载**：在输入任意内容时均激活 `setTimeout` 计时，防抖延迟设为 800ms。若用户在 800ms 内继续输入，则清空旧计时器，避免过多无用的 LLM API 账单消耗。
  4. 采用 `useTransition` 捕获服务器端计算延迟状态，并在顶部呈现带有旋转特效的 `Loader2`（"Syncing..."），提供极佳的用户即时感官反馈。

---

## 四、 核心技术亮点与经验归纳

1. **代词指代一致性处理**：少儿口语启蒙对伴学助手的称谓和性格感知非常敏感。本方案通过后端 LLM 双向同步（Sync）精巧地解决了“家长在改动 AI 名字/性别时，人设 Prompt 内容出现代词矛盾”的问题，降低了家长的配置门槛。
2. **体验无痛化设计**：前台移除繁杂的“确定保存”按钮，利用“防抖触发 + 过渡态感应”的无感保存机制，使用户操作体验逼近原生 iOS 配置页，保证了整体设计的美感与优雅。
