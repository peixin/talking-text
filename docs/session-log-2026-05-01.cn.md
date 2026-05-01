# 第四次 Session 记录 · 2026-05-01 · 文字输入模式 + 音频播放重构

> 入场状态：语音对话已跑通，只能录音输入，只能自动播放 AI 回复。
> 退场状态：文字/语音双模式输入，所有消息气泡（用户和 AI）均有播放按钮，后端"取或生成"统一端点，前端内存缓存，并发保护到位。

---

## 阶段一：最初的"补丁式"实现

### 需求

1. 增加文字输入模式（键盘切换）
2. 播放按钮始终显示，有音频就播放，没有就先 TTS 生成再播放
3. 文字输入的用户消息，也可点按钮生成 TTS 朗读

### 第一版做法（后被推翻）

在已有语音流程上打补丁：

- `orchestrator.single_turn()` 加 `text_user_override` 参数
- `session.py` 新增 `POST /sessions/{id}/turns/{turn_id}/tts` 独立端点生成 TTS
- 前端 `Message` 类型保留 `hasAudio: boolean`，`MessageListClient` 根据它决定播放时调 `getAudio` 还是 `generateTts`

**问题：** 逻辑散落三处，变量命名跟着先后顺序走而不是跟着语义走，`has_audio_in`/`has_audio_out` 字段意义含糊，`generateTts` 和 `getAudio` 两个 action 并存显得重复。

---

## 阶段二：推倒重来——自上而下设计

### 核心认知

> 一个 turn 的语义应该是：输入（文字或语音）+ 输出（文字 + 可选音频）。"有没有音频"不是前端需要关心的状态——前端始终有播放按钮，始终调同一个端点，后端决定返回文件还是现生成。

### 新设计

**`get_turn_audio` 变成"取或生成"统一端点：**

```
GET /sessions/{session_id}/turns/{turn_id}/audio?dir=in|out
```

- 有磁盘文件 → 直接返回（`FileResponse`）
- 没有文件 → 现场调 TTS，可选存盘 + 更新 turn 记录，返回音频字节

**`create_turn` 明确区分两种模式：**

| 模式 | 输入 | TTS | 返回 `audio_b64` |
|---|---|---|---|
| 语音模式 | `audio` 文件（multipart） | 立即生成 | 有值（用于自动播放） |
| 文字模式 | `text` 字段（form） | 跳过 | `null`（按需生成） |

**`orchestrator.single_turn()` 清晰参数语义：**

```python
async def single_turn(
    *,
    audio_in: bytes | None = None,    # 语音字节（OGG）
    text_user: str | None = None,     # 文字输入（二选一）
    generate_audio: bool = True,      # False = 文字模式，不跑 TTS
    ...
)
```

`TurnResult.audio_out` 类型从 `bytes` 改为 `bytes | None`，`audio_out_format` 同理。

### 消失的概念

| 消失的东西 | 被什么替代 |
|---|---|
| `TurnOut.has_audio_in / has_audio_out` | 不需要，前端不再关心 |
| `Message.hasAudio` | 不需要，播放按钮始终显示 |
| `POST /turns/{id}/tts` 独立端点 | 合并进 `GET /turns/{id}/audio` |
| `generateTts` Server Action | 不需要，`getAudio` 统一处理一切 |
| `handlePlay(turnId, dir, hasAudio)` 的第三个参数 | 不需要 |

### 前端行为变化

- **语音模式**：发送后拿到 `audio_b64` → 自动播放 AI 回复（体验不变）
- **文字模式**：发送后只展示文字，不自动播放；用户点播放按钮时才调后端按需生成
- **所有气泡**（用户和 AI）只要有 `turnId` 就显示播放按钮
- 用户语音气泡 → 播放原始录音（`dir=in`，有文件）
- 用户文字气泡 → TTS 朗读用户输入（`dir=in`，现生成）
- AI 气泡 → 播放 TTS 回复（`dir=out`，有文件或现生成）

---

## 阶段三：并发保护——两把 asyncio.Lock

### 问题

1. **TTS 生成竞态**：两个 tab 同时点播放同一条没有音频的消息，会并发触发两次 TTS API 调用，同时写同一个文件路径
2. **Turn 创建并发**：同一 session 并发发两条消息，LLM 读到的历史可能缺少对方那条（history 错乱），sequence 号也可能跳

### 解决方案

**`_scoped_lock(lock_dict, key)`** — 可复用的上下文管理器：

```python
@asynccontextmanager
async def _scoped_lock(lock_dict, key):
    if key not in lock_dict:
        lock_dict[key] = asyncio.Lock()
    lock = lock_dict[key]
    async with lock:
        yield
    # 释放后无 waiter 则清除条目，防内存无限增长
    if lock_dict.get(key) is lock and not lock.locked():
        lock_dict.pop(key, None)
```

- **`_tts_gen_locks`**：key = `"turn_id:dir"`，拿锁后 double-check DB，第二个 waiter 拿到锁时发现文件已在，直接返回
- **`_session_turn_locks`**：key = `session_id`，整个 orchestration 串行，保证 history 一致和 sequence 有序

**两个注意点：**
1. `asyncio.Lock` 是单进程内的。V1 单进程部署够用；多进程需换 Redis 分布式锁
2. `_scoped_lock` 的 prune 在释放后无 `await` 的间隙内执行，asyncio 单线程模型保证原子性

