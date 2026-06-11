# CLAUDE.md — 项目协作指南

> 本文件是写给 **Claude Code** 的项目上下文。每次新会话开启时会被自动读入。
> 产品理念见 [`docs/product.cn.md`](docs/product.cn.md)。
> 技术架构见 [`docs/architecture.cn.md`](docs/architecture.cn.md)。
> 路线图见 [`docs/roadmap.cn.md`](docs/roadmap.cn.md)。

---

## 项目速览

**Talking Text（字有天地）** — 面向儿童的英语口语陪练 Web app。

**核心机制：** 把孩子的课本（词汇、句型、课文、语法、大纲）输入给 LLM，让 LLM 在"已学范围 + ~10% 进阶词"内陪孩子聊天。语音链路为 STT → LLM → TTS，V1 串行整段、V2 升级流式。

**哲学内核：** 维特根斯坦的"语言边界即世界边界" × 余光中替李白的"绣口一吐就半个盛唐"——不让孩子撞边界，让他站在已知的中心开口，边界一寸一寸往外推。

**目标用户：** 小学英语学习者（以及愿意一起学的家长）。

**部署地：** 中国大陆，不依赖任何被墙的服务。

**计费模型：** Token 消耗。家长账号下可挂 N 个 Learner，互不相扰。

---

## 技术栈（速查）

| 层 | 选择 |
|---|---|
| 后端 | Python 3.12 + FastAPI + SQLAlchemy 2.0 (async) + asyncpg |
| 前端 | Next.js 16 App Router（**全 Next 范式，不当 SPA 写**）+ React 19.2 |
| UI | Tailwind CSS v4 + shadcn/ui（Radix primitives）+ lucide-react |
| LLM | 多家 OpenAI 兼容（DeepSeek / 豆包 / 阿里 Qwen / 小米 MiMo），共用一个 `OpenAICompatibleLLMAdapter`；按交互环节配模型 |
| 语音（STT + TTS） | 火山方舟（STT + Tina TTS） |
| 主 DB | PostgreSQL 16 |
| 缓存 | Redis |
| 对象存储 | `BlobStorage` 适配器——V1 本地盘，可插云（TOS/OSS/COS/七牛/MinIO） |
| 包管理 | backend: Poetry · frontend: pnpm |
| DB 迁移 | Alembic（async 模板） |
| Lint/Format (Py) | Ruff |
| Type check (Py) | mypy |
| Lint (TS) | ESLint 9 + eslint-config-next 16 (Flat Config) |
| Format (TS/CSS) | Prettier + prettier-plugin-tailwindcss |
| Git hooks | lefthook |
| Commit 格式 | commitlint + Conventional Commits |
| 任务入口 | 根目录 `justfile` |
| 容器化 | 根目录 `docker-compose.yml` 做本地全栈集成测试；生产部署发布阶段再做 |

---

## 仓库布局

