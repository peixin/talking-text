# 技术选型清单 · Tech Stack

> 本文档记录每一项技术选型的**是什么、为什么选、考虑过哪些替代、为什么不用**。
> 面向新成员 / AI 助手 / 未来的自己——理解决策背景，避免无意义推翻。

---

## 一、仓库与项目组织

### Monorepo（单仓库）

**选择：** 单仓库，两个顶层目录 `backend/` + `frontend/`，**不是** pnpm workspace 或 Nx 这类完整 monorepo 方案。

**为什么：**
- 独立开发者，不需要版本隔离
- 两个子项目语言不同（Python / Node），天然分离，无 workspace 必要
- 原子提交（前后端同时改一个 feature）

**不选：**
- **多仓库**：跨仓 PR 协调、版本漂移，独立开发者痛苦远大于收益
- **pnpm workspace / Nx / Turborepo**：两个包还用工作区工具是杀鸡用牛刀

### 根目录任务入口：`justfile`（just）

**选择：** 用 `just`（Rust 写的现代 Makefile），根目录一个 `justfile` 统一所有命令。

**为什么：**
- 比 Makefile 人性化（无 tab 强制缩进、变量语法清晰）
- 支持多行 bash 脚本 + 依赖
- 多语言项目最清爽的方案
- `just dev` / `just migrate` / `just check` 一个入口全搞定

**不选：**
- **npm scripts**：只能管 JS 端
- **Makefile**：tab 的坑、旧时代的味道
- **手写 shell 脚本**：管理混乱
- **Task（Go 写的）**：也不错，但生态和 just 差不多，选择其一即可

---

## 二、后端（Python）

### Python 3.12

**选择：** 3.12+（`requires-python = ">=3.12"`）

**为什么：**
- 类型系统成熟（PEP 695 泛型语法、更好的错误信息）
- asyncio 性能优化到位
- 主流云 runtime（阿里云函数计算、火山引擎）都支持

**不选：**
- **3.11**：差别小，但 3.12 的泛型语法和性能是真香
- **3.13**：新，生态里部分库还没适配（asyncpg / SQLAlchemy 都稳了，但某些间接依赖可能没）

### 包管理：Poetry 2.x

**选择：** Poetry 2.x，`package-mode = false`（不打包为分发包）

**为什么：**
- Python 生态事实标准（至少和 uv、PDM 三分天下的第一梯队）
- `pyproject.toml` 单文件配置，生态兼容 PEP 621
- lock 文件机制成熟

**不选：**
- **uv**（Astral 出品）：性能炸裂，但成熟度和生态整合还在追 Poetry。等 uv 稳一两年再考虑切
- **pip + requirements.txt**：没 lock 机制，复现成本高
- **PDM**：和 Poetry 重合度高，选一即可，Poetry 更主流

### Web 框架：FastAPI

**选择：** FastAPI 0.115

**为什么：**
- Python 异步 Web 框架事实标准
- Pydantic 原生集成，请求 / 响应自带类型和校验
- OpenAPI 自动生成
- Starlette 底层成熟

**不选：**
- **Django / DRF**：重，同步为主，和我们全异步架构不贴
- **Flask**：旧，异步支持不原生
- **Litestar**：类 FastAPI 的新秀，生态较小
- **Sanic / aiohttp**：无 Pydantic 深度集成

### ORM：SQLAlchemy 2.0

**选择：** SQLAlchemy 2.0（Mapped[T] 风格）+ asyncpg 驱动

**为什么：**
- Python 生态事实标准
- 2.0 完全重写了 API，`Mapped[T]` + `select()` + async，和 10 年前的 1.x 已是两个东西
- async 原生支持
- 成熟、可控、直达 SQL 时不打折

**不选：**
- **Prisma**：TypeScript 优先，Python 客户端是社区维护、不官方，生产慎用。唯一能让 Prisma 进来的方式是"前端拥有 DB"，架构灾难
- **SQLModel**（Tiangolo 出品）：Pydantic + SQLAlchemy 合一，糖衣层。复杂查询还是要下到 SQLA，不如直接 SQLA
- **Tortoise ORM**：Prisma 风格的 Python ORM，但生态远不如 SQLA
- **Django ORM**：要 Django 的命；无 Django 不自在
- **Piccolo**：小众

### DB 迁移：Alembic（async 模板）

**选择：** `alembic init -t async alembic`，`env.py` 从 `app.config.settings` 读 DB URL，`target_metadata = Base.metadata`

**为什么：**
- SQLAlchemy 官方配套
- async 模板原生支持 asyncpg
- autogenerate 对 SQLA 2.0 的 Mapped 模型 diff 精准

**不选：** 没有替代。Python 世界 Alembic 无竞争。

### 数据校验：Pydantic v2

