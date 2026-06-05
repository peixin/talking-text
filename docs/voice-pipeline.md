# 语音对话管线技术详解（V1 Batch 与 SSE Streaming 升级）

> 覆盖范围：从用户按下录音按钮，到 AI 语音从扬声器播出，以及本轮数据落库的完整链路。  
> 涉及文件：`ChatClient.tsx` · `actions.ts` · `api/conversation.py` · `audio_codec.py` · `adapters/stt/volc.py` · `adapters/llm/volc.py` · `adapters/tts/volc.py` · `core/dialog/orchestrator.py` · `storage/models/turn.py`

---

## 一、全链路时序图 (V1 Batch 模式)

```
User                  浏览器                  FastAPI              Volcengine
 │                     │                        │                      │
 │──── 按下录音 ───────►│                        │                      │
 │                     │ getUserMedia()          │                      │
 │                     │ MediaRecorder.start()   │                      │
 │──── 按停录音 ───────►│                        │                      │
 │                     │ recorder.stop()         │                      │
 │                     │ Blob(webm/opus)         │                      │
 │                     │──── POST /conversation/turn ──────────────────►│
 │                     │     multipart: audio + learner_id + history    │
 │                     │                        │                      │
 │                     │               ffmpeg transcode                 │
 │                     │               webm → ogg/opus 16kHz mono      │
 │                     │                        │                      │
 │                     │                        │──── WS bigmodel ────►│ STT
 │                     │                        │   [binary chunks]    │
 │                     │                        │◄──── text ───────────│
 │                     │                        │                      │
 │                     │                        │──── chat.completions ►│ LLM
 │                     │                        │   [messages]         │
 │                     │                        │◄──── reply text ─────│
 │                     │                        │                      │
 │                     │                        │──── POST tts ────────►│ TTS
 │                     │                        │   [text]             │
 │                     │                        │◄──── mp3 stream ─────│
 │                     │                        │                      │
 │                     │               INSERT turn → PostgreSQL        │
 │                     │               写音频文件 → ./storage/audio/     │
 │                     │                        │                      │
 │                     │◄─── JSON {text_user, text_ai, audio_b64} ─────│
 │                     │                        │                      │
 │                     │ <audio>.src = data:audio/mpeg;base64,...      │
 │◄──── 播放 AI 语音 ───│ <audio>.play()         │                      │
 │                     │ 消息气泡追加到列表       │                      │
```

---

## 二、各段连接类型与生命周期 (V1 Batch)

每一跳的协议、是否流式、连接何时开/关：

```
段                          协议              流式？   连接生命周期
────────────────────────────────────────────────────────────────────────────
浏览器 → Next.js           HTTP POST         否       Server Action 内部调用；
  (Server Action)          (Next-Action 头)           浏览器不感知，由框架封装

Next.js → FastAPI          HTTP POST         否       单次请求；等待后端全部完成
  (lib/backend.ts)         multipart/form-data        才返回（约 3-5 秒 RTT）

FastAPI → Volcengine STT   WebSocket         是       每 turn 新开一条 WS：
  (websockets.connect)     wss://...                  init frame → 分块发音频
                                                       → 收 NEG_SEQ 帧 → 自动关闭

FastAPI → Volcengine LLM   HTTP POST         否 (V1)  单次 request-response；
  (openai SDK)             OpenAI-compat REST          连接由 SDK 内部连接池管理

FastAPI → Volcengine TTS   HTTP POST         是(响应体) chunked transfer encoding；
  (httpx.stream)           https://...                 连接保持到收到 code=20000000
                                                        结束帧后由 httpx 关闭
```

**关键结论：**
- 整条链路只有 **STT 用 WebSocket**，其余全是 HTTP。
- TTS 的"流式"只是 **HTTP 分块响应**，不是 WebSocket；客户端读行，凑完整段 MP3 再返回。

---

## 三、浏览器端（ChatClient.tsx）

### 用户操作 → 录音

