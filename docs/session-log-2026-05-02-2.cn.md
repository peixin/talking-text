# Session Log — 2026-05-02（下午场）

## 背景

上午场完成了语音流水线基础功能。这一场的目标是定位并解决明显的延迟问题（说完话到看到回复 ~10s），然后把交互体验做到产品可用的水准。

---

## 1. 性能诊断

### 加 Timing Log

在关键节点加 `[perf]` 日志：

- 后端：`orchestrator.py` 分阶段计时（STT / LLM / TTS / DB persist）
- 后端：`session.py` 计时 transcode 和 `create_turn` 总耗时
- 前端：`console.log` 计时 `sendTurn` 整个 round-trip

日志受 `config.toml [debug] perf_logging = true` 开关控制，生产可开启，不含 PII。

同时在 `main.py` 配置 Python logging，让 `app.*` INFO 日志在 uvicorn 输出中可见（之前被过滤了）。

### 测量结果

| 阶段 | Volcengine LLM | DeepSeek |
|------|---------------|----------|
| transcode | ~0.1s | ~0.55s |
| STT | ~1.2s | ~1.3s |
| **LLM** | **~8.2s** | **~1.1s** |
| TTS | ~0.5s | ~1.2s |
| **语音合计** | **~10s** | **~4s** |

**结论：LLM 是瓶颈，占总延迟 80%。** STT 和 TTS 不是问题。

---

## 2. 切换 LLM 提供商：DeepSeek

### 配置策略重构

引入 per-provider 子节，每个 adapter 的可调参数都收在自己的 section 里：

```toml
[adapter]
llm_provider = "deepseek"   # 切换提供商只改这一行

[adapter.llm.deepseek]
model = "deepseek-v4-flash"
thinking = "disabled"       # 简单对话禁用 CoT，减少延迟

[adapter.llm.volc_ark]
model = "doubao-seed-2-0-mini-260215"
```

`AppConfig` 增加 `LLMProviderConfig`，工厂在启动时读取 active provider 的配置并注入 adapter。

### DeepSeekLLMAdapter

OpenAI-compatible 接口，`thinking=disabled` 通过 `extra_body` 传参。新增 `stream()` 方法（`_stream_impl` async generator 模式），为后续流式做准备。

---

## 3. 流式对话管道（SSE）

### 设计理念

用户明确的交互期望：
- **文字模式**：input 立即显示（已知）；response 逐 token 流式；流式完成后播放按钮出现
- **语音模式**：STT 结果整段显示（完整文本，无需 stream）；LLM response 流式；流式完成自动播放

### 后端：SSE 事件流

`DialogOrchestrator.stream_turn()` 按以下顺序 yield 事件：

```
text_user     — STT 完成（或文字 input echo）
text_ai_delta — LLM token（重复）
text_ai_done  — LLM 完成，turn 已落库，turn_id 有效
audio_ready   — TTS 完成，包含 audio_b64（语音模式）
done          — 含 session_title
error         — 含 code（如 EMPTY_TRANSCRIPTION）
```

关键顺序设计：**先 DB persist，再 yield `text_ai_done`**。这样客户端收到 `turn_id` 时 turn 已在库里，播放按钮点击不会遇到 404。

新增 FastAPI 端点 `POST /sessions/{id}/turns/stream`，在 per-session lock 内消费 `stream_turn()` 生成器，lock 释放后执行 `_after_turn`（session title 生成）。

### 前端：统一架构

**Route Handler 代理** (`/api/chat/[sessionId]/stream/route.ts`)：解决开发环境跨域 Cookie 问题。浏览器无法直接携带 httpOnly Cookie 向不同端口的 Python 后端发 POST，Route Handler 在服务端读取 Cookie 后 attach 到 upstream 请求。

> **生产策略**：加 nginx 后 Next.js 和 Python 同域，Route Handler 可删除，浏览器直连。Route Handler 存在的真正理由是开发环境跨域，不是为了藏 URL。

**ChatClient 重构**：
- 统一 `<audio>` 元素由 ChatClient 持有（原来 ChatClient 和 MessageListClient 各有一个，会同时播放）
- `submitTurn()` 统一处理语音和文字，fetch SSE stream，逐事件更新 React state
- 乐观更新：提交后立即插入消息气泡，不等服务端响应

**MessageListClient 重构**：
- `audioState` 和 `onPlay` 从 ChatClient 注入，自己不再持有 audio element
- `streaming: true` → AI 气泡显示跳动点或闪烁光标
- `pending: true` → 用户气泡显示「识别中…」转圈

### 实际体验

| 模式 | 操作 | 用户看到 |
|------|------|---------|
| 语音 | 停止录音 | 立即出现「识别中…」气泡 |
| 语音 | +1.3s | 转写文字整段替换 |
| 语音 | +1.3~2.4s | AI 回复逐 token 出现 |
| 语音 | +2.5s | 光标消失，播放按钮出现 |
| 语音 | +3.7s | 音频自动播放 |
| 文字 | 发送 | 消息立即显示，AI 开始 stream |
| 文字 | +1.1s | AI 回复完整，播放按钮出现 |

---

## Next

### 优先（影响产品核心可用性）

1. **Scope Computer V1 stub + Prompt Assembler**
   - 当前 system prompt 是硬编码的 Tina persona
   - 需要接入课程词汇范围，让 LLM 只在已学词汇内回复
   - 接口已在 architecture.md §5 定义，实现 V1 stub（返回全部已学词）

2. **Curriculum ingestion MVP**
   - 家长粘贴课文/单词表 → LLM 结构化提取 → 人工审核 → 落库
   - V1 只做文本粘贴，不做 PDF/图片导入

3. **Tot Talk 系列教材数据**
   - 用户提供原始材料，走 curriculum ingestion 流程

### 技术债

- `transcode` 耗时 ~0.55s，主要是 ffmpeg 进程冷启动。可考虑换 `av` 库做纯 Python re-mux，省掉 subprocess fork
- 流式模式下 `llm_input_tokens` / `llm_output_tokens` 落库为 0，billing 精度待修（可从 `stream_options: include_usage` 取，或事后从文本估算）
- nginx 反代上线后，删除 Route Handler，浏览器直连 Python SSE 端点

### 暂缓（已在 CLAUDE.md 明确 defer）

- Docker / 容器化（V1 release 时统一做）
- STT → LLM → TTS 流水线并行（V2 WebSocket 方案）
- 掌握度追踪 `learner_word_stats`（V2）
