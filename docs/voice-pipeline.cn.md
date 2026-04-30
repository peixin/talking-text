# 语音对话管线技术详解（V1 Batch）

> 覆盖范围：从用户按下录音按钮，到 AI 语音从扬声器播出，以及本轮数据落库的完整链路。
> 涉及文件：`ChatClient.tsx` · `actions.ts` · `api/conversation.py` · `audio_codec.py` · `adapters/stt/volc.py` · `adapters/llm/volc.py` · `adapters/tts/volc.py` · `core/dialog/orchestrator.py` · `storage/models/turn.py`

---

## 一、全链路时序图

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
 │                     │               写音频文件 → ./tmp/audio/        │
 │                     │                        │                      │
 │                     │◄─── JSON {text_user, text_ai, audio_b64} ─────│
 │                     │                        │                      │
 │                     │ <audio>.src = data:audio/mpeg;base64,...      │
 │◄──── 播放 AI 语音 ───│ <audio>.play()         │                      │
 │                     │ 消息气泡追加到列表       │                      │
```

---

## 二、各段连接类型与生命周期

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
  (openai SDK)             OpenAI-compat REST          连接由 SDK 内部连接池管理；
                                                       V2 切 stream=True 后变流式

FastAPI → Volcengine TTS   HTTP POST         是(响应体) chunked transfer encoding；
  (httpx.stream)           https://...                 连接保持到收到 code=20000000
                                                        结束帧后由 httpx 关闭
```

**关键结论：**
- 整条链路只有 **STT 用 WebSocket**，其余全是 HTTP
- LLM 在 V1 是 **批式**（等全文生成完才返回）；V2 换 `stream=True` 后是流式
- TTS 的"流式"只是 **HTTP 分块响应**，不是 WebSocket；客户端读行，凑完整段 MP3 再返回
- `Next.js → FastAPI` 这条 HTTP 连接会阻塞约 3-5 秒（串行等三个外部调用）；V2 换 WebSocket + 流水线后可以提前返回第一个音频包

---

## 三、浏览器端（ChatClient.tsx）

### 用户操作 → 录音

| 步骤 | 操作 | 关键参数 |
|---|---|---|
| 1 | `navigator.mediaDevices.getUserMedia()` | `channelCount: 1, sampleRate: 48000, echoCancination: true, noiseSuppression: true` |
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

> **ITN 自动生效：** "three" → "3"，"twenty percent" → "20%"  
> **标点自动生效：** `enable_punc: true`

**计费字段：** `audio_info.duration`（毫秒）→ `stt_audio_seconds`（秒）

---

## 八、LLM 适配器（adapters/llm/volc.py）

**服务：** Volcengine Ark（豆包大模型，OpenAI 兼容端点）  
**端点：** `https://ark.cn-beijing.volces.com/api/v3/chat/completions`  
**模型：** `doubao-seed-2-0-mini-260215`

### 7.1 请求构造

```python
messages = [
    {"role": "system",    "content": SYSTEM_PROMPT},        # Tina 角色设定
    {"role": "user",      "content": history[0].text},      # ← 最近 6 轮历史
    {"role": "assistant", "content": history[1].text},      #   (前端传入)
    ...
    {"role": "user",      "content": text_user},            # 本轮 STT 文本
]
```

**系统提示（System Prompt）：**
```
You are Tina, a warm and patient English teacher chatting with an
elementary-school child in mainland China. Always respond in English.
Use simple, age-appropriate vocabulary and short sentences (≤ 15 words).
If the child speaks Chinese, gently re-phrase their idea in English and
invite them to repeat it. Stay encouraging; never correct mistakes
harshly. Each turn, ask exactly one short follow-up question to keep
the conversation going.
```

### 7.2 调用参数

| 参数 | 值 | 说明 |
|---|---|---|
| `temperature` | 0.7 | 适度创意，不失稳定 |
| `max_tokens` | 200 | 防止超长回复 |

### 7.3 响应处理

```
OpenAI ChatCompletion Response
  │
  ├─ choices[0].message.content  → text_ai
  ├─ usage.prompt_tokens         → llm_input_tokens（计费）
  └─ usage.completion_tokens     → llm_output_tokens（计费）
```

