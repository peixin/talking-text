# 第三次 Session 记录 · 2026-04-30 · 首次全链路跑通

> 入场状态：STT / LLM / TTS 代码就位，key 未填，migration 未跑。
> 退场状态：录音 → STT → LLM → TTS → 播放完整跑通，turn 入库，vocab_event 架构决策完成并删除。

---

## 阶段一：Auth 修复——过期 Session 应 redirect 而非 500

### 问题

几天前登录过，session 过期后访问 `/zh-CN/chat`，后端返回 401，前端 Server Component 未捕获，直接抛 500。

### 根本原因链

1. `proxy.ts` 只检查 cookie 是否存在，不验证 session 有效性（设计正确，不应每请求都打后端）
2. 页面直接调用 `backend.learners.list()`，401 变 `BackendError` 向上抛，Next.js 渲染报错 → 500
3. 最初的修复尝试在 Server Component 里调 `cookies().delete()`——这是只读操作，静默失败 → 401 redirect 到 login，cookie 未清，`proxy.ts` 又 redirect 回 chat → 死循环 → 浏览器放弃 → 404

### 最终方案

- **`lib/session.ts`**：`withSession(fn)` 包装所有认证 backend 调用，捕获 401 时 redirect 到 `/{locale}/login?expired=1`（不尝试在 Server Component 里删 cookie）
- **`proxy.ts`**：检测到 `?expired=1` 时，在 middleware 响应里 `response.cookies.delete(COOKIE_NAME)`（middleware 可写 cookie），然后放行到 login 页面
- 三个认证页面（chat / parent / parent/learners）统一改用 `withSession`

**教训：** Next.js App Router Server Component 里 `cookies()` 是只读的；写 cookie（包括删除）只能在 Server Action 或 Middleware 里做。

---

## 阶段二：Volcengine STT 403 调试

### 过程

| 阶段 | 状态 | 原因 |
|---|---|---|
| 初始 | HTTP 403 | 火山控制台 APP 未被授权使用 `volc.seedasr.sauc.duration` 资源 |
| 误判 | 改 Resource ID 为实例名 → HTTP 400 | 实例名不是 Resource ID，文档明确写了正确值 |
| 修正 | 改回 `volc.seedasr.sauc.duration` → 403 | 确认 Resource ID 正确，问题在控制台配置 |
| 解决 | 控制台手动授权 APP 使用该资源 → 200 | 旧版控制台 APP 和服务资源需显式关联，开通服务 ≠ APP 自动有权限 |

**确认的技术细节：**
- STT WebSocket 头名称：`X-Api-App-Key`（TTS HTTP 是 `X-Api-App-Id`，两者不同）
- Resource ID：`volc.seedasr.sauc.duration`（文档明确，不是控制台显示的实例名）
- CORS 响应头里的 `Allow-Headers` 列表是调试认证头名称的可靠参考

**火山控制台坑：** 旧版控制台设计反直觉——开通服务后，还需要在 APP 管理里把服务资源显式绑定给 APP，两步缺一不可。

---

## 阶段三：全链路跑通

STT → LLM → TTS → DB 全部打通。第一轮真实对话入库：

```
turn:
  text_user: "Hello, nice to meet you. It's very hot in summer."
  text_ai:   "Nice to meet you too! It's very hot in summer. What do you do to stay cool?"
  stt_audio_seconds: 6.48
  llm_input_tokens:  139 / output_tokens: 563
  tts_chars: 75
```

**最后一步**：`turn` 表不存在 → 需先跑 `just migrate "add turn" && just db-up`。

---

## 阶段四：vocab_event 架构决策——删除

### 讨论过程

**原设计**：每轮写 `vocab_event`，一词一行，V2 mastery tracker 从中聚合。

**问题**：
- 数据量随轮次线性增长（10 万日活 × 50 轮 × 20 词 = 1 亿行/天）
- 每次掌握度查询要 `COUNT(*) GROUP BY` 扫描历史全量

**考察了替代方案：**

