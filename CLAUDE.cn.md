# CLAUDE.md — 项目协作指南

> 本文件是写给 **Claude Code** 的项目上下文。每次新会话开启时会被自动读入。
> 产品理念见 [`docs/product.cn.md`](docs/product.cn.md)。
> 技术架构见 [`docs/architecture.cn.md`](docs/architecture.cn.md)。

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
| 语音 + LLM | 火山方舟全家桶（STT + 豆包 + TTS） |
| 主 DB | PostgreSQL 16 |
| 缓存 | Redis |
| 对象存储 | 火山 TOS |
| 包管理 | backend: Poetry · frontend: pnpm |
| DB 迁移 | Alembic（async 模板） |
| Lint/Format (Py) | Ruff |
| Type check (Py) | mypy |
| Lint (TS) | ESLint 9 + eslint-config-next 16 (Flat Config) |
| Format (TS/CSS) | Prettier + prettier-plugin-tailwindcss |
| Git hooks | lefthook |
| Commit 格式 | commitlint + Conventional Commits |
| 任务入口 | 根目录 `justfile` |
| 容器化 | **V1 延后**，发布阶段一次性做 |

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
│   │   ├── layout.tsx         # 根布局 (Server Component)
│   │   ├── page.tsx           # 落地页 (Server Component, force-dynamic)
│   │   ├── login/             # 登录（Server Component + Server Action）
│   │   └── (app)/             # 登录后路由组
│   ├── components/ui/         # shadcn 组件（自动生成，勿手动编辑逻辑）
│   ├── lib/
│   │   ├── backend.ts         # server-only Python backend 客户端
│   │   └── utils.ts           # shadcn cn() helper
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

- **接口在 V1 就定死**，不允许破坏性变更
- V1 实现：返回学习者已学全部词，stretch 为空
- V2 扩展：加入下一单元词作为 stretch
- V3 扩展：接入 mastery tracker 动态调整

详细接口见 `docs/architecture.cn.md` 第五节。

### 3. 事件日志 V1 写，V2 读

每一轮对话都写 `vocab_event`（哪个词被 AI 说了 / 被孩子用了 / 被孩子询问了）。

**V1 不读这些数据，但必须每轮写。** 原因：V2 做 mastery 时，这是唯一训练数据来源。

### 4. 语音管道 V1 串行，架构为流式设计

- V1 实现：HTTP 整段
- V2 升级：WebSocket 流式
- **Adapter 接口从 V1 起就同时暴露 `invoke()` 和 `stream()` 两个方法**

### 5. 账号模型：Account vs Learner

- **Account** = 登录 + 计费实体（家庭一个）
- **Learner** = 学习档案（每个学习者一个，含想学的家长）
- 业务逻辑只在 Learner 维度计算，不区分"孩子 / 家长"

### 6. 前端全面 Next.js，不当 SPA 写

- **默认 Server Component**
- Client Component 仅在需要交互时（主要是对话页的音频控制），**文件名加 `Client` 后缀**（如 `ChatClient.tsx`）
- Server Actions 处理表单（登录、教材上传）
- **用 `proxy.ts` 做鉴权（Next.js 16 起 `middleware.ts` 已重命名为 `proxy.ts`）**
- **不使用 Next API Routes**（后端是独立 Python）
- 对后端的调用走 `lib/backend.ts`（`server-only`），Client Component 不要直接 fetch 后端

### 7. 教材数据走统一规范

所有外部输入（文本 / PDF / 图片 / MP3）最终都转成内部 `Curriculum → Unit → (articles, vocab, grammar_points, objectives, key_points)` 数据结构。转换由 AI（LLM 结构化提取）完成，家长审阅为准。

### 8. V1 不做 Docker，但代码必须"Docker-ready"

延后 Docker 不等于可以写反 Docker 的代码。以下必须遵守：

- 所有配置走环境变量或 config 文件（DB URL、API key、端口等）
- 日志走 stdout/stderr，不落固定路径的本地文件
- 不依赖 `__file__` 的相对路径加载运行时资源
- 音频等临时文件用 `tempfile` 或直接上传 TOS
- 启动时不预设文件系统约定（如"必须存在 data/ 文件夹"）

**目标：发布前一次性补 Dockerfile + docker-compose，不反悔。**

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
  POST /conversation/turn (audio blob) →
  火山 STT (整段) → 文字 →
  Scope Computer → 本轮词表 →
  Prompt Assembler → 完整 prompt →
  豆包 LLM (整段) → 回复文字 →
  越界校验（超出词表则重试一次）→
  写 Turn + VocabEvent 到 DB →
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
just api              # 只起后端（http://localhost:8000）
just web              # 只起前端（http://localhost:3000）

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

### TypeScript / React
- **严格模式**（`strict: true`）
- **组件** PascalCase 文件名；Server Component 不加后缀，Client Component 文件名加 `Client` 后缀（如 `ChatClient.tsx`）
- **页面** 走 Next 约定（`page.tsx` / `layout.tsx` / `actions.ts` / `proxy.ts`）
- **不在 Server Component 里调 useEffect / useState**
- **样式** 用 Tailwind v4 utility classes；需要复杂组件时用 shadcn（`pnpm dlx shadcn@latest add <component>`）
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

## 已知约束

- **不能依赖被墙服务**：Vercel、OpenAI、Claude API、Supabase 等一律不可用
- **儿童隐私（V1 不做合规，但自律）**：
  - 不存身份证号 / 家庭住址等敏感字段
  - 音频只传火山 TOS（国内），不出境
  - V2 准备对外推广前补 COPPA / 个保法合规
- **延后的事项（不要现在做）：**
  - Docker 化
  - PDF / 图片 / MP3 教材导入（V1 只支持粘贴文本）
  - 流式语音链路
  - 短信 / 微信登录
  - Scope Computer 的 V2/V3 逻辑（V1 只是空壳）

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
5. **事件日志**：任何涉及 vocab 的动作都要考虑是否要写 `vocab_event`
6. **提交前**：`just check` 一次过
7. **别提前优化**：先正确，再性能

---

## 当前进度

**已完成（脚手架 + DX）：**
- ✅ 后端骨架（`app/{api,core,adapters,curriculum,storage}` 目录树 + `/health`）
- ✅ 前端骨架（Next.js 16 App Router + 落地页 + login/(app)/chat/parent 占位）
- ✅ Tailwind v4 + shadcn/ui 初始化（朱红 primary）
- ✅ Alembic 异步模板，DB 连通
- ✅ ESLint 9 + Prettier + prettier-plugin-tailwindcss
- ✅ Ruff + mypy（backend）
- ✅ lefthook + commitlint（Conventional Commits）
- ✅ justfile 完整 recipe
- ✅ PostgreSQL 16 + Redis 本地就绪，dev DB `talking_text` 已建

**下一步 TODO（按优先级）：**
- [ ] 账号系统（`storage/models/account.py`、`learner.py` + Alembic migration + `api/auth.py` + 前端 login Server Action）
- [ ] `proxy.ts` 鉴权（Next.js 16 命名）
- [ ] 火山方舟 LLM adapter（先把 `invoke()` 整段跑通）
- [ ] 教材录入 MVP（粘贴文本 → LLM 提取 → 人工审阅 → 入库）
- [ ] Scope Computer V1 空壳 + Prompt 拼装 + 越界校验
- [ ] 对话 API（POST /conversation/turn）
- [ ] 前端 chat 页 MVP（按住录音 → HTTP → 播放音频）
- [ ] 火山 STT / TTS adapter
- [ ] 内置首批教材（Tot Talk 等，由用户提供素材）