**选择：** Pydantic 2.9+（`pydantic-settings` 用于环境变量）

**为什么：**
- v2 用 Rust 重写（pydantic-core），性能 10 倍
- FastAPI 原生依赖
- 和 SQLAlchemy 互补（SQLA 管持久化，Pydantic 管 API 层）

**不选：**
- **msgspec**：更快，但生态窄
- **attrs + cattrs**：能用，但和 FastAPI 整合不如 Pydantic

### 其他后端依赖

| 库 | 用途 | 为什么 |
|---|---|---|
| `asyncpg` | PG 异步驱动 | SQLAlchemy async 最成熟的 PG 驱动 |
| `redis[hiredis]` | Redis 客户端 | 官方 async 客户端；hiredis 加速 C parser |
| `httpx` | HTTP 客户端 | 外调火山 API 用；async + sync 统一 API |
| `bcrypt` | 密码哈希 | 老牌可靠，对抗彩虹表、慢哈希对抗 GPU |
| `itsdangerous` | 签名 cookie | session token 签名 |
| `python-multipart` | 表单 / 文件上传 | FastAPI 处理 `form-data` 需要 |

### Lint / Format：Ruff

**选择：** Ruff 0.7+，`pyproject.toml` 配置

**为什么：**
- Rust 写的，比 flake8 / black / isort 快 10-100 倍
- 一个工具同时做 lint + format + isort（取代三个）
- 规则覆盖 pyflakes / pycodestyle / isort / flake8-bugbear / pyupgrade / flake8-simplify 等

**不选：**
- **Black + isort + flake8**：三件套太碎，Ruff 一个顶三
- **Pylint**：慢，规则太啰嗦

### Type check：mypy

**选择：** mypy 1.13+

**为什么：**
- 事实标准，生态最全
- 和 SQLAlchemy 2.0 / Pydantic 2 / FastAPI 的 stub 整合良好

**不选：**
- **Pyright**（微软）：快，但和 Pydantic / SQLA 的动态模式兼容性不如 mypy
- **pyre**（Meta）：小众，Meta 内部工具色彩重
- **pytype**（Google）：不活跃

---

## 三、前端（TypeScript）

### 框架：Next.js 16（App Router）

**选择：** Next.js 16.2.4 + React 19.2 + TypeScript

**为什么：**
- **SSR/RSC** 给落地页、登录页带来首屏红利和 SEO
- 路由、字体优化、Image、Metadata 全内置
- Server Components + Server Actions 和独立 Python 后端组合顺畅
- 国内自部署可行（Node runtime，不依赖 Vercel）

**重要心智：全 Next 范式，不当 SPA 写**
- 默认 Server Component
- Client Component 只在需要交互的地方（对话页音频交互等），文件名加 `Client` 后缀
- Server Actions 处理登录等表单
- **不使用 Next API Routes**（后端是独立 Python）

**不选：**
- **Vite + React + React Router**：纯 SPA 体验简单，但落地页 SEO / 首屏被动
- **Remix**：和 Next 重合高，Next 生态更厚
- **Nuxt/SvelteKit**：语言栈限制

### React 19.2

**选择：** Next.js 16 自带

**为什么：**
- Server Components 原生支持
- `use()` hook、View Transitions、Activity 等新能力

**注意：** Next 16 默认用 React canary 版的部分稳定特性。

### 包管理：pnpm 10.x

**选择：** pnpm（非 npm / yarn）

**为什么：**
- 磁盘占用最小（硬链接去重）
- 装得快
- 严格依赖树，不让 phantom dependencies 滋生
- `pnpm add -D` 等命令语义一致

**不选：**
- **npm**：慢、phantom deps 多、历史包袱
- **yarn classic**：已过时
- **yarn berry (v4)**：PnP 模式奇葩且工具链支持不足
- **bun**：原生快，但仍在快速变化，成熟度不足以做生产依赖

### Next.js 16 的破坏性变化（必须记住）

- `middleware.ts` → **`proxy.ts`**，函数名也从 `middleware` 改为 `proxy`；edge runtime 不再支持
- `cookies()` / `headers()` / `params` / `searchParams` **全部异步**，必须 await
- Turbopack 默认，无需 `--turbopack` 标志
- `next lint` 被移除（用 ESLint CLI）
- `next/legacy/image` 废弃
- `serverRuntimeConfig` / `publicRuntimeConfig` 被移除

### CSS：Tailwind CSS v4

**选择：** Tailwind v4（`@import "tailwindcss"` 单行导入，无 `tailwind.config.js`）

**为什么：**
- 事实标准，utility-first 快
- v4 无配置文件，`@theme` 直接在 CSS 中定义 token
- 和 shadcn/ui 天然搭配
- 性能炸裂（Lightning CSS 底层）