| 步骤 | 操作 | 关键参数 |
|---|---|---|
| 1 | `navigator.mediaDevices.getUserMedia()` | `channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true` |
| 2 | `pickMimeType()` 按优先级探测格式 | 优先 `audio/webm;codecs=opus` → `audio/webm` → `audio/ogg;codecs=opus` → `audio/mp4` |
| 3 | `MediaRecorder.start()` | 开始收集 chunk |
| 4 | 用户再次点击 → `recorder.stop()` | `onstop` 触发，拼合 `Blob` |
| 5 | `setMode("uploading")` | UI 进入 spinner 状态 |

### 三种 UI 状态

```
idle  ──── 点击 ────►  recording  ──── 点击 ────►  uploading  ──── 完成 ────►  idle
  🎙                      ■ (pulse)                  ⊙ (spin)
```

### 构造请求

```typescript
const fd = new FormData();
fd.append("audio", blob, `recording.webm`);   // Blob, Content-Type: audio/webm
fd.append("learner_id", activeLearner.id);     // UUID string
fd.append("history", JSON.stringify(          // 最近 6 轮，JSON 数组
  messages.slice(-6)                           // [{role, text}, ...]
));
```

### 处理响应

```typescript
// audio_b64 是 base64 编码的 mp3
const url = `data:audio/mpeg;base64,${result.audio_b64}`;
audioRef.current.src = url;
audioRef.current.play();                       // 自动播放
setMessages(prev => [...prev,
  { role: "user",      text: result.text_user },
  { role: "assistant", text: result.text_ai   },
]);
```

---

## 四、HTTP 传输层（actions.ts → lib/backend.ts）

Server Action `sendTurn(fd)` 运行在服务端，不暴露任何后端地址给浏览器。

```
浏览器                     Next.js Server Action              Python FastAPI
   │                              │                                │
   │── sendTurn(FormData) ───────►│                                │
   │   (跨进程 RPC，不是 fetch)    │                                │
   │                              │── POST /conversation/turn ────►│
   │                              │   Headers:                     │
   │                              │     Cookie: session=<token>    │
   │                              │   Body: multipart/form-data    │
   │                              │     audio: <blob>              │
   │                              │     learner_id: <uuid>         │
   │                              │     history: <json>            │
   │                              │                                │
   │                              │◄── 200 JSON ───────────────────│
   │                              │    { turn_id, text_user,       │
   │                              │      text_ai, audio_b64,       │
   │                              │      audio_format }            │
   │◄── SendTurnResult ──────────│                                │
   │    { ok: true, ...data }     │                                │
```

**错误码映射：**

| HTTP 状态 | detail | 前端 error code |
|---|---|---|
| 422 | `EMPTY_TRANSCRIPTION` | `CHAT_EMPTY_TRANSCRIPTION` |
| 404 | `Learner not found` | `CHAT_LEARNER_NOT_FOUND` |
| 401 | session expired/missing | redirect to `/login?expired=1` |

---

## 五、API 层（conversation.py）

**端点：** `POST /conversation/turn`  
**认证：** `get_current_account` 从 session cookie 解析当前 Account

```
请求进入
   │
   ├─ 1. 验证 learner 归属
   │      SELECT * FROM learner WHERE id=? AND account_id=?
   │      → 404 if not found
   │
   ├─ 2. 解析 history JSON
   │      → 400 if malformed
   │
   ├─ 3. 读取 audio bytes
   │      UploadFile.read()
   │      → 400 if empty
   │
   ├─ 4. 条件 transcode
   │      if content_type contains "webm" or filename ends ".webm":
   │          audio_bytes = await webm_opus_to_ogg(audio_bytes, sample_rate=16000)
   │      → 500 if ffmpeg fails
   │
   └─ 5. 调用 DialogOrchestrator.single_turn()
          → 422 if EmptyTranscriptionError
          → TurnResponse(turn_id, text_user, text_ai, audio_b64, audio_format)
```

**请求格式：**
```
Content-Type: multipart/form-data

audio:      <binary>    webm/opus（浏览器原始），< ~1MB for < 60s
learner_id: <uuid>      string form
history:    <string>    JSON array，[{"role": "user"|"assistant", "text": "..."}]
```

**响应格式：**
```json
{
  "turn_id":    "550e8400-...",
  "text_user":  "What is your favorite color?",
  "text_ai":    "My favorite color is blue! What's yours?",
  "audio_b64":  "<base64 encoded MP3>",
  "audio_format": "mp3"
}
```

---

## 六、音频转码（audio_codec.py）