```
talking-text/
├── backend/                   # Python FastAPI
│   ├── app/
│   │   ├── api/               # HTTP 层
│   │   ├── core/              # 业务核心（零外部 SDK 依赖）
│   │   │   ├── scope/         # Scope Computer（范围计算器）
│   │   │   ├── prompt/        # Prompt 组装 + 越界校验
│   │   │   ├── dialog/        # 一轮对话编排
│   │   │   └── mastery/       # V2：掌握度追踪（V1 空实现）
│   │   ├── adapters/          # 外部服务适配器（STT/LLM/TTS）
│   │   ├── curriculum/        # 教材录入管道
│   │   └── storage/           # DB（Base metadata + SQLA models）
│   ├── alembic/               # DB 迁移
│   ├── alembic.ini
│   ├── pyproject.toml
│   └── .env.example
├── frontend/                  # Next.js 16（app/ 目录）
│   ├── app/
│   │   ├── [locale]/          # 多语言路由 (zh-CN, zh-TW, en)
│   │   │   ├── layout.tsx     # 本地化根布局
│   │   │   ├── page.tsx       # 落地页
│   │   │   ├── login/         # 登录
│   │   │   └── (app)/         # 登录后路由组 (chat, parent)
│   │   ├── favicon.ico
│   │   └── globals.css
│   ├── i18n/                  # next-intl 配置
│   │   ├── messages/          # 语言包 JSON (zh-CN.json 等)
│   │   ├── request.ts         # next-intl 服务端配置
│   │   └── routing.ts         # 共享路由配置 (Link, redirect)
│   ├── components/            # 共享组件 (LocaleSwitcher 等)
│   │   └── ui/                # shadcn 组件（自动生成）
│   ├── lib/
│   │   ├── backend.ts         # server-only Python backend 客户端
│   │   └── utils.ts           # shadcn cn() helper
│   ├── proxy.ts               # 鉴权与国际化中间件 (Next.js 16)
│   ├── eslint.config.mjs
│   ├── .prettierrc.json
│   ├── commitlint.config.mjs
│   └── package.json
├── docs/
│   ├── product.md / product.cn.md
│   ├── architecture.md / architecture.cn.md
│   ├── tech-stack.md / tech-stack.cn.md
│   └── session-log.md / session-log.cn.md
├── lefthook.yml               # Git hooks
├── justfile                   # 任务入口
├── README.md / README.cn.md
└── CLAUDE.md / CLAUDE.cn.md   # 本文件
```

---

## 八条架构纪律（违反前先问）

### 1. Adapter Pattern 是铁律

STT / LLM / TTS 一定会换。**所有外部 SDK 调用必须写在 `backend/app/adapters/` 下**，业务层（`core/`）只依赖 Protocol。新增第三方服务不要写在 `core/`。

### 2. Scope Computer 是核心灵魂

每一轮对话之前，必须先问 Scope Computer："这一轮允许用哪些词？"

- **接口在 V1 就定死**，不允许破坏性变更（允许增量字段）
- V1 实现：返回学习者已学全部词，stretch 为空
- V2（已上线）：加入下一单元词汇的 ~10% 作为 stretch，按掌握度加权（`core/scope/v2.py`，`docs/phase2-mastery-stretch.cn.md`）
- V3 扩展：接入 mastery tracker 动态调整

详细接口见 `docs/architecture.cn.md` 第五节。

### 3. 词汇掌握度：从 Turn 文本派生，不建独立事件表

`vocab_event` 已删除（2026-04-30）。词频数据随时可由 `turn.text_user` / `turn.text_ai` 经分词派生——它不是独立的真相来源。

**已裁定 2026-06-10**（`docs/phase2-mastery-stretch.cn.md` 决策 A）：**不建** `learner_word_stats` 表。item 级 `learner_item_stats` 覆盖掌握度；周报在读取时从 turn 文本计算词差集。不要重新引入"每词每轮一行"的事件表，也不要在真实读路径瓶颈出现前物化词级统计。

### 4. 语音管道 V1 串行，架构为流式设计

- V1 实现：HTTP 整段
- V2 升级：WebSocket 流式
- **Adapter 接口从 V1 起就同时暴露 `invoke()` 和 `stream()` 两个方法**

### 5. 账号模型：Account vs Learner

- **Account** = 登录 + 计费实体（家庭一个）
- **Learner** = 学习档案（每个学习者一个，含想学的家长）
- 业务逻辑只在 Learner 维度计算，不区分"孩子 / 家长"

### 6. 前端全面 Next.js + 国际化

- **默认 Server Component**
- Client Component 仅在需要交互时，**文件名加 `Client` 后缀**
- Server Actions 处理表单；**返回 Error Code**（如 `AUTH_INVALID_CREDENTIALS`）而非原始错误字符串
- **国际化 (i18n)：**
  - 使用 `next-intl` 配合 `[locale]` 动态段
  - 所有文案必须存放在 `i18n/messages/*.json`
  - 使用 `@/i18n/routing` 导出的 `Link`, `redirect`, `useRouter`, `usePathname`（本地化版本）
  - 后端错误代码通过这些词典在 UI 层翻译
