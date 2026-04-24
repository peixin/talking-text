# CLAUDE.md — 项目协作指南

> 本文件是写给 **Claude Code** 的项目上下文。每次新会话开启时会被自动读入。
> 产品理念见 [`docs/product.md`](docs/product.md)。
> 技术架构见 [`docs/architecture.md`](docs/architecture.md)。

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
| 后端 | Python 3.12 + FastAPI + SQLAlchemy (async) + asyncpg |
| 前端 | Next.js App Router（**全 Next 范式，不当 SPA 写**） |
| 语音 + LLM | 火山方舟全家桶（STT + 豆包 + TTS） |
| 主 DB | PostgreSQL 16 |
| 缓存 | Redis |
| 对象存储 | 火山 TOS |
| 包管理 | backend: Poetry · frontend: pnpm |
| 任务入口 | 根目录 `justfile` |
| 容器化 | **V1 延后**，发布阶段一次性做 |

---

## 仓库布局

```
talking-text/
├── backend/               # Python FastAPI
│   ├── app/
│   │   ├── api/           # HTTP 层
│   │   ├── core/          # 业务核心（零外部 SDK 依赖）
│   │   │   ├── scope/     # Scope Computer（范围计算器）
│   │   │   ├── prompt/    # Prompt 组装 + 越界校验
│   │   │   ├── dialog/    # 一轮对话编排
│   │   │   └── mastery/   # V2：掌握度追踪（V1 空实现）
│   │   ├── adapters/      # 外部服务适配器（STT/LLM/TTS）
│   │   ├── curriculum/    # 教材录入管道
│   │   └── storage/       # DB + 对象存储
│   └── pyproject.toml
├── frontend/              # Next.js（app/ 目录）
├── docs/
│   ├── product.md         # 产品理念（双语）
│   └── architecture.md    # 技术架构（中文）
├── justfile
├── README.md
└── CLAUDE.md              # 本文件
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

详细接口见 `docs/architecture.md` 第五节。

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
- Client Component 仅在需要交互时（主要是对话页的音频控制）
- Server Actions 处理表单（登录、教材上传）
- Middleware 做鉴权
- **不使用 Next API Routes**（后端是独立 Python）

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

完整时序图（含 V2 流式）见 `docs/architecture.md` 第六节。

---

## 命令速查

```bash
# 环境
just install          # 安装前后端依赖

# 日常开发
just dev              # 同时起前后端
just api              # 只起后端
just web              # 只起前端

# 透传命令
just be run <cmd>     # 在 backend 下跑 poetry 命令（如 just be run pytest）
just fe <cmd>         # 在 frontend 下跑 pnpm 命令（如 just fe add zod）

# 质量
just test
just lint
just fmt
```

---

## 代码约定

### Python
- **3.12+**，类型注解必须（包括所有函数签名和 public 属性）
- **异步优先**：FastAPI routes 全部 `async def`，DB 走 asyncpg + SQLAlchemy async
- **Pydantic v2** 做数据校验
- **Ruff** 做 lint + format
- 模块内部按"接口在上、实现在下、私有最后"的顺序组织

### TypeScript / React
- **严格模式**（`strict: true`）
- **组件** PascalCase 文件名，Server Component 不加后缀，Client Component 文件名加 `Client` 后缀（如 `ChatClient.tsx`）
- **页面** 走 Next 约定（`page.tsx` / `layout.tsx` / `actions.ts`）
- **不在 Server Component 里调 useEffect / useState**（显然会报错，但值得作为纪律写下来）

### 文档语言
- **外部文档**（README、`docs/product.md`）：双语，中英对齐
- **内部技术文档**（`docs/architecture.md`、`CLAUDE.md`）：中文
- **运行时 Prompt**（`backend/app/core/prompt/templates/`）：**中文指令 + 英文 few-shot 示例**
  - 中文指令：豆包 / DeepSeek 对中文理解更贴切
  - 英文示例：对话输出本身是英文，示例要同语言

### 提交信息
- 中英文皆可
- 主题行：动词开头、对象清楚
- 不要 emoji，不要 "🤖 Generated" 之类 co-author trailer（除非被明确要求）

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

1. **先读 `docs/architecture.md`**（或对应章节），确认任务所在层（api / core / adapters / storage / frontend）
2. **接口先行**：如果要新增业务，先写 Protocol / Pydantic schema，再写实现
3. **写在对的地方**：
   - 纯业务逻辑 → `core/`
   - 外部 SDK 调用 → `adapters/`
   - HTTP 路由 → `api/`
   - DB 操作 → `storage/`
4. **事件日志**：任何涉及 vocab 的动作都要考虑是否要写 `vocab_event`
5. **别提前优化**：先正确，再性能。

---

## 下一步 TODO（按优先级，待用户确认后执行）

- [ ] 初始化后端骨架（api + core + adapters + storage + `/health`）
- [ ] 初始化前端骨架（Next.js App Router + 登录前 SSR + 登录后路由组）
- [ ] 账号系统（Account + Learner + 密码登录 + Server Action）
- [ ] 火山方舟 LLM adapter（先把 `invoke()` 整段跑通）
- [ ] 教材录入 MVP（粘贴文本 → LLM 提取 → 人工审阅 → 入库）
- [ ] Scope Computer V1 空壳 + Prompt 拼装 + 越界校验
- [ ] 对话 API（POST /conversation/turn）
- [ ] 前端 chat 页 MVP（按住录音 → HTTP → 播放音频）
- [ ] 火山 STT / TTS adapter
- [ ] 内置首批教材（Tot Talk 等，由用户提供素材）
