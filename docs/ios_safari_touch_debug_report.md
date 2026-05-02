# iOS Safari 触摸失效与 Next.js 水合故障排查报告

## 1. 问题现象
用户在 iOS Safari 和 iOS Chrome 浏览器中访问 `/chat` 页面时，发现以下严重交互问题：
- 点击页面底部的录音按钮、输入切换按钮、以及每条消息旁边的播放按钮，均**没有任何反应**。
- 页面中间和底部的区域似乎处于“死机”状态，无法触发任何 React 事件。
- 电脑端浏览器（哪怕是 Chrome 移动端模拟器）一切正常，控制台无报错。
- 点击时甚至会触发 Safari 的双击放大（Double-Tap to Zoom）机制，但 React 的 `onClick` 就是不生效。

## 2. 诊断与排查过程

### 阶段一：CSS 布局与事件拦截排查 (The "Dead Zone" Hypothesis)
起初，我们怀疑是 CSS 绝对定位或 `fixed` 导致图层重叠，或是 iOS 的橡皮筋回弹效果（Rubber-banding）吃掉了触摸事件。
- **操作**：去除了所有复杂的绝对定位，采用最原始的 `flex` 布局，并添加全局的 `touch-action: manipulation` 彻底禁用了 Safari 的双击放大机制。
- **结果**：双击放大被成功禁止，但是按钮依然无法点击。这说明问题**不在 CSS 布局层**。

### 阶段二：探针注入与底层原生事件检测
为了验证到底是手机硬件/浏览器层没收到事件，还是 React 内部的事件委托引擎出了问题，我们注入了两套探针：
1. **原生探针**：在 HTML `<head>` 最顶部强行注入了一段无框架依赖的纯 JS 代码，监听最底层的 `touchstart` 事件，并弹出红色横幅。
2. **React 探针**：在组件内部绑定原生的 `window.addEventListener` 并通过 `useState` 更新黑/黄色横幅，检测 React 状态循环。
- **结果**：
  - 红色横幅成功弹出了 `Native Tap: BUTTON.mb-1`，直接证明了**iOS底层触摸工作完美，事件已经准确派发给了对应的 HTML 节点**。
  - 黄色的 React 横幅却显示了 **`HYDRATED: NO`**！这说明整个 React 引擎在这台设备上**经历了“水合崩溃（Hydration Mismatch）”并且直接死机了**，导致页面变成了没有交互能力的“干尸 HTML”。

### 阶段三：定位 Hydration Mismatch 的元凶
在 Next.js 的 App Router 架构中，如果服务端渲染的 HTML 和客户端第一次执行 JS 生成的结构存在细微差异，水合就会失败。对于 iOS Safari，最常见的元凶有三个：
1. **时间组件不一致**：`SessionSidebarClient.tsx` 中使用了 `dayjs().fromNow()`。由于服务器时间和客户端时间的细微毫秒差，文字发生了微小改变（Text Node Mismatch），这是导致报错的核心代码隐患。
2. **Safari 自作聪明注入标签**：iOS Safari 会自动扫描网页上的数字格式，并强行将其转变为拨号链接 `<a href="tel:...">`，从而破坏原有的 DOM 树，引发 React 水合惨死。
- **解决方案**：
  - 给 `dayjs` 时间渲染加上了 `mounted` 状态，强制其只在客户端执行。
  - 在 `layout.tsx` 的 metadata 中加入了 `formatDetection: { telephone: false, date: false, address: false, email: false }`，禁止 Safari 的自动注入。

### 阶段四：幽灵缓存与 HMR 跨域阻断 (The Final Boss)
即使修复了水合问题，手机依然无法点击按钮，且 Next.js 终端输出了极具迷惑性的错误：
> `Failed to find Server Action. This request might be from an older or newer deployment.`
> `Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr from "192.168.31.131"`

- **原因**：Next.js 本地开发服务器出于安全防御，**默认拦截了来自局域网设备（手机）的代码热更新（HMR）WebSocket 连接**。这导致：
  1. 我们在电脑上修好了代码，但手机 Safari 根本没有收到最新的 JS 包。
  2. 手机 Safari 继续使用旧的 JS 包发送点击请求，而电脑后端已经重启刷新了 `Server Action ID`，旧包带着过期的暗号去请求后端，直接触发 HTTP 500 报错。
  3. 并且因为同样的跨域安全限制，Next.js 的红色报错弹窗（Error Overlay）也无法在手机屏幕上显示，导致问题呈现出“悄无声息地死机”的灵异现象。

## 3. 最终修复方案总结

1. **解决 HMR 同步与 Server Action 同步问题**：
   在 `next.config.ts` 中配置 `allowedDevOrigins: ['192.168.31.131']`，允许局域网手机实时获取代码更新和报错弹窗。
2. **解决 Hydration Mismatch**：
   重构带有客户端特有副作用（如相对时间）的组件，采用 `useEffect` + `mounted` flag 的标准客户端渲染模式。
3. **防御 iOS 浏览器注入干扰**：
   配置完整的 `formatDetection` 并添加全局禁止双击放大的 CSS 约束 `touch-action: manipulation`。

**教训**：在移动端调试 Next.js 15+ 时，不要过于相信设备上“能看到页面”就代表“代码已更新”，HMR 阻断和 Server Action 缓存是局域网联调的最大坑点。