- **鉴权与 i18n 中间件：使用 `proxy.ts` (Next.js 16 命名)**
- **不使用 Next API Routes**（后端是独立 Python）
- **所有后端调用必须走 `lib/backend.ts`（`server-only`）**
- **Auth 和 session cookie 逻辑只能在 Server Action 里处理**
- 这个模式让浏览器看不到 Python 后端地址和接口结构。

### 7. 教材数据走统一规范

所有外部输入（文本 / PDF / 图片 / MP3）最终都转成内部 `Curriculum → Unit → (articles, vocab, grammar_points, objectives, key_points)` 数据结构。转换由 AI（LLM 结构化提取）完成，家长审阅为准。

### 8. 代码必须"Docker-ready"（compose 仅用于本地集成测试）

日常开发走原生 `just dev`；根目录 `docker-compose.yml` 是全栈集成测试，不是开发环境也不是生产部署。以下必须遵守：

- 所有配置走环境变量或 config 文件（DB URL、API key、端口等）
- 日志走 stdout/stderr，不落固定路径的本地文件
- 不依赖 `__file__` 的相对路径加载运行时资源
- 音频统一走 `BlobStorage` 适配器（存 storage key，绝不存绝对路径）——V1 本地盘，后续上云
- 启动时不预设文件系统约定（如"必须存在 data/ 文件夹"）

**目标：发布时生产容器化零代码改动落地。**

---

## Next.js 16 需要记住的破坏性变化

1. **`middleware.ts` → `proxy.ts`** — 函数名也从 `middleware` 改为 `proxy`；edge runtime 不再支持
2. **异步 Request API** — `cookies()` / `headers()` / `params` / `searchParams` 全部是 Promise，必须 `await`
3. **Turbopack 默认** — 无需 `--turbopack` 标志
4. **`next lint` 被移除** — 走 ESLint CLI（我们已经配好 `pnpm lint`）
5. **`next/legacy/image` 废弃** — 只用 `next/image`
6. **`serverRuntimeConfig` / `publicRuntimeConfig` 被移除** — 用环境变量 + `NEXT_PUBLIC_` 前缀

遇到跟记忆中 Next.js 不一样的地方时，先读 `frontend/node_modules/next/dist/docs/01-app/` 下对应章节再动手。

---

## 对话一轮的端到端流程（V1）

```
孩子按录音 →
  前端 MediaRecorder 采集（整段）→
  POST /sessions/{session_id}/turns (audio blob) →
  火山 STT (整段) → 文字 →
  Scope Computer → 本轮词表 →
  Prompt Assembler → 完整 prompt →
  豆包 LLM (整段) → 回复文字 →
  越界校验（超出词表则重试一次）→
  写 Turn 到 DB（词频数据从 turn 文本派生 — 见规则 #3，不建事件表）→
  火山 TTS (整段) → 音频 URL →
  返回 {text, audio_url} →
  前端显示文字 + 播放音频
```

完整时序图（含 V2 流式）见 `docs/architecture.cn.md` 第六节。

---

## 命令速查

```bash
# 环境
just install          # 安装前后端依赖 + lefthook install

# 日常开发
just dev              # 同时起前后端
just api              # 只起后端（http://localhost:8010）
just web              # 只起前端（http://localhost:3010）

# 透传
just be run <cmd>     # backend 下跑 poetry 命令
just fe <cmd>         # frontend 下跑 pnpm 命令

# 质量
just lint             # ruff check + pnpm lint
just fmt              # ruff format + pnpm format
just typecheck        # mypy + tsc --noEmit
just check            # 上面三项的只读版本（提交前自检）
just test

# 数据库迁移（Alembic）
just migrate "描述"    # alembic revision --autogenerate -m "..."
just db-up            # upgrade head
just db-down          # downgrade -1
just db-current       # 查看当前 revision
just db-history
```

---

## 代码约定

### 语言规则