**不选：**
- **CSS Modules**：组件样式可以，但不适合整个设计系统
- **Emotion / styled-components**：CSS-in-JS 和 RSC 场景糟糕
- **Panda CSS / Vanilla Extract**：学习曲线 vs 收益不划算

### UI 组件：shadcn/ui（基于 Base UI + Radix）

**选择：** shadcn/ui（@shadcn 4.x，`pnpm dlx shadcn@latest add <component>` 按需添加）

**为什么：**
- 不是 npm 包，是**复制源码到仓库**，代码你完全拥有
- 底层 Radix primitives（无样式、可访问）
- Tailwind 样式驱动
- 默认美学极简、克制，正合产品调性
- CSS 变量驱动主题，换色只改 `--primary` 一行

**不选：**
- **Mantine**：自成体系，和 Tailwind 互斥，重
- **Chakra UI**：Emotion 系统，和 Tailwind 冲突
- **MUI**：Material 重，不对味
- **Radix 裸用**：可以，但 shadcn 就是 Radix + 写好的 Tailwind 样式，省工
- **Ant Design**：中后台味道重，和"儿童极简聊天"不贴
- **Headless UI**（Tailwind 官方）：组件比 shadcn 少，生态小

### 辅助库

| 库 | 用途 |
|---|---|
| `lucide-react` | 和 shadcn 同一设计语言的图标库 |
| `class-variance-authority` / `clsx` / `tailwind-merge` | shadcn 附属，class 合并 |
| `server-only` | 标记仅服务端模块，防误导入到 Client Component |
| `tw-animate-css` | Tailwind 动画补充 |

### 字体：Geist + 系统中文 fallback

**选择：** `next/font/google` 引入 Geist / Geist_Mono；中文交给系统字体（PingFang SC / 微软雅黑）

**为什么：**
- Geist 英文干净
- 系统中文字体地道，Mac/Win 原生审美都兼容
- **无 Google Fonts 直连中文字体风险**（国内访问不稳）
- 零额外 KB

**不选：**
- **Noto Sans SC from Google Fonts**：中国访问不稳，且字体文件大（200-400KB）
- **Alibaba 开源字体 CDN**：可行但多一层依赖

### Lint：ESLint 9 + eslint-config-next 16（Flat Config）

**选择：** ESLint 9 + `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`（直接 spread 数组，**不**用 FlatCompat）

**为什么：**
- Next.js 16 起 `eslint-config-next` 原生 Flat Config 导出
- ESLint 10 和 Next 配置的 FlatCompat 有循环 JSON 的 bug，降到 9 稳定
- Flat Config 比 .eslintrc 清爽

**不选：**
- **Biome**：Rust 一体化工具，替代 ESLint + Prettier。但 Next.js ESLint 插件生态更成熟，换 Biome 丢掉 `next/core-web-vitals` 这类规则
- **xo / standard**：意见太强

### Format：Prettier + prettier-plugin-tailwindcss

**选择：** Prettier 3.x，`printWidth: 100`、`trailingComma: "all"`，搭 `prettier-plugin-tailwindcss`

**为什么：**
- 事实标准
- `prettier-plugin-tailwindcss` 自动按 Tailwind 推荐顺序排 class

**为什么不单 ESLint：** ESLint 自己格式化太弱，Prettier 专业做这事。用 `eslint-config-prettier` 禁掉 ESLint 和 Prettier 冲突的规则。

---

## 四、数据与基础设施

### 数据库：PostgreSQL 16

**选择：** PostgreSQL 16（非 15、非 18）

**为什么：**
- **云托管一致性**：国内阿里云 / 腾讯云 / 火山云主推 15-16，生产用啥 dev 用啥
- **工具链成熟度**：asyncpg / SQLAlchemy 2.0 / Alembic / pgvector 都在 16 跑了两年
- JSONB 对事件日志天然友好
- pgvector 未来要做语义相似词时原地加扩展

**不选：**
- **PostgreSQL 18**：太新（2025 年 9 月发布），云服务未必提供，新特性（UUIDv7 / io_uring）对我们无用
- **PostgreSQL 15**：可以，但 16 新了一代稳定版
- **MySQL**：JSONB 不如 PG，没 pgvector
- **SQLite**：生产不可能，dev 也不建议（和 prod 的 schema 差异会咬）
- **MongoDB**：业务 80% 是关系型，用 MongoDB 自己找罪

### 缓存 / 会话：Redis

**选择：** Redis（本地 brew 起；生产用阿里云 / 火山云托管版）

**为什么：**
- 会话存储、限流、对话上下文短期缓存
- 业界标准

**不选：** 没必要。KeyDB / Dragonfly / Valkey 性能更好但生态不如 Redis。