### 为什么 prune 是安全的

asyncio 单线程：`lock.release()` 返回后，在下一个 `await` 之前没有其他协程运行。即使有 waiter 被唤醒（`fut.set_result(True)` 在 release 内部调用），它也在下一个事件循环 tick 才真正运行——此时 dict entry 已被删，但 waiter 持有 `lock` 对象的直接引用，不受 dict 删除影响，仍能正常 acquire。

---

## 阶段四：前端音频内存缓存

### 问题

同一会话内，用户可能反复点播放同一条消息，每次都要往后端发请求。

### 方案

`MessageListClient` 里加一个 `useRef<Map<string, string>>`：

```ts
const audioCacheRef = useRef<Map<string, string>>(new Map());
```

- key = `"turnId:dir"`，value = data URL string
- 命中缓存 → 直接播放，不发请求
- 未命中 → 请求后写入缓存

**为什么用 `useRef` 而不是 `useState`：**
缓存命中不需要触发重渲染，`useRef` 更新不引发 re-render，也不会导致旧的 Map 被 GC。

**生命周期：** 页面刷新后清空。对本场景完全够用——音频内容由 `(turn_id, dir)` 唯一确定（文字不变则 TTS 结果等价），下次请求结果一样，重新生成无副作用。

---

## 阶段五：Play icon 闪烁 Bug 修复

### 现象

点任意一个播放按钮，所有气泡的 Play icon 都会 `opacity-40` 闪一下。

### 原因

`PlayButton` 的 `disabled` prop 是 `isLoading || !!loading`——后者在任何一个按钮 loading 时把**所有**按钮变成 disabled，触发 Tailwind 的 `disabled:opacity-40`。

### 修复

```tsx
// before
disabled={isLoading || !!loading}

// after
disabled={isLoading}
```

`handlePlay` 函数内已有 `if (loading) return` 防重入，UI 层不需要再 disabled 其他按钮。一行改完。

---

## 阶段六：HTTP 客户端选型讨论

### 问题

用户习惯前端用 axios、后端用 requests，询问是否有必要切换。

### 结论

**前端：保持 `fetch`。**
`lib/backend.ts` 的薄封装已经足够；axios 在 Next.js server-only 层没有实质收益，反而多一个依赖。2026 年 `fetch` 是 Node.js 原生支持，也是 Next.js 扩展（缓存/重验证）的基础，不需要替换。

**后端：已经是最优解，不需要改。**

| 层 | 现状 | 结论 |
|---|---|---|
| 后端 HTTP（TTS） | `httpx.AsyncClient` | 最优，async-first，API 对标 requests |
| 后端 WebSocket（STT） | `websockets` | 没有问题 |
| 后端 LLM | OpenAI SDK（内部用 httpx） | 没有问题 |
| 前端 HTTP | `fetch` + 自定义 wrapper | 保持，不引入 axios |

`requests`（同步库）在 `async def` FastAPI 路由里会阻塞整个 event loop，禁止使用。

---

## 最终文件变更汇总

### 后端

| 文件 | 变更 |
|---|---|
| `core/dialog/orchestrator.py` | 参数 `text_user_override` → `text_user`；加 `generate_audio: bool`；`TurnResult.audio_out` 可为 `None`；`_persist_audio_files` 支持 `audio_out=None` |
| `api/session.py` | `TurnOut` 去掉 `has_audio_*`；`TurnResponse.audio_b64/format` 可为 `None`；`get_turn_audio` 改为"取或生成"；删除 `generate_turn_tts` 端点；加 `_scoped_lock` + 两个 lock dict |

### 前端

| 文件 | 变更 |
|---|---|
| `lib/backend.ts` | `TurnResponse.audio_b64/format` 改为可 `null`；`TurnOut` 去掉 `has_audio_*`；删除 `generateTurnTts` |
| `lib/api.ts` | 删除 `generateTurnTts` |
| `actions.ts` | `Message` 去掉 `hasAudio`；`SendTurnResult.audio_b64/format` 可 `null`；删除 `generateTts`；`sendTurn` 同时支持文字和语音 |
| `ChatClient.tsx` | 加 `inputMode`（voice/text）状态；文字输入区 UI；语音模式发送后自动播放；文字模式不自动播放 |
| `MessageListClient.tsx` | 播放按钮对所有消息始终显示；`handlePlay` 无条件调 `getAudio`；加内存缓存 `audioCacheRef`；修复 icon 闪烁（`disabled` 只设给加载中的那个按钮） |

---

## 值得在新 Session 开头重新念一遍

承接前三份 session log，新增：

- **`get_turn_audio` 是"取或生成"统一端点**。前端始终调这一个，不需要区分"有没有音频"。播放按钮始终显示。
- **语音模式自动播放，文字模式不自动播放**。区别在 `generate_audio` 参数和 `audio_b64` 是否为 null。
- **asyncio.Lock 要做 scoped prune**，否则 dict 随 turn 数量无限增长。单进程内有效，多进程需换 Redis 分布式锁。
- **`requests`（同步）禁止在 async FastAPI 里用**。后端 HTTP 一律 `httpx.AsyncClient`。
- **前端音频缓存用 `useRef<Map>`，不用 `useState`**——不需要触发 re-render。

---

*下一 Session 大概率做：Scope Computer V1 stub + Prompt assembler（把 Tina 人设和词汇范围接进系统提示），以及教材录入 MVP。*