**输出：**
```python
LLMResponse {
  text:          "My favorite color is blue! What's yours?"
  input_tokens:  187
  output_tokens: 12
}
```

---

## 九、TTS 适配器（adapters/tts/volc.py）

**服务：** Volcengine 语音合成 2.0（Doubao seed-tts）  
**协议：** HTTP 流式，Newline-Delimited JSON  
**端点：** `https://openspeech.bytedance.com/api/v3/tts/unidirectional`

### 8.1 鉴权

```
Headers:
  X-Api-App-Id:     <VOLC_SPEECH_APP_ID>
  X-Api-Access-Key: <VOLC_SPEECH_ACCESS_KEY>
  X-Api-Resource-Id: seed-tts-2.0
  X-Api-Request-Id: <random UUID，每次请求唯一>
  X-Control-Require-Usage-Tokens-Return: text_words   ← 请求返回计费字符数
  Content-Type: application/json
```

### 8.2 请求体

```json
{
  "user": { "uid": "talking-text" },
  "req_params": {
    "text": "My favorite color is blue! What's yours?",
    "speaker": "zh_female_yingyujiaoxue_uranus_bigtts",
    "audio_params": {
      "format": "mp3",
      "sample_rate": 24000
    }
  }
}
```

**声音选择：** `zh_female_yingyujiaoxue_uranus_bigtts`（Tina 英语教学声音）

### 8.3 响应流

```
HTTP/1.1 200 OK
Transfer-Encoding: chunked

{"code":0,"data":"//NExAAA..."}\n          ← base64 mp3 chunk
{"code":0,"data":"//NExBAS..."}\n          ← base64 mp3 chunk
{"code":0,"data":null,"sentence":{...}}\n  ← 句子时间戳（忽略）
{"code":0,"data":"//NExKQP..."}\n          ← base64 mp3 chunk
{"code":20000000,"message":"ok","data":null,"usage":{"text_words":12}}\n  ← 结束帧
```

| code | 含义 |
|---|---|
| `0` | 中间帧，包含音频数据或时间戳 |
| `20000000` | 结束帧，包含计费信息 |
| 其他 | 错误，抛异常 |

### 8.4 音频拼合

```python
audio_chunks = []
for line in response.aiter_lines():
    msg = json.loads(line)
    if msg["data"]:
        audio_chunks.append(base64.b64decode(msg["data"]))
    if msg["code"] == 20000000:
        chars = msg["usage"]["text_words"]   # 计费单位：字符数
        break

audio_bytes = b"".join(audio_chunks)   # 完整 MP3 文件
```

**输出：**
```python
TTSResult {
  audio:        b"\xff\xf3\x14\x00..."   # MP3 bytes
  audio_format: "mp3"
  sample_rate:  24000
  voice:        "zh_female_yingyujiaoxue_uranus_bigtts"
  chars:        12                       # 计费字符数
}
```

---

## 十、对话编排器（core/dialog/orchestrator.py）

串联四个适配器，产出 `TurnResult`，并负责落库。

```
single_turn(audio_in, audio_in_format, recent_history, ...)
   │
   ├─ 1. STT.invoke(audio_in) → STTResult
   │      if text == "": raise EmptyTranscriptionError
   │
   ├─ 2. LLM.invoke([system] + history + [user]) → LLMResponse
   │      max_tokens = 200
   │
   ├─ 3. TTS.invoke(text_ai) → TTSResult
   │      voice = settings.volc_tts_default_voice
   │
   ├─ 4. _maybe_persist_audio()
   │      if AUDIO_STORAGE_ENABLED:
   │          写 {turn_id}_in.ogg  → ./tmp/audio/{learner_id}/
   │          写 {turn_id}_out.mp3 → ./tmp/audio/{learner_id}/
   │
   ├─ 5. INSERT INTO turn (...)
   │      db.add(Turn(...))
   │      await db.commit()
   │
   └─ 返回 TurnResult {turn_id, text_user, text_ai, audio_out, ...}
```

---

## 十一、数据库落库（storage/models/turn.py）

**表名：** `turn`  
**触发时机：** 三个外部调用（STT/LLM/TTS）全部成功后，一次原子 INSERT