- **纯英文项目：** 代码、注释、命名、配置、文档、运行时 Prompt 一切书写均用英文，无例外
- **文档文件约定：** 每份文档两个版本——默认文件（`xxx.md`）为英文；中文翻译为 `xxx.cn.md`

### Python
- **3.12+**，类型注解必须（包括所有函数签名和 public 属性）
- **异步优先**：FastAPI routes 全部 `async def`，DB 走 asyncpg + SQLAlchemy async
- **Pydantic v2** 做数据校验
- **Ruff** 做 lint + format（配置在 `backend/pyproject.toml` 的 `[tool.ruff]`）
- **mypy** 做类型检查
- 模块内部按"接口在上、实现在下、私有最后"的顺序组织
- SQLAlchemy 2.0 风格：`Mapped[T]` + `mapped_column()` + `select().where()`，不要用老的 `Column()` / `session.query()`
- **所有 Model 必须继承 `TimestampMixin`**（见"数据库设计基本原则"），禁止在 Model 里手写 `created_at` / `updated_at`

### TypeScript / React
- **严格模式**（`strict: true`）
- **国际化：**
  - 标准：`next-intl`
  - 存储：`i18n/messages/{en,zh-CN,zh-TW}.json`
  - 逻辑：统一收纳在根目录 `i18n/`
  - 始终使用 `routing.ts` 导出的助手函数进行跳转
- **组件** PascalCase 文件名；Server Component 不加后缀，Client Component 文件名加 `Client` 后缀（如 `ChatClient.tsx`）
- **页面** 走 Next 约定（`[locale]/page.tsx`、`actions.ts`、`proxy.ts`）
- **不在 Server Component 里调 useEffect / useState**
- **样式** 用 Tailwind v4 utility classes；需要复杂组件时用 shadcn
- `components/ui/` 是 shadcn 管理，手动修改只改样式不改结构逻辑

### Commit 信息（Conventional Commits，commitlint 会强制）

格式：`<type>(<scope>): <subject>`

| type | 何时用 |
|---|---|
| `feat` | 新功能 |
| `fix` | bug 修复 |
| `refactor` | 重构（无行为变更） |
| `chore` | 杂项（依赖、构建、工具） |
| `docs` | 文档 |
| `test` | 测试 |
| `style` | 纯格式 |
| `perf` | 性能优化 |

- 主题行 ≤100 字
- 中英文皆可
- 不要 emoji、不要 "🤖 Generated" 之类 co-author trailer（除非被明确要求）

---

## 配置分层原则

两层配置，绝对不混用：

| 层 | 文件 | 存什么 | 进 git？ |
|---|---|---|---|
| **环境配置** | `.env`（pydantic-settings 读取） | 密钥、基础设施地址、端口 | ❌ 不进（gitignore） |
| **业务配置** | `backend/config.toml`（`app/app_config.py` 读取） | 可调业务参数 | ✅ 进 |

**环境配置举例：** `DATABASE_URL`、`SESSION_SECRET`、`VOLC_API_KEY`、`DEBUG`

**业务配置举例：** `session_max_age_days`、`max_login_attempts`、`llm_temperature`、`max_tokens`

规则：
- 新增业务逻辑参数 → 加到 `config.toml` + `AppConfig` dataclass
- 新增密钥或基础设施地址 → 加到 `.env` + `Settings` 字段 + `.env.example`
- `config.toml` 里绝对不放密钥；`.env` 里绝对不放业务参数

---

## 数据库设计基本原则

1. **每张表必须有 `created_at` 和 `updated_at`**
   - 统一由 `TimestampMixin`（`app/storage/base.py`）注入，所有 `Model` 都要继承它
   - `created_at`：行创建时由 DB 自动填入（`server_default=now()`），应用层不写
   - `updated_at`：行更新时由 DB 自动刷新（`onupdate=now()`），应用层不写
   - Alembic migration 里两列都要显式声明（`server_default=sa.text("now()")`）

2. **主键统一用 UUID**（`uuid.uuid4`，应用层生成），不用自增 int

3. **外键必须声明级联行为**（`ondelete="CASCADE"` 或 `ondelete="RESTRICT"`），不留默认