### 对象存储：火山引擎 TOS

**选择：** 火山 TOS（生产）；本地开发用 tempfile

**为什么：**
- 和火山方舟 / STT / TTS 同账号，减少账号切换成本
- 国内 CDN 顺

**不选：**
- 阿里云 OSS / 腾讯云 COS：可行备选
- 自建 MinIO：本地可以，生产不值得维护

---

## 五、AI / 语音链路

### 全家桶：火山方舟（Volcengine Ark）

**选择：** 火山方舟的 STT + LLM（豆包）+ TTS 全家桶

**为什么：**
- **STT**：火山/讯飞都强，火山和 LLM / TTS 同账号省事
- **LLM（豆包）**：国内便宜、快、英语够用
- **TTS**：火山有儿童音色，自然度高
- 一个账号一套密钥，账单清晰

**不选（但 adapter 接口可切）：**
- **OpenAI / Claude**：国内不可直连
- **讯飞 STT**：也强，但账号分离
- **DeepSeek LLM**：更便宜 + 能力更强，V2 可能切过去
- **阿里云 CosyVoice TTS**：新秀，值得观察

### 范围约束策略：Prompt + 事后校验（Level 0+1）

**选择：** ALLOWED_VOCAB 塞 prompt + 事后 tokenize 比对词表

**为什么：**
- 词表小（几百到两千词），prompt caching 命中后几乎零成本
- 事后校验逻辑简单（纯字符串处理）
- 可靠性 ~95%+，足够

**不选：**
- **RAG（向量检索）**：词表结构化，上 embedding 是过度设计
- **Constrained decoding / logit bias**：国内 LLM API 不一定支持；牺牲自然度
- **微调**：成本过高

---

## 六、工程化 / DX

### Git hooks：lefthook

**选择：** lefthook 2.x（brew 安装，`lefthook.yml` 在项目根）

**为什么：**
- 单 Go 二进制，不依赖 Node/Python runtime
- YAML 配置清爽
- 天然跨语言（同时管 Python + JS）
- 支持并行执行
- 比 husky 通用，不用装一堆 npm 包

**不选：**
- **husky + lint-staged**：JS only，多语言项目痛
- **pre-commit**（Python 生态）：可行但生态偏 Python
- **裸写 `.git/hooks/`**：不可跨人复现

### Commit 格式：commitlint + Conventional Commits

**选择：** `@commitlint/cli` + `@commitlint/config-conventional`，lefthook `commit-msg` hook 触发

**格式：** `<type>(<scope>): <subject>`
- `feat` 新功能 / `fix` bug / `refactor` 重构 / `chore` 杂项 / `docs` 文档 / `test` 测试 / `style` 格式 / `perf` 性能

**为什么：**
- 标准化后未来可自动生成 changelog
- 语义分组便于 diff review
- commitlint 强制执行，防漂移

**不选：** 不强制。但团队在扩大时会吃亏。

### 容器化：V1 不做

**选择：** 延后到发布阶段，一次性补 `Dockerfile` + `docker-compose.yml`

**为什么：**
- 开发阶段结构频繁变动，每次改同步 Dockerfile 成本高
- 本地开发用 native 更快

**但代码必须 "Docker-ready"：**
- 配置走 env vars / config 文件
- 日志 stdout/stderr
- 不依赖 `__file__` 相对路径
- 音频等临时文件用 tempfile 或上传到 TOS
- 启动不预设文件系统约定

---

## 七、被明确排除的选项（为什么不考虑）

| 方案 | 排除原因 |
|---|---|
| Vercel 部署 | 国内不可用 |
| OpenAI / Claude API | 国内不可用 |
| Supabase | 国内不可用 |
| Google Fonts 中文字体 | 国内访问不稳 |
| Prisma | Python 客户端不官方，架构灾难 |
| Husky | JS only，多语言 monorepo 痛 |
| Docker（V1 阶段）| 开发期改得太频繁，成本不划算 |
| Biome | 舍弃了 Next 的 ESLint 插件生态 |
| Django / Flask | 异步不原生 |
| MongoDB | 业务是关系型 |

---

## 八、待定 / 未来考虑

| 事项 | 触发条件 |
|---|---|
| Docker 化 | V1 稳定后，发布前 |
| 上云部署（火山 / 阿里 / 腾讯）| 发布前 |
| 流式语音链路（WebSocket STT/TTS）| V1 整段体验跑通 |
| DeepSeek 替代豆包 | 当豆包价格 / 能力劣势明显时 |
| pgvector 启用 | 做语义相似词推荐时 |
| PWA 离线模式 | V2 |
| COPPA / 个保法合规 | 对外推广前 |
| 短信 / 微信登录 | 用户量到降低登录门槛阶段 |
