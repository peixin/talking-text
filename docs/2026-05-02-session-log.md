# 第五次 Session 记录 · 2026-05-02 · 移动端交互与水合修复 + 极速响应 SSE 架构升级

> **入场状态**：iOS Safari 下交互迟钝，录音按钮等元素点击无响应，控制台有大量 React 水合（Hydration）错误，移动端调试困难；同时说完话到看到回复整体延迟较长（~10s），体验不佳。
> **退场状态**：iOS 交互恢复丝滑，水合错误清零，完成移动端视口与输入框防缩放优化；建立 `[perf]` Timing 日志，将大语言模型切换为 DeepSeek 并精简 CoT，完成全链路 SSE 流式管道升级（首字延迟 TTFT 压低至 ~1.1s），实现高保真少儿口语伴学实时性。

---

## 第一部分：移动端诊断、视口与水合 (Hydration) 冲突解决 (上午场)

### 1. 核心痛点与视口优化

1. **点击响应慢**：iOS Safari 默认对非交互元素有 300ms 点击延迟（用于判断双击缩放）。
2. **自动缩放干扰**：输入框聚焦时页面自动放大，破坏移动端端庄的布局。
3. **水合失败**：由于浏览器插件或移动端特有行为（如电话号码、地址自动识别）导致服务端与客户端渲染的 HTML 不一致，触发 React 降级渲染，甚至导致整个事件委托机制失效（表现为"按钮怎么点都没反应"）。

**解决方案**：
在 `frontend/app/[locale]/layout.tsx` 中锁定视口参数，防止意外缩放，并关闭浏览器的格式自动识别，减少 DOM 被浏览器篡改的机会：

```tsx
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};
```

在 `generateMetadata` 中配置 `formatDetection`：
```typescript
formatDetection: {
  telephone: false,
  date: false,
  address: false,
  email: false,
}
```

### 2. 解决 React 水合 (Hydration) 冲突

React 水合错误是移动端交互失效的隐形杀手，水合失败会导致事件委托机制失效。

1. **强制客户端渲染边界**：在 `ChatClient` 等组件中添加了完备的挂载检查（通过 `mounted` state + `useEffect` 挂载标记），确保某些仅客户端运行的逻辑（如音频 API 初始化、窗口高度检测）不会在服务端渲染，从而与 SSR HTML 彻底脱钩。
2. **清理 DOM 嵌套噪点**：确保 `NextIntlClientProvider` 内部没有产生多余的 div 嵌套，使 DOM 结构保持干净，服务端与客户端的树状拓扑完美重合。

### 3. CSS 移动端交互深度优化

在 `globals.css` 中添加全局规则：
- **`touch-action: manipulation`**：全局禁用双击缩放，消除 300ms 点击延迟，交互反馈瞬间即达。
- **`overscroll-none` & `overflow-hidden`**：在 `body` 层禁用"橡皮筋"回弹效果，避免页面过度拖拽，让 Web 应用交互感受更像原生 App。
- **防止输入框缩放**：iOS 2026 规定字体小于 `16px` 时会自动放大页面。将其限制为安全阈值：
  ```css
  input, textarea, select {
    font-size: max(16px, 1em);
  }
  ```

### 4. 移动端局域网开发与真机调试

为了方便在手机上通过局域网 IP（如 `192.168.x.x:3010`）直接访问开发服务器并享受热重载：
- **`next.config.ts`**：在 `allowedDevOrigins` 中加入手机局域网 IP 作为合法来源，解决了 HMR（热更新）连接被 WebSocket 沙箱拦截的问题。

---

## 第二部分：语音与流式对话性能诊断与 SSE 架构升级 (下午场)

### 1. 性能诊断与计时机制

为定位完备的延迟痛点，在关键节点加上了 `[perf]` 计时日志：
- **后端**：`orchestrator.py` 分阶段计时（STT / LLM / TTS / DB persist）；`session.py` 计时音频转码和 `create_turn` 总耗时。
- **前端**：`console.log` 记录 `sendTurn` 整个 round-trip。
- **开关控制**：由 `config.toml [debug] perf_logging = true` 控制，确保生产环境下可随开随关，不含 PII 数据。同时调整 Python logging 使 `app.*` 的 `INFO` 日志在 uvicorn 中清晰可见。

**性能评测结果**：

| 阶段 | Volcengine (Ark 豆包) | DeepSeek-V4 (Flash) |
|------|----------------------|--------------------|
| transcode | ~0.1s | ~0.55s |
| STT | ~1.2s | ~1.3s |
| **LLM** | **~8.2s** (极长白屏等待) | **~1.1s** (极速推理) |
| TTS | ~0.5s | ~1.2s |
| **语音合计** | **~10s** (极长首字延迟) | **~4.0s** (体验极佳) |

**诊断结论**：LLM 响应是第一瓶颈，占整体延迟的 80%。STT 和 TTS 的耗时处于正常响应区间。

### 2. 切换 LLM 提供商：DeepSeek 调优

为了保证大模型适配的灵活度，我们在配置策略中重构了 `per-provider` 配置子节，只需通过一行配置修改即可无缝切换 LLM 引擎：

```toml
[adapter]
llm_provider = "deepseek"   # 一键切换引擎

[adapter.llm.deepseek]
model = "deepseek-v4-flash"
thinking = "disabled"       # 在日常口语简单对话中禁用 CoT，极大削减首字延迟

[adapter.llm.volc_ark]
model = "doubao-seed-2-0-mini-260215"
```

**DeepSeekLLMAdapter 适配器实现**：
- 采用符合 OpenAI-compatible 接口的规范。
- 通过在 `extra_body` 中显式传递 `thinking = "disabled"` 屏蔽思维链，减少 CoT 的额外消耗。
- 引入 `stream()` 异步生成器方法，为 SSE 流式输出奠定下层协议支撑。

