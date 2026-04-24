# 第一次 Session 记录 · 2026-04-24

> 本文档是项目从"一个想法"到"脚手架跑通"的完整对话缩影。
> 不是流水账——是**为什么这么定**的记忆。未来任何新成员读完这份，应当能理解产品和代码的基因。

---

## 阶段一：品牌与哲学（最开始，纯讨论）

### 1.1 产品定位的诞生

从一个观察开始：**孩子学英语时间不少，真正开口的机会少得可怜。**

通用 AI 闲聊产品（豆包等）能陪聊，但**没有范围**——随便蹦出孩子没学过的词，孩子听不懂，挫败感一上来，"聊天"变成"考试"。

于是核心想法：

> **把孩子的课本喂给 AI，让 AI 只在这个范围里陪聊。**

产品目标不是教新东西，是**让学过的东西真正成为他自己的**。

### 1.2 命名的推敲

**英文名**：纠结过 `Talking Text` vs `TalkText`。选前者——Text 是主体、Talking 是状态，表达"会说话的文字"，不是两个功能拼接。

**中文名**：从 `语滴`（滴=日常积累意象）到最终的 **`字有天地`**——四字装进维特根斯坦"语言的边界就是世界的边界"。字里有天地，你认识多少字，你的天地就有多大。

**Slogan**：从"感知世界"（被否，太被动）一路演化到 **`言出成界`**——
- 言出 = 李白的绣口一吐（行动）
- 成界 = 维特根斯坦的语言即世界（结果）
- 四字装下两个灵魂

### 1.3 哲学双柱

维特根斯坦 + 李白/余光中，构成产品哲学：

- **维特根斯坦讲边界**："我的语言的边界就是我的世界的边界"（《逻辑哲学论》1921）
- **余光中替李白讲中心**："绣口一吐，就半个盛唐"（《寻李白》1980——后世传诵的这句不是李白写的，是余光中写给他的）

产品把这两件事合成一件：**不让孩子撞边界，让他站在已知的中心开口，边界一寸一寸往外推。**

### 1.4 Krashen 的 i+1（后续阶段补充）

单纯在已知里循环是长不大的。语言学家 Krashen 提出 **i+1**：真正高效的语言输入是"当前水平 + 一点点"。

所以渐进式聊天：~90% 已学 + ~10% 下一单元的新词，新词靠上下文自然吸收。

这成了 Scope Computer 的 **stretch_vocab** 设计来源。

### 1.5 开屏词库

不是逐字翻译，中英各自成立：

| 中文 | English |
|---|---|
| 开口，便是一个世界。 | Words become your world. |
| 开口一次，世界就大一寸。 | One word, one world.（含 `word→world` 多出字母 `l` 的视觉彩蛋，就是"大一寸"的那一寸）|
|  | Speak a word, grow your world. |
| 说得出，才算你的。 | If you can say it, it's yours. |
| 用你懂的，说出你的世界。 | Your voice creates your world. |

### 1.6 产出

- `README.md` 项目入口
- `docs/product.md` 产品理念（中英双语，含缘起、品牌、象征、开屏词库）

---

## 阶段二：架构讨论（核心决策）

### 2.1 产品形态：Web PWA

**选定：** Next.js + Python，不做 APP。
**原因：** APP 上架更新流程太麻烦，平台兼容（iOS/Android/鸿蒙）要做三套。

### 2.2 技术栈核心决策

| 问题 | 决策 | 理由 |
|---|---|---|
| 语音 + LLM 供应商？| 火山方舟全家桶 | 一个账号，省心 |
| DB？| PostgreSQL 16 | 云托管一致性 + 工具链成熟 |
| 前端框架？| Next.js 16 | 落地页 SSR 红利 |
| 后端语言？| Python 3.12 + FastAPI | 熟悉 + 生态成熟 |
| ORM？| SQLAlchemy 2.0 | Prisma 在 Python 不是选项 |
| UI 库？| Tailwind v4 + shadcn/ui | 极简 + 你拥有源码 |

### 2.3 关键架构原则（这些是"铁律"，写进 CLAUDE.md）

#### ① Adapter Pattern 是铁律
STT / LLM / TTS 一定会换。所有外部 SDK 调用放 `adapters/`，业务层只依赖 Protocol。
未来无论 HTTP / SSE / WebSocket，都被封在 adapter 内部，对外一个 `async def stream()` 接口。

