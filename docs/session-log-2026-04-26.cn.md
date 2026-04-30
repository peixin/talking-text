# 第二次 Session 记录 · 2026-04-26 · 首版 /chat 落地

> 入场状态：登录注册、Learner CRUD、active learner 切换都已就绪。
> 退场状态：完整的 STT → LLM → TTS 单轮闭环代码就位（待 `poetry install` + 填 key + 迁移即可跑）。
>
> 本次 session 的灵魂：**把"开口一次，世界就大一寸"从理念变成可点击的麦克风按钮。**

---

## 阶段一：选型——五个抉择

### 1.1 协议：V1 HTTP，V2 WebSocket

抉择确认：**前端 ↔ 后端用 HTTP；后端 ↔ 火山要 WebSocket 也内部消化。**

理由：
- V1 每轮端到端 3-5 秒（STT 1s + LLM 1-2s + TTS 1s）孩子能接受
- 流式 WebSocket 把首包压到 ~600ms 是体验质变，但调试和错误处理代价大几倍
- CLAUDE.md 第四条架构规则原本就规定：Adapter 接口从 V1 起同时暴露 `invoke()` + `stream()`，V2 升级不破坏 API

落地：三个 Adapter Protocol 都有 `stream()` 签名，V1 实现里抛 `NotImplementedError`。架子已搭好。

### 1.2 不用豆包 SDK——三层分别处理

| 层 | 方案 | 理由 |
|---|---|---|
| **LLM** | `openai` SDK 指 Ark base URL | Ark 兼容 OpenAI 协议，未来换 Qwen / 智谱 / DeepSeek 几乎零改造 |
| **STT/TTS** | `httpx` / `websockets` 直接打 HTTP/WS | STT/TTS 跨厂商没有"OpenAI 标准"，Whisper 不是事实标准。自己定义 Protocol，把火山请求拼装藏在 `volc_*.py` 里 |
| **不要的** | 豆包官方 Python SDK | 它和我们的异步 FastAPI 风格、OpenAI 风格都对不上，且锁定厂商 |

### 1.3 TTS：豆包语音合成 2.0 + Tina 老师 2.0

为什么 2.0 不是 1.0：
- **Tina 老师 2.0（`zh_female_yingyujiaoxue_uranus_bigtts`）只在 2.0 里**——这是文档里唯一一个明确"教育场景、中文 + 英式英语双语"的音色，对儿童英语陪练完美对口
- **2.0 反而更便宜**（3 元/万字符 vs 5 元）
- 表现力、情感、英文质量都强一档

接口选项里挑 `https://openspeech.bytedance.com/api/v3/tts/unidirectional`（HTTP Chunked 单向流式）：
- 火山 V3 没有"纯一次性返回"的 HTTP 接口，HTTP Chunked 是离它最近的
- 客户端可以一次性收完再播，等价于 batch
- 比 SSE 版本少一层封装，调试方便

### 1.4 STT：流式语音识别 2.0（seedasr）+ `bigmodel_nostream`

控制台开了"Doubao-流式语音识别"，资源 ID 是 `volc.seedasr.sauc.duration`（小时版）。