**输入：** 浏览器 webm/opus 字节流（48kHz，可能双声道）  
**输出：** ogg/opus 字节流（16kHz 单声道，24kbps）

```
webm bytes (pipe:0)
       │
       ▼
   ffmpeg
   -f webm -i pipe:0
   -vn                    ← 去掉视频轨道（webm 容器可能带空视频）
   -ac 1                  ← 强制单声道
   -ar 16000              ← 重采样到 16kHz（STT 期望）
   -c:a libopus           ← 重新编码为 opus（不是 copy，因为要改参数）
   -b:a 24k               ← 码率 24kbps（语音质量足够）
   -f ogg pipe:1
       │
       ▼
  ogg bytes (pipe:1)
```

> **为什么不用 `-c:a copy`？** 因为需要同时修改采样率（48→16kHz）和声道数，这两个操作都必须走解码→重编码，copy 模式无法完成。

**典型耗时：** ~30ms（本地 ffmpeg，6秒录音）  
**文件大小：** ~9KB/秒（16kHz, 24kbps opus）

---

## 七、STT 适配器（adapters/stt/volc.py）

**服务：** Volcengine bigmodel_nostream（豆包流式语音识别）  
**协议：** 自定义二进制帧 over WebSocket  
**端点：** `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream`

### 6.1 连接与鉴权

```
WebSocket 握手 Headers:
  X-Api-App-Key:     <VOLC_SPEECH_APP_ID>
  X-Api-Access-Key:  <VOLC_SPEECH_ACCESS_KEY>
  X-Api-Resource-Id: volc.seedasr.sauc.duration
  X-Api-Connect-Id:  <random UUID，每次连接唯一>
```

### 6.2 二进制帧结构

```
Byte 0:  [protocol version (4b)] [header size in 4-byte words (4b)]
           0x1                    0x1  → header = 4 bytes
Byte 1:  [message type (4b)]     [flags (4b)]
Byte 2:  [serialization (4b)]    [compression (4b)]
Byte 3:  reserved 0x00
─────────────────── (以上是 4 字节基础 header) ───────────────────
[sequence: int32 big-endian]   ← 仅当 flags 含 SEQ 时存在
[payload size: uint32 big-endian]
[payload bytes]                ← gzip 压缩后的内容
```

消息类型：

| 类型 | 值 | 用途 |
|---|---|---|
| FULL_CLIENT | `0b0001` | 初始化请求（含音频参数）|
| AUDIO_ONLY  | `0b0010` | 音频数据包 |
| FULL_SERVER | `0b1001` | 服务端响应 |
| ERROR       | `0b1111` | 错误响应 |

flags：

| flag | 值 | 含义 |
|---|---|---|
| NONE        | `0b0000` | 无序号 |
| POS_SEQ     | `0b0001` | 含正序号（中间包）|
| NEG_SEQ_NO_NUM | `0b0010` | 最后一包，无序号 |
| NEG_SEQ     | `0b0011` | 最后一包，含负序号 |

### 6.3 通信流程

```
client                                          server
  │                                               │
  │── FULL_CLIENT (seq=1, gzip JSON) ────────────►│
  │   {user, audio: {format:"ogg", rate:16000,    │
  │    bits:16, channel:1, codec:"opus"},          │
  │    request: {model_name:"bigmodel",            │
  │              enable_itn:true,                  │
  │              enable_punc:true}}                │
  │◄── ACK (FULL_SERVER) ─────────────────────────│
  │                                               │
  │── AUDIO_ONLY (seq=2, POS_SEQ, gzip) ─────────►│  chunk[0:6400]
  │◄── 中间响应（忽略）──────────────────────────────│
  │   等待 50ms                                    │
  │── AUDIO_ONLY (seq=3, POS_SEQ, gzip) ─────────►│  chunk[6400:12800]
  │◄── 中间响应（忽略）──────────────────────────────│
  │   ...（每 6400 字节一包，约 200ms 音频）          │
  │── AUDIO_ONLY (seq=-N, NEG_SEQ, gzip) ─────────►│  最后一包（seq 取负）
  │                                               │  ← 服务端开始识别
  │◄── FULL_SERVER (flags=NEG_SEQ) ───────────────│  最终结果
  │   {result: {text: "..."}, audio_info: {duration: 5880}}
  │
  ▼
STTResult {
  text:          "Hello, today we are going to learn 3 new English words. Are you ready?"
  audio_seconds: 5.88
}
```