#### ② Scope Computer 是核心灵魂
每一轮对话之前，都问："这一轮允许用哪些词？"
- V1：返回学习者已学全部词
- V2：加入下一单元词作为 stretch
- V3：接入 mastery tracker 动态调整
**接口 V1 定死，实现逐代长胖。**

#### ③ 事件日志 V1 写、V2 读
`vocab_event` 表从第一天开始写（哪个词被 AI 说了 / 孩子用了 / 孩子询问了）。
V1 不读，**但必须写**——否则 V2 做 mastery 时没数据可用。

#### ④ 语音管道 V1 串行，架构为流式设计
V1 HTTP 整段；V2 WebSocket 流式。
Adapter 接口从 V1 起就同时暴露 `invoke()` 和 `stream()` 两个方法，升级时只动 orchestrator。

#### ⑤ Account vs Learner
- **Account** = 登录 + 计费实体（家庭一个）
- **Learner** = 学习档案（每个学习者一个，家长想学也是一个 Learner）
- 业务逻辑只在 Learner 维度计算，不区分"孩子 / 家长"
- 计费按 token 消耗，多 Learner 无成本

#### ⑥ 前端全面 Next.js，不当 SPA 写
（后期修正的结论——最开始讨论过"壳 SSR / 芯 SPA"的折中，后面被用户否决："选了 Next 就吃尽它的优势"）
- 默认 Server Component
- Client Component 只在需要交互时
- Server Actions 处理表单
- `proxy.ts` 做鉴权（Next 16 起 `middleware.ts` 已改名）
- **不用 Next API Routes**，后端是独立 Python

#### ⑦ 教材数据走统一规范
外部输入（文本 / PDF / 图片 / MP3）统一转为内部 `Curriculum → Unit → (articles, vocab, grammar_points, objectives, key_points)` 结构。AI 做结构化提取，家长审阅为准。

#### ⑧ V1 不做 Docker，但代码必须 Docker-ready
延后 != 可以写反 Docker 的代码。env vars、stdout 日志、不依赖 `__file__`——这些从 V1 起就守。

### 2.4 范围约束策略：Level 0 + Level 1

**不用 RAG**（词表小而结构化，过度设计）。

- **Level 0**：ALLOWED_VOCAB 塞 prompt + prompt caching
- **Level 1**：事后 tokenize 比对，越界重试一次
- 预期可靠性 ~95%+

### 2.5 产出

- `docs/architecture.md` 技术架构（13 节，含数据模型、时序图、Scope Computer 接口、供应商切换路径、部署规划）

---

## 阶段三：脚手架搭建

### 3.1 仓库结构

```
talking-text/
├── backend/           # Python FastAPI（Poetry）
├── frontend/          # Next.js 16 + React 19（pnpm）
├── docs/              # product / architecture / tech-stack / session-log
├── justfile           # 任务入口
├── lefthook.yml       # Git hooks
├── README.md
└── CLAUDE.md          # 给 AI 助手的项目上下文
```

### 3.2 后端骨架

- `app/{api,core,adapters,curriculum,storage}` 目录树
- `GET /health` 跑通
- Pydantic Settings 读 `.env`
- CORS 中间件
- 目录层内部按 scope / prompt / dialog / mastery（core）和 stt / llm / tts（adapters）细分

### 3.3 前端骨架

- **Next.js 16 是新版本**，AGENTS.md 提醒"这不是你训练时的 Next.js"
- 读 `node_modules/next/dist/docs/` 里的升级指南，记下关键破坏性变化（详见 tech-stack.md 或 CLAUDE.md）
- 页面：landing（Server Component，SSR 拉 `/health`）、login、(app) 路由组（chat / parent）
- Tailwind v4 + shadcn/ui 初始化
- `--primary` 改成朱红 `oklch(0.52 0.175 25)`
- 字体选 Geist + 系统中文 fallback（不用 Google Fonts 中文，怕国内访问不稳）

### 3.4 数据库

- 本地 PostgreSQL 16（brew）+ Redis（brew）都跑了
- 建 `talking_text` user + database
- Alembic 初始化 `-t async` 模板，`env.py` 从 settings 读 DB URL

### 3.5 DX 工具链（最后一批决策）