四个端点选 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream`（流式输入模式）而不是 `bigmodel`（双向流式）：
- **流式输入模式准确率更高**（双向流式是边说边出字，会跳跃修正）
- 5s 音频 ~300-400ms 返回，对话体验流畅
- 仍是 WebSocket，但客户端"塞完音频立即拿结果"——从我们 API 角度看是同步 batch

不选"录音文件识别 2.0"（0.8 元/小时，便宜但 ~10s+ 延迟）——成本差对一个孩子每天 5 分钟的用量级别（~11 元/月 vs ~3 元/月）完全无所谓，UX 才是命。

不选"实时语音交互"——它是端到端语音 Agent，把 STT→LLM→TTS 全包了。**坚决不能用**：会绕过 Scope Computer 干预点，把产品哲学（"在已学范围内说话"）变成不可执行。

### 1.5 音频格式：浏览器 webm/opus → 后端 ffmpeg 重封装到 ogg

| 维度 | WAV | MP3 | **WebM/Opus** | M4A/AAC |
|---|---|---|---|---|
| 10s 体积 | ~320 KB | ~80 KB | **~25 KB** | ~40 KB |
| 浏览器原生录制 | 需 lib | 需 lib | Chrome/Firefox 默认 | Safari 默认 |
| 火山 STT 接受 | ✅ | ✅ | 需重封装为 ogg | ✅ |

落地：浏览器 `MediaRecorder` 录默认 webm/opus → 后端 `ffmpeg -c:a copy -f ogg`（重封装容器、不重编码、~30ms、零质量损失）→ 火山 STT 收 ogg/opus。

为什么不直接发 webm：火山文档明确支持 `opus / ogg`，没明写 `webm`。一次 ffmpeg 重封装极快、稳，比 debug "为什么 webm 失败" 划算。

Safari 暂不管——V1 控制台提示用 Chrome。

---

## 阶段二：数据建模——三个分歧

### 2.1 Turn 是行，不是 JSON 数组

用户提的合理疑问：这表基本不查询，更像 log，是不是一个 Session + JSON 数组就够？

回答**坚定的关系型**，按重要性：

1. **`vocab_event` 必须 FK 到 turn**——V2 mastery tracker 要按"这个词第几轮出现的、相对时间"等维度查。如果 turn 是数组里的元素，vocab_event 没法稳定指向（数组索引不是 ID，重排就废）
2. **计费按轮聚合**——账单 SQL `SUM/COUNT GROUP BY learner_id` 一句话，JSONB 数组要全量反序列化再 reduce
3. **部分失败的原子性**——一轮里 STT ✓ → LLM ✗ → TTS 没跑。每轮一行的话"失败就不入库"是最简策略
4. **"log 偏向"≠ JSONB**——关系型 log 也是 log，价值在于**可聚合**

### 2.2 `vocab_event` 不是装饰品

用户问："这表干什么？"——当时我没解释清楚。

具象例子：

> 小明用了 3 个月，每天 50 轮，总共听老师说了 4500 句英文。
>
> **没有 vocab_event：** V2 上线 mastery tracker 问"小明掌握了哪些词？"——答 0 个。3 个月数据全部丢失，必须再观察 3 个月才有结论。
>
> **有 vocab_event：** 一个 SQL 立刻出："小明听过 elephant 30 次、说过 10 次，最近一次昨天"——掌握度立刻可估。

CLAUDE.md 第三条原文："Skip V1 writes → V2 starts from zero → 6 months of data lost"——就是怕这个。

**实质上这是数据基建投资。** 现在每轮多花 ~5ms 写几行，半年后 V2 mastery tracker 上线那一刻立刻有半年的训练数据。

### 2.3 V1 不引入 Session 表

短期上下文（让 AI 记住前几轮）由前端持有最近 N 轮（`HISTORY_TURNS = 6`）、附在请求里。后端不结构化存 Session。等 V2 真的要按"会话"做长程记忆 / 复盘时再补表。

### 2.4 最终 schema

```
turn:
  id (UUID PK)
  learner_id (FK → learner ON DELETE CASCADE, INDEX)
  text_user, text_ai (Text NOT NULL)
  audio_in_path, audio_out_path (String 512, NULL)   -- V1 本地路径，V2 换 TOS URL
  stt_audio_seconds (Float)
  llm_input_tokens, llm_output_tokens (Integer)
  tts_chars (Integer)
  + TimestampMixin

vocab_event:
  id (UUID PK)
  learner_id (FK CASCADE, INDEX)                     -- 冗余存，V2 mastery tracker 高频按 learner 查
  turn_id (FK CASCADE, INDEX)
  word (String 64, INDEX)                            -- V1 surface form，V2 加 lemma 列
  speaker (String 8)                                 -- "user" | "ai"
  + TimestampMixin