```sql
INSERT INTO turn (
  id,                    -- UUID v4，由 Python 生成
  learner_id,            -- FK → learner.id（CASCADE DELETE）
  text_user,             -- STT 识别文本
  text_ai,               -- LLM 回复文本
  audio_in_path,         -- ./tmp/audio/{learner_id}/{turn_id}_in.ogg
  audio_out_path,        -- ./tmp/audio/{learner_id}/{turn_id}_out.mp3
  stt_audio_seconds,     -- 音频时长（秒），来自 audio_info.duration / 1000
  llm_input_tokens,      -- LLM prompt token 数（来自 usage.prompt_tokens）
  llm_output_tokens,     -- LLM completion token 数（来自 usage.completion_tokens）
  tts_chars,             -- TTS 字符数（来自 usage.text_words）
  created_at,            -- DB server_default: now()
  updated_at             -- DB server_default: now()，onupdate: now()
)
```

**计费字段汇总：**

| 字段 | 来源 | 计费单位 |
|---|---|---|
| `stt_audio_seconds` | Volcengine STT `audio_info.duration` | 秒（精确到毫秒） |
| `llm_input_tokens` | Ark `usage.prompt_tokens` | Token |
| `llm_output_tokens` | Ark `usage.completion_tokens` | Token |
| `tts_chars` | TTS `usage.text_words` | 字符数 |

---

## 十二、完整数据流（数据格式视角）

```
[Browser]         [FastAPI]          [Volcengine STT]    [Volcengine LLM]    [Volcengine TTS]
    │                 │                      │                   │                   │
  webm/opus         webm/opus               │                   │                   │
  48kHz stereo  ──► ffmpeg ──► ogg/opus     │                   │                   │
                              16kHz mono ──►│                   │                   │
                                            │ "Hello, what's    │                   │
                                            │  your name?" ─────►                   │
                                            │                   │ "My name is Tina! │
                                            │                   │  What's yours?" ──►│
                                            │                   │                   │ mp3 chunks
                                            │                   │                   │ 24kHz mono
                                            │                   │                   │ ◄──────────
  data:audio/mpeg;base64,...                │                   │                   │
  ◄──────────────────────────────────────────────────────────────────────────────────
```

---

## 十三、关键配置参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `VOLC_ARK_MODEL` | `doubao-seed-2-0-mini-260215` | LLM 模型 ID |
| `VOLC_STT_RESOURCE_ID` | `volc.seedasr.sauc.duration` | STT 按时长计费资源 |
| `VOLC_STT_MODEL_NAME` | `bigmodel` | 豆包语音识别模型 |
| `VOLC_STT_SAMPLE_RATE` | `16000` | STT 输入采样率（Hz） |
| `VOLC_TTS_RESOURCE_ID` | `seed-tts-2.0` | TTS 资源 ID |
| `VOLC_TTS_DEFAULT_VOICE` | `zh_female_yingyujiaoxue_uranus_bigtts` | Tina 教师声音 |
| `VOLC_TTS_AUDIO_FORMAT` | `mp3` | TTS 输出格式 |
| `VOLC_TTS_SAMPLE_RATE` | `24000` | TTS 输出采样率（Hz） |
| `AUDIO_STORAGE_ENABLED` | `true` | 是否保存音频到本地 |
| `AUDIO_STORAGE_DIR` | `./tmp/audio` | 音频本地存储根目录 |

---

## 附：错误边界

| 阶段 | 错误 | 处理方式 |
|---|---|---|
| 麦克风权限拒绝 | `getUserMedia` 抛异常 | → `CHAT_MIC_DENIED`，显示提示 |
| 音频为空 | blob.size == 0 | → `CHAT_AUDIO_EMPTY`，不发请求 |
| ffmpeg 失败 | returncode != 0 | → HTTP 500 |
| STT 返回空文本 | text == "" | → HTTP 422 `EMPTY_TRANSCRIPTION` |
| STT WS 连接失败 | websockets 异常 | → HTTP 500（未分类） |
| LLM 调用失败 | openai 异常 | → HTTP 500（未分类） |
| TTS 返回错误码 | code != 0 / 20000000 | → `RuntimeError` → HTTP 500 |
| Learner 不属于当前账号 | DB 查询空 | → HTTP 404 `Learner not found` |
| Session 过期 | cookie 无效 | → proxy.ts 重定向 `/login?expired=1` |