| 工具 | 选择 | 拒绝的替代 |
|---|---|---|
| Python lint/format | Ruff | Black+isort+flake8（碎）、Pylint（慢） |
| Python type | mypy | Pyright（和 SQLA/Pydantic 动态兼容差）|
| TS lint | ESLint 9 + eslint-config-next 16 Flat Config | Biome（丢 Next 插件生态）|
| TS format | Prettier + prettier-plugin-tailwindcss | ESLint 自带格式化（弱）|
| Git hooks | lefthook（brew） | husky（JS only）、pre-commit（Py 味）|
| Commit format | commitlint + Conventional Commits | 不强制（团队扩大时会吃亏）|
| 任务入口 | just（Rust Makefile） | Makefile（tab 坑）、npm scripts（只管 JS）|

**pre-commit 钩子会跑：** ruff check/format + eslint + prettier + tsc
**commit-msg 钩子会跑：** commitlint

### 3.6 过程中踩过的坑

1. **Poetry 2.0 的 `package-mode`**：默认要求项目可打包，我们不打包 → 加 `[tool.poetry] package-mode = false`
2. **ESLint 10 + FlatCompat 循环 JSON bug**：降到 ESLint 9 + 直接 spread eslint-config-next 原生 Flat 导出
3. **shadcn init 覆盖了我手写的 globals.css**：重写所有页面到 Tailwind class；顺便把 `--primary` 改成朱红

---

## 阶段四：最终状态（Session 结束时）

### 4.1 代码能跑：

```
just dev              → 前后端同起
curl /health          → {"status": "ok"}
http://localhost:3000 → 落地页 SSR 出"字有天地""言出成界"随机词，backend: ok
```

### 4.2 工具链能用：

```
just check            → ruff + eslint + prettier + tsc 全绿
just migrate "..."    → 生成 Alembic migration
just db-up            → apply
git commit            → lefthook 拦着：ruff/eslint/prettier/tsc + commitlint 都过才能提交
```

### 4.3 下一步 TODO（下一 Session 开始时做）

按优先级：
1. 账号系统（Account + Learner + 密码登录 + Server Action + proxy.ts 鉴权）
2. 火山方舟 LLM adapter（先跑通 `invoke()` 整段）
3. 教材录入 MVP（粘贴文本 → LLM 提取 → 人工审阅 → 入库）
4. Scope Computer V1 空壳 + Prompt 拼装 + 越界校验
5. 对话 API（POST /conversation/turn）
6. 前端 chat 页 MVP（按住录音 → HTTP → 播放音频）
7. 火山 STT / TTS adapter
8. 内置首批教材（Tot Talk 等，由用户提供素材）

---

## 关键分歧 / 反转点（如果重来会不会不一样）

1. **Next.js 用法的反转**：最开始讨论是"壳 SSR / 芯 SPA"折中，用户开发中途转念："选了 Next 就吃尽它的优势"。于是改成全 Next 范式。**这个决策值得**——Server Actions + Server Components 省去大量 SPA 手动 fetch 逻辑。

2. **Docker 延后**：一开始准备把 docker-compose 写进 V1，用户喊停："开发阶段都是在改，反复改 Docker 不划算，发布前一次性做"。**这个决策对**——节省大量调 Dockerfile 时间。

3. **ESLint 9 vs 10**：装最新版 ESLint 10 出现 FlatCompat 循环 JSON bug。降到 9 立刻稳。记住：**工具链新版本不总是最佳选择**，尤其是主要依赖没跟上的时候。

4. **UI 库选择**：user 最开始偏好简单上 shadcn。确认得很快。事后回看完全正确——shadcn 的"代码你拥有"模型给了最大的自由度。

---

## 值得在任何新 Session 开头重新念一遍的心法

- **孩子站在中心开口，边界一寸一寸往外推。** （产品灵魂）
- **每一条 vocab_event 都是 V2 的燃料，V1 写了但不读。**
- **Adapter Pattern 是铁律。`core/` 不能 `import` 第三方 SDK。**
- **Scope Computer 接口 V1 定死，实现逐代长胖。**
- **先正确，再性能。别提前优化。**
- **Docker-ready 但不 Docker 化。**

---

*本文档在新阶段开始时可追加新 session 的小结；当 docs/ 下有多份时，按日期命名：`session-log-2026-XX-XX.md`。*