4. **字段长度有业务含义时必须标注**（如 `String(254)` 对应 email 最大长度，`String(72)` 对应 bcrypt hash 长度）

5. **索引按查询需要加，不滥加**；唯一约束用 `unique=True`，普通查询过滤用 `index=True`

---

## 协作规则

1. **不做 git 操作** — 所有 `git add / commit / push` 等操作由用户自己执行，AI 不主动触发
2. **验证由用户启动** — 完成一段需求后，由用户自行启动服务验证，并把结果反馈给 AI；除非用户明确说"你自己跑来验证"，否则 AI 不主动执行服务
3. **DB Schema 变更需先与用户确认** — 任何新增表、新增/修改字段、索引变更，AI 必须先列出方案与用户讨论，用户确认后再动手写代码和迁移文件

---

## 已知约束


- **不能依赖被墙服务**：Vercel、OpenAI、Claude API、Supabase 等一律不可用
- **儿童隐私（V1 不做合规，但自律）**：
  - 不存身份证号 / 家庭住址等敏感字段
  - 音频只存国内对象存储（无论 `BlobStorage` 用哪个后端），不出境
  - V2 准备对外推广前补 COPPA / 个保法合规
- **延后的事项（不要现在做）：**
  - 生产容器化部署（本地 docker-compose 集成测试已存在）
  - PDF / 图片 / MP3 教材导入（V1 只支持粘贴文本）
  - 流式语音链路
  - 短信 / 微信登录
  - Scope Computer 的 V3 逻辑（V2 stretch 已于 2026-06-10 上线；V3 = 掌握度驱动的动态裁剪）

---

## 开始新任务时的建议姿势

1. **先读 `docs/architecture.cn.md`**（或对应章节），确认任务所在层（api / core / adapters / storage / frontend）
2. **接口先行**：要新增业务，先写 Protocol / Pydantic schema / Mapped model，再写实现
3. **写在对的地方**：
   - 纯业务逻辑 → `core/`
   - 外部 SDK 调用 → `adapters/`
   - HTTP 路由 → `api/`
   - DB 模型 + 操作 → `storage/`
4. **改 DB schema 之后**：`just migrate "描述"` 生成迁移，审阅 `alembic/versions/` 下的新文件，再 `just db-up`
5. **提交前**：`just check` 一次过
6. **别提前优化**：先正确，再性能

---

## 当前进度

**已完成（脚手架 + DX + 核心鉴权）：**
- ✅ 后端骨架（`app/{api,core,adapters,curriculum,storage}` 目录树 + `/health`）
- ✅ 前端骨架（Next.js 16 App Router + 多语言路由）
- ✅ 国际化实现 (next-intl, 三语支持, LocaleSwitcher)
- ✅ 账号系统 (Postgres 模型 + FastAPI 接口 + Session Cookie)
- ✅ `proxy.ts` 鉴权与 i18n 中间件 (Next.js 16 命名)
- ✅ Tailwind v4 + shadcn/ui 初始化
- ✅ Alembic 异步模板，DB 连通
- ✅ ESLint 9 + Prettier + prettier-plugin-tailwindcss
- ✅ Ruff + mypy（backend）
- ✅ lefthook + commitlint（Conventional Commits）
- ✅ justfile 完整 recipe
- ✅ PostgreSQL 16 + Redis 本地就绪

**已完成（语音管道 — 2026-04-30）：**
- ✅ 火山 STT / LLM(方舟·豆包) / TTS 三个 adapter；`audio_codec.py` webm→ogg 重封装
- ✅ `POST /sessions/{session_id}/turns`（multipart 音频，base64 音频响应）
- ✅ Chat UI 录音/上传/播放；`Turn` 模型 + 迁移（计费字段逐轮持久化）
- ✅ 失效 session 优雅重定向登录

**已完成（会话与音频改进）：**
- ✅ `Turn.sequence` 显式排序；后端托管对话历史
- ✅ 音频按 session 存储；带鉴权的音频读取端点；逐气泡 play/stop