```

刻意不加的字段：
- `audio_url`（等 TOS）、延迟字段（日志里有）、错误状态（失败的 turn 不入库）、`event_type`（V2 才有 "asked_about"）、`(learner_id, word)` 复合索引（V2 mastery tracker 上线时配查询模式一起加）

---

## 阶段三：实施清单

### 3.1 后端

| 文件 | 作用 |
|---|---|
| `storage/models/turn.py` + `vocab_event.py` | 新表 |
| `adapters/{llm,stt,tts}/protocol.py` | 三个 Protocol（`invoke()` + `stream()`，stream 占位 V2） |
| `adapters/llm/volc.py` | `AsyncOpenAI(base_url=Ark)` |
| `adapters/tts/volc.py` | `httpx` HTTP Chunked，`aiter_lines()` 累积 base64 audio |
| `adapters/stt/volc.py` | 自实现火山二进制协议（4 字节 header + sequence + payload size + gzip payload）+ 流式输入模式 |
| `audio_codec.py` | `ffmpeg -f webm -c:a copy -f ogg`（重封装，不重编码） |
| `core/dialog/orchestrator.py` | STT → LLM → TTS → DB 持久化 + vocab_event 写入 |
| `core/dialog/vocab_extractor.py` | 正则 + 小写 + 去停用，提取英文单词 |
| `api/conversation.py` | `POST /conversation/turn`（multipart 上传 audio + learner_id + history JSON） |

每个 Adapter 都有 `if __name__ == "__main__"` 烟囱测试，可以独立调通对应 key 后再串：
```bash
poetry run python -m app.adapters.llm.volc      # 一句 AI 招呼
poetry run python -m app.adapters.tts.volc      # 写 ./tmp/tts_smoke.mp3
poetry run python -m app.adapters.stt.volc x.ogg
```

### 3.2 前端

| 文件 | 改动 |
|---|---|
| `lib/backend.ts` | FormData 时不强塞 `Content-Type`（让浏览器加 multipart boundary）；加 `conversation.turn()` |
| `(app)/chat/ChatClient.tsx` | `MediaRecorder` 点击录音 / 再点结束的按钮；3 状态机 idle/recording/uploading；`<audio>` 自动播放 base64 data URL |
| `(app)/chat/actions.ts` | `sendTurn` Server Action：FormData 透传到后端，错误码归一 |
| `i18n/messages/{zh-CN,zh-TW,en}.json` | chat 文案 + `Chat.errors.*` |

### 3.3 配置

- `.env.example`：6 组火山 key + audio storage 开关 + 默认 voice
- `.gitignore`：`tmp/` 和 `backend/tmp/`
- `pyproject.toml`：加 `openai`、`websockets`

---

## 几个值得记下来的细节

### 音频回传方式：base64 in JSON

为什么不返回 URL：
- V1 不上 TOS
- 加 `GET /conversation/audio/{id}` 是第二个 roundtrip
- 5s 语音 mp3 ~80KB，base64 ~107KB，单次响应里塞得下

实现：后端 base64 编码 → JSON 响应 → 前端 `data:audio/mpeg;base64,...` → `<audio>.play()`。等 V2 加历史回顾页时再补 `GET /conversation/audio/{id}/{kind}` 端点。

### Adapter 单例模式

`api/conversation.py` 顶层直接 `_llm = VolcLLMAdapter()` / `_stt = VolcSTTAdapter()` / `_tts = VolcTTSAdapter()`——三个 Adapter 都是无状态的 httpx/openai 客户端薄包装，单例跨请求安全，避免每轮重新握手。不用 `Depends()` 是因为它们没有 per-request 状态。

### TTS V3 HTTP Chunked 的解析假设

我假设响应是行分隔 JSON（`response.aiter_lines()`）。文档示例都是一行一个 JSON，应该没问题。**若实测发现解析问题**，改成手动按字节累积 JSON 即可——这是 V1 唯一一个我没把握的点。

### lucide-react v1.9.0

注意这个项目用的是 lucide-react `^1.9.0` 而非通常的 `0.x`——`Mic / Square / Loader2` 都正常导出。新引入图标前先 `ls node_modules/lucide-react/dist/esm/icons/` 确认。

---

## 关键决策与反思

1. **不开"实时语音交互"**——它是看上去最简单的方案（端到端，火山一站搞定），但会绕过 Scope Computer。**这个克制是对的**：产品的灵魂在 STT → LLM 之间的那一步词汇过滤，不能为了少写代码把它跳掉。

2. **每轮多花 ~5ms 写 vocab_event**——V1 完全用不上，但 V2 那一刻会感谢这个决定。这是"现在做的最有价值的事是给未来铺路"的具象。

3. **Adapter 单例 vs 依赖注入**——V1 用单例，没引入 FastAPI `Depends()`。Adapter 无状态、无 per-request 配置变化的话，单例是最简洁的。等真的要做 per-Learner voice / per-Account model 切换，再切到 Depends。

4. **frontend lib/backend.ts 的 Content-Type 默认值 bug**——之前一直默认 `application/json`，加 multipart 时才暴露。值得写进经验：**通用 fetch wrapper 永远要让 FormData 走"不设置 Content-Type"分支**，否则浏览器没法填 multipart boundary。

---

## 值得在新 Session 开头重新念一遍

承接上一份 session log 的心法，新增几条：

- **Adapter Protocol 的 `invoke()` 和 `stream()` 签名 V1 就锁死。** stream 可以抛 NotImplementedError，但接口必须存在。
- **音频不存 URL，存路径或字节。** V1 路径是本地文件系统，V2 换 TOS URL，schema 不动。
- **每个 Adapter 都有 `__main__` 烟囱测试。** 调试时不要每次都跑全链路，先确认对应 key 单独能用。
- **错误码归一化在前端 i18n。** 后端抛 `EMPTY_TRANSCRIPTION` / `LEARNER_NOT_FOUND`，前端 `Chat.errors.*` 翻译——不让原始 message 漏到 UI 上。

---

*下一 Session 大概率做：Scope Computer V1 stub + Prompt assembler 替换硬编码 system prompt，把 Tina 的人设和"在已学范围内说话"接上。*