### 3. 全链路 SSE 流式对话管道

#### 3.1 后端：SSE 事件流时序设计
`DialogOrchestrator.stream_turn()` 按严格的事件依赖关系向前端 yield 事件：

```
1. text_user      (STT 转写完成，或文字模式下的 input 立即回显)
2. text_ai_delta  (LLM token 生成增量，重复 yield)
3. text_ai_done   (LLM 完整文本生成完毕，Turn 记录已顺利写入 DB 存盘)
4. audio_ready    (TTS 音频生成完成，提供 audio_b64)
5. done           (流式处理结束，附带更新后的 session_title)
6. error          (异常抛出，返回错误 code，如空转写等)
```

**关键设计**：**必须在 Turn 记录完美写入 DB 落库后，才发送 `text_ai_done`。** 这样能够保证当前端接收到 `turn_id` 时，点击播放绝不会因为后端尚未落库而抛出 404。

FastAPI 新增了流式处理专用端点 `POST /sessions/{id}/turns/stream`，在 per-session 锁的并发保护下消费 SSE 生成器。

#### 3.2 前端：统一流式控制架构
- **Route Handler 代理** (`app/api/chat/[sessionId]/stream/route.ts`)：解决本地 HMR 开发环境下的跨域 Cookie 限制。前端读取 Next-Auth Session 并在 Node 代理层向 FastAPI 发起 upstream 携带凭证请求（生产环境由 Nginx 做反向代理直接直连）。
- **统一 `<audio>` 播放器控制**：将之前散落在 `ChatClient` 和 `MessageListClient` 的多重 `<audio>` 统一合并到 `ChatClient` 中由全局状态控制，彻底解决了重叠音频同时播放引起的混乱问题。
- **状态感知骨架屏**：
  - `streaming: true`：AI 气泡在流式输入时展示打字机动画与闪烁光标。
  - `pending: true`：用户语音消息上传时显示「识别中…」的优雅转圈态。

#### 3.3 最终流式体验时序效果

| 模式 | 用户操作 | 交互反应与界面渲染 |
|------|------|---------|
| **语音模式** | 停止录音 | 立即弹出用户气泡并呈现「识别中…」转圈状态。 |
| **语音模式** | +1.3s | 转写成功，语音文本瞬间替换「识别中…」。 |
| **语音模式** | +1.3~2.4s | AI 伴学助手逐 token 流式打字输出，白屏时间完全清零。 |
| **语音模式** | +2.5s | 闪烁光标消失，回复气泡下方的播放按钮激活。 |
| **语音模式** | +3.7s | 音频预加载并自动触发朗读（TTS），伴学体验一气呵成。 |
| **文字模式** | 点击发送 | 消息气泡立即上屏，AI 立即开始增量渲染流式回复。 |
| **文字模式** | +1.1s | AI 流式回复展示完成，播放按钮亮起，供随时手动点按朗读。 |

---

## 第三部分：最终文件变更汇总

### 后端变更

| 组件/文件 | 变更内容 |
|---|---|
| `core/dialog/orchestrator.py` | 1. 拆分 text/audio 输入参数，增强多模式支持；<br>2. 新增 `stream_turn` 异步生成器，输出完备的 SSE 事件流；<br>3. `TurnResult.audio_out` 允许为 `None`，支持文字模式下的懒加载生成。 |
| `api/session.py` | 1. `TurnOut` 彻底移除冗余的 `has_audio_*` 标志，前端对音频一律做“取或生成”的透明式处理；<br>2. 新增统一的 `get_turn_audio` 接口，支持按需动态生成 TTS；<br>3. 引入多进程级及 scoped 锁机制防御 TTS 及 Turn 创建的并发并发竞争；<br>4. 新增 SSE 路由 `POST /sessions/{id}/turns/stream`。 |

### 前端变更

| 组件/文件 | 变更内容 |
|---|---|
| `app/api/chat/[sessionId]/stream/route.ts` | **[新增]** 服务端 Route Handler，代理流式转发，免除开发阶段的 CORS 与 Cookie 沙箱冲突。 |
| `lib/backend.ts` & `actions.ts` | 1. 接口全面适配 `null` 值的 `audio_b64` 语义；<br>2. 废除所有 `generateTts` 等散落的 server actions，将接口请求逻辑统一归拢。 |
| `ChatClient.tsx` | 1. 新增 inputMode（文字/语音）的交互切换面板；<br>2. 重新编排 `submitTurn()`，完全基于原生 SSE 协议和 EventSource 逐 token 读取并更新状态；<br>3. 统一全局音频播放器 `<audio>` 钩子。 |
| `MessageListClient.tsx` | 1. 重构播放控制，默认对所有消息展示播放按钮；<br>2. 引入 `audioCacheRef`（使用 `useRef<Map>` 避免无效 re-render）建立内存级音频缓存；<br>3. 修复点击时其他播放按钮全局闪烁的 Bug。 |

---

## 值得在后续 Session 开头重温的原则

1. **“取或生成”透明处理原则**：前端决不探知“后端有没有音频”，播放按钮始终渲染，始终只请求 `GET /turns/{id}/audio`，后端实现按需缓存与生成，彻底消除冗余状态。
2. **水合错误优先处理**：水合失败会导致事件绑定和虚拟 DOM 映射断裂，是点击无效的首要原因。切忌在 SSR 期间运行依赖浏览器特性的方法。
3. **防止输入框缩放阈值**：iOS 端 input 字体绝对不要低于 `16px`。
4. **流式数据库存盘优先**：在 yield `text_ai_done` 之前必须保证 turn 已写入数据库存盘，避免前端拿着 `turn_id` 请求音频或更新时发生 404 冲突。