**已完成（Adapter 工厂）：**
- ✅ `config.toml [adapter]` 选择器 + `app/adapters/factory.py` 单例

**已完成（适配器层整理 — 2026-06-05，详见 `docs/2026-06-05-dev-log.md`）：**
- ✅ **`BlobStorage` 抽象**（`app/adapters/storage/`）——`put/get/exists/delete/url`；`LocalBlobStorage`（V1）+ 可插云。DB 存后端无关的 **storage key** 而非路径；`core` 不再碰 `pathlib`/`AUDIO_STORAGE_DIR`。
- ✅ **LLM 角色协议**——胖接口 `LLMAdapter` 拆成 `TextLLM` + `MultimodalLLM`（接口隔离）；`invoke_vision` 废除（图片是 `ImagePart` content part）。一个 `OpenAICompatibleLLMAdapter` 收编火山+DeepSeek，新增阿里+小米。加厂商 = 配置 + 工厂一个 `case`，零新类。
- ✅ **按交互环节配模型**（`[adapter.stage.*]`）——`chat`（便宜、高频）与 `extraction`（多模态）独立配；能力启动时校验（fail fast）。
- ✅ **两段式抽取原型**（`[adapter.ingest] extraction_mode = single|two_stage`）——`two_stage` = perception（VLM 版式感知转写）→ structuring（`deepseek-v4-pro`，唯一文本大脑），供真实课本页 A/B。

**已完成（Scope Computer V1 + Prompt 拼装）：**
- ✅ `core/scope/v1.py` 三模式（group / calibration / free）
- ✅ `core/prompt/assembler.py` 纯函数（Tina 人设 + 词表 + 句型 + nudge），有测试

**已完成（教材录入 + 内容生命周期 — 2026-05-30）：**
- ✅ 录入 MVP（图/文/语音 → LLM 结构化），家长审阅抽屉，事务存盘
- ✅ **采集/成书拆分**（`docs/content-lifecycle.cn.md`）：抽取不再推断层级；采集产出扁平词袋；建树是刻意的 `tag_path` 动作。详见 `docs/2026-05-30-dev-log.md`
- ✅ `_assemble_tag_path` 确定性整理时建树（节点为无类型 `kind="tag"`）；`tests/test_ingest_extraction.py` 锁定抽取契约

**已完成（阶段二：掌握度 + stretch — 2026-06-10，见 `docs/phase2-mastery-stretch.cn.md`）：**
- ✅ Scope Computer V2（`core/scope/v2.py`）：stretch = 下一单元词汇的 ~10%，按掌握度加权（瞥见过未掌握优先），会话种子轮换；预算在 `config.toml [scope]`
- ✅ `item_group.position`（可空，迁移 `8f2d4b7c1a90`）：兄弟排序 `(position NULLS LAST, 自然排序(name))`，实现在 `core/scope/siblings.py`
- ✅ Prompt assembler 踮脚词段落：新词逃生口改为指向 stretch 列表
- ✅ Mastery 扫描扩展到下一单元词条：stretch 曝光/使用落入 `learner_item_stats`（论题度量）
- ✅ 周报：`core/report.py` + `GET /learners/{id}/report/weekly`（读取时词差集，stretch/课本/课外打标）+ 家长工作台区块
- ✅ 决策 A：**不建** `learner_word_stats` 表（见规则 #3）