| 方案 | 结论 |
|---|---|
| turn 表加 JSONB 列存词列表 | 解决写入量，但跨轮聚合仍需全扫 |
| 单独 turn_event 表（一轮一行汇总） | 同上，聚合维度还是错的 |
| Meilisearch | 搜索引擎，无 GROUP BY / 聚合，不适合这个场景 |
| `learner_word_stats`（一 learner 一词一行） | ✅ 正确的聚合维度，upsert 增量更新，O(1) 查询 |

**最终决策**：删除 `vocab_event`。理由：

> `vocab_event` 是 `turn.text_user / text_ai` 的**衍生数据**，不是原始数据。只要 `turn` 文本在，任何时候都能从字符串分词重算——无非是内存计算。V1 完全用不上，不值得为"可能的 V2 需求"提前背这个写入成本。

**删除范围：**
- `app/storage/models/vocab_event.py`
- `app/core/dialog/vocab_extractor.py`
- `storage/__init__.py` / `models/__init__.py` 里的引用
- `orchestrator.py` 里的写入逻辑
- `alembic/versions/dc5311592f26_add_turn.py`（从中去掉 vocab_event 建表语句，重命名文件）

**V2 mastery tracker 方案（已确定方向，未实现）：**

当真正需要时，加 `learner_word_stats` 表：
```
(learner_id, word) PK
times_said, times_heard
first_seen_at, last_seen_at
```

每轮 `INSERT ... ON CONFLICT DO UPDATE`，历史数据从 turn 文本批量回填一次即可追上。

---

## 阶段五：V2 流式架构方向决策

### 背景问题

文档写好后，讨论了三个疑问：

1. 浏览器录音是完整文件，为什么 STT 要用 WebSocket？
2. V2 是否需要把浏览器→后端也改成 WebSocket？
3. 如果改成实时流式，句子拆分怎么处理？

### 结论

**STT 用 WebSocket 是 Volcengine 的 API 限制**，不是我们的设计选择。`bigmodel`（豆包语音识别）只有 WebSocket 端点，没有 HTTP batch 端点。"nostream" 只是说输出侧不流式（只给一个最终结果），输入侧必须分包发。

**V2 的流式改造集中在响应侧，不动请求侧。**

延迟瓶颈在：

```
STT 完成 → LLM 全文生成（等） → TTS 全部合成（等） → 一次性返回
```

V2 目标：

```
STT 完成 → LLM stream → 每出一句 → TTS 合成这句 → 立刻推给浏览器播放
```

具体改造点：

| 方向 | V1 | V2 |
|---|---|---|
| 浏览器 → 后端（音频） | HTTP POST | **保持不变** |
| 后端 → LLM | HTTP 批式 | HTTP stream（`stream=True`） |
| 后端 → TTS | HTTP chunked（已分块） | 按 LLM 句子粒度触发 |
| 后端 → 浏览器（音频） | base64 JSON 一次性 | **WebSocket 或 SSE，逐句推送** |

**"按停"按钮是最好的句子边界，不需要改。** 如果改成实时流式上传，就需要 VAD（静音检测）来判断孩子说完了没有——VAD 对孩子语音误触率高，口误、停顿都可能导致提前切断。用户手动按停，比任何算法都准确。

**感知延迟改善估算：**

- V1：停录后等 ~3s（STT + LLM 全文 + TTS 全文）
- V2：停录后等 ~1s（STT + LLM 第一句 + TTS 第一句），后续边说边播

---

## 值得在新 Session 开头重新念一遍

承接前两份 session log，新增：

- **Server Component 里 `cookies()` 只读**。删 / 写 cookie 只能在 Middleware 或 Server Action 里做。
- **Volcengine 旧版控制台**：开通服务 ≠ APP 有权限。APP 和资源需在控制台显式关联。
- **vocab_event 已删**。turn 表的 `text_user / text_ai` 是词频数据的源头，需要时从文本计算。
- **V2 mastery 方向**：`learner_word_stats` 增量 upsert，不是重建 vocab_event。

---

*下一 Session 大概率做：Scope Computer V1 stub + Prompt assembler（把 Tina 人设和词汇范围接进系统提示），以及教材录入 MVP。*