---

## 八、LLM 适配器与 DeepSeek 深度优化（adapters/llm/）

除了火山引擎的豆包，系统在 `2026-05-02` 下午场的升级中引入了 OpenAI 兼容的 **DeepSeek LLM Adapter**，并支持以下高级特性：

### 8.1 极速非 CoT 对话配置
在 `config.toml` 中**按交互环节（stage）**配模型，并对对话环节的 DeepSeek 显式配置 `thinking = "disabled"`。简单日常口语教学对话不需要慢思考 (CoT)，禁用 CoT 可以显著将 LLM 生成延迟从 8 秒以上压缩到 **1.1 秒** 左右：

```toml
[adapter.stage.chat]          # 对话 + 工具任务
provider = "deepseek"         # 一键切换：deepseek / volc_ark / aliyun / xiaomi
model = "deepseek-v4-flash"
thinking = "disabled"         # 对话禁用 CoT
```

> 历史说明：早先用全局 `llm_provider` + `[adapter.llm.<provider>]`，2026-06-05 起改为 `[adapter.stage.*]` 每环节独立配模型；所有厂商共用 `OpenAICompatibleLLMAdapter`。

---

## 九、流式对话管线升级 (SSE Streaming Pipeline)

批式模式等待大模型全部打字完毕再整体返回，会导致极长的等待。系统引入了 **FastAPI SSE 端点** 和 **Next.js 服务端 Route Handler 代理**。

### 9.1 SSE 事件发生顺序设计
FastAPI 的 `POST /sessions/{id}/turns/stream` 端点依次向前端推送以下格式的事件：

```
1. text_user     — STT 语音识别完成（或文字 input echo），让前端立即渲染出孩子说的气泡
2. text_ai_delta — LLM 吐出的 Delta Token，供前端实现打字机动态生成效果（高频推送）
3. text_ai_done  — LLM 彻底完成。注意：后端会首先完成 DB 事务落库，再推送本事件（携带 valid turn_id），确保客户端按钮点击时不会发生 404
4. audio_ready   — 异步 TTS 实时合成完成，包含 audio_b64 Base64 音频段（供语音模式下自动播放）
5. done          — 对话最终结算事件（包括生成的会话新 title 提示等）
6. error         — 对话发生任何阻碍的错误（如 EMPTY_TRANSCRIPTION 等）
```

### 9.2 开发环境的 Route Handler 跨域代理
在本地开发时，由于浏览器无法直接跨端口携带 HttpOnly 的安全 Cookie 去向不同端口的 Python FastAPI 后端发送 POST 连接，我们在前端放置了代理中转：
- **Next.js Route Handler**: `frontend/app/api/chat/[sessionId]/stream/route.ts`
- 浏览器向同端口前端的本路由发起流式请求，Route Handler 负责从本地服务端读取 session 凭证并作为 Auth 头转发给 FastAPI。
- **生产环境策略：** 上线 Nginx 反向代理将前后端同域化后，该代理层可直接去除，由浏览器直连 Python FastAPI 端点。

### 9.3 浏览器端交互时序改进

| 对话模式 | 动作阶段 | 瞬时反馈 UI 呈现 |
|---|---|---|
| 语音模式 | 用户松开录音按钮 | 乐观更新：立刻出现“识别中...”的用户气泡，防止视觉卡顿 |
| 语音模式 | 1.3 秒 | 收到 `text_user` 事件，用户文本整段被替换为转写的英文 |
| 语音模式 | 1.3 ~ 2.4 秒 | AI 回复逐字逐 Token 出现，AI 气泡呈现微动的打字光标 |
| 语音模式 | 2.5 秒 | 收到 `text_ai_done`，光标消失，播放按钮出现（此时 turn 已落库） |
| 语音模式 | 3.7 秒 | 收到 `audio_ready`，前端绑定的统一 `<audio>` 播放器自动静默开播 |
| 文字模式 | 点击发送 | 乐观更新插入用户气泡，AI 文本几乎瞬时（1.1 秒内）流式渲染完毕 |