**已完成（儿童内容安全 + 输入限制 — 2026-06-11，见 `docs/2026-06-11-dev-log.md`）：**
- ✅ 系统提示词常驻 `_SAFETY_INSTRUCTIONS`（所有模式、自定义 persona 均注入）：不碰不当话题，孩子主动提起则一句话轻转移，孩子难过/受伤则安慰 + 建议告诉父母，不收集个人信息 / 不约见面 / 不推外部网站；测试锁定。厂商内置审核是第二层；独立审核 API 推迟到公开运营前。
- ✅ `config.toml [limits]` + `LimitsConfig`：聊天文本 500 字符、录音自动停止 60 s/120 s、录入文本 1 万字符（容纳 OCR 重提取回灌）、5 张图 × 10 MB（原硬编码已配置化）、音频上传 10 MB 兜底。后端在全部四个上传路径权威校验；前端在 `lib/constants.ts` 镜像（调整时同步）。
- ✅ 客户端反馈：字数达 80% 出现计数器、录音最后 10 秒倒计时、图片 `n/5` 徽章 + 满额禁用按钮；警告 toast 文案参数化
- ✅ 抽出共享 `_read_turn_input()`，消除 batch / streaming 两端点重复的音频读取/转码代码

**已完成（教材分享 — 2026-06-11，设计 `docs/learner-content-scope.cn.md`，日志 `docs/2026-06-11-dev-log.md` §4）：**
- ✅ 整本书（根 group）的私下链接/分享码分享（不做公共资源库——版权只在自愿分享的家长之间流转）；接收方自选 **订阅**（活引用、只读、随书主更新同步——默认推荐）或 **克隆**（独立副本）
- ✅ `group_share_link` + `group_adoption` 表（迁移 `c62cb152ead5`）；`app/api/share.py`（建/撤链接、免登录预览、adopt、fork、退订、订阅列表）；`core/sharing.py` 深拷贝——词条全局唯一，订阅转 fork 后掌握度记录无缝保留
- ✅ `GET /groups` 带出订阅树（`subscribed` 标记）；修复访问检查需沿 parent 链上溯到根（订阅书的子单元原本 404）
- ✅ UI：分享按钮 + 粘贴分享码入口 + 订阅徽章 + fork/退订 + 墓碑条目（资料页）；落地页 `parent/materials/share/[code]`
- 共建按决议推迟（订阅模型即其前向兼容的前置形态）

**下一步 TODO（按优先级；战略与阶段闸门见 [`docs/roadmap.cn.md`](docs/roadmap.cn.md)）：**
- [x] **验证核心循环**：用手工书（1–2 节）+ 一个真实孩子 ✅ 2026-06-10 效果不错（见 `docs/content-lifecycle.cn.md` §9、`docs/roadmap.cn.md` §0）
- [x] 整理工作台 V1：收件箱（采集 + 练习派生）→ tag 树，点选归位/移动（`parent/organize`，端点 `/organize/*`）；待办：拖拽、AI 提议成组
- [x] **阶段二：掌握度 + stretch** ✅ 2026-06-10（见上方完成块；follower 自动推进刻意推迟）
- [ ] **阶段一：外部家庭**（`docs/roadmap.cn.md`）——进行中：部署 ✅（2026-06-11 上线）、教材已备好 ✅、已邀请同班同学家长（共同进度）✅、教材分享功能上线 ✅；**剩余：音频保留策略 + 观察第二周留存 / 越界率 / 延迟**
- [ ] `_assemble_tag_path` / scope V1 的 DB 集成测试（需 Postgres 测试夹具）
- [ ] **录入闭环 → 抬进 `core/curriculum/`（DB-aware）**：做「重整理 / 未入库素材整理 / AI 自动归档（用 DB 已有 `ItemGroup` 把素材归到某课本某章节）」时，把抽取编排从 `app/api/ingest.py` 抬进 `core/curriculum/`。复用两段式接缝：perception 转写是可重跑的 capture 原始件（重结构化不必重新 OCR），`structuring` 环节作为 AI 归档建议器的扩展点（读已有分组结构）。
- [ ] **语音存储生命周期（本地 → 远端）**：V1 经 `BlobStorage` 存本地盘（已完成）。下一步：加云 `BlobStorage` 后端并 push 上去。待定：本地副本保留多久、何时返回远端签名 URL 而非本地字节、本地保留/淘汰策略（上传后多久删本地）。

> 截至 2026-05-30：`just check` 全绿 — 后端 `ruff` + `mypy`（0 错，已删死代码 `conversation.py`），前端 `eslint` + `prettier` + `tsc`。
