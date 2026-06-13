# 前端 UI 规范

> 最后更新：2026-06-12 · 英文版：[`frontend-ui.md`](frontend-ui.md)
>
> `frontend/` 的组件与样式契约。CLAUDE.md 里是短规则，本文是完整参考。两边不一致时，两边都要修。

---

## 1. Design Token

所有颜色定义在 `frontend/app/globals.css`（`@theme` + `:root`）。组件**只用语义 token**——禁止 Tailwind 原始色板类（`bg-indigo-600`、`text-slate-500` 等）。深浅一律用透明度修饰，不用色板号。

| Token | 色相 | 含义 | 典型用法 |
|---|---|---|---|
| `primary` | indigo | 品牌 / 可交互 | `bg-primary`、`text-primary`，浅底 `bg-primary/5..10`，边框 `border-primary/20..30` |
| `foreground` / `background` | 中性 | 默认文字 / 页面 | 正文、页面底色 |
| `muted` / `muted-foreground` | 中性 | 弱化面 / 弱化文字 | 区块底 `bg-muted`、次要文字 |
| `border` / `input` | 中性 | 细线 | `border-border`（默认）、`border-input`（稍深） |
| `card` / `card-foreground` | 中性 | 浮起的面 | 面板、弹层 |
| `destructive` | 红 | 错误、删除、停止录音 | `text-destructive`、`bg-destructive/10` |
| `success` | 翠绿 | 正向状态、已订阅 | `text-success`、`bg-success/10` |
| `warning` | 琥珀 | 注意、待处理、踮脚 | `text-warning`、`bg-warning/10..15` |
| `ring` | indigo | 焦点环 | base layer 自动应用 |

**业务色语义**（全站保持稳定）：

- **踮脚词** = `warning` · **课本词** = `muted` · **课外词** = `primary`
  （唯一定义处：`app/[locale]/(app)/parent/page.tsx` 的 `TAG_STYLES` / `TAG_DOT_STYLES`）
- 订阅/共享内容 = `success` · 采集/收件箱待处理 = `warning`

新增业务语义色 = 在 `globals.css` 加 CSS 变量（`:root` + `.dark` + `@theme inline`），不许内联色板类。

**已知缺口（接受）：** `success` 和 `warning` 没有 `*-foreground` 配套——实心底上用 `text-white`。图片遮罩用 `bg-black/NN` + `text-white`（不算色板类，shadcn 对话框遮罩同款）。

## 2. 样式规则

- **禁止 `dark:` 变体。** V1 只发浅色。`.dark` token 块存在但没有开关；`components/ui/` 之外不许写 `dark:`。
- **圆角层级：** 外层容器 `rounded-xl`（Panel）、内部元素 `rounded-lg`、chip `rounded-full` / Badge 默认、微型标记 `rounded-sm`。
- **字号层级：** 正文 `text-sm`、次要 `text-xs`、微型标签 `text-[10px]`/`text-[11px]`（chip、图例）。
- **Spinner 惯用法：** `<Loader2 className="h-4 w-4 animate-spin" />`（lucide-react）。不要手拼 border 圆圈；尺寸可变，写法不变。
- 已是全强度 token 的元素做 hover：用透明度降一档（`hover:text-primary/80`），不要去找更深的色板号。

## 3. 组件来源

**库优先，手写垫底。**

1. 任何标准 UI 模式（按钮、对话框、popover、select、tabs、tooltip、badge、switch、toast……）来自 shadcn/ui。缺了就 `pnpm dlx shadcn@latest add <name>`——绝不手写平行版本。
2. 改外观 = 在库组件上用 token/className。可以在 `components/ui/*` 里加 variant（仅样式编辑）；结构逻辑不动。
3. 手写组件只留给库里没有对应物的产品特有 UI（录音键、聊天气泡、标签树行），用 token + 既有 primitive 搭建。
4. **提取规则：** 第二个页面一旦需要同样的手写模式，立刻提取到 `components/`——禁止复制粘贴分叉。

## 4. 组件清单

### shadcn（`components/ui/`——托管，只做样式编辑）

| 组件 | 用途 | 备注 |
|---|---|---|
| `button` | 一切"长得像按钮"的；链接按钮用 `buttonVariants()` | 裸 `<button>` 只给其他视觉物种（chip、树行、录音键） |
| `badge` | 小型非交互状态/标签 chip | variant：default/secondary/destructive/outline/**success**/**warning**/ghost/link |
| `alert` | 静态消息提示框（错误/成功/警告/信息） | variant：default/destructive/**success**/**warning**/**info**；图标 = 第一个 svg 子元素 |
| `card` | 真正有 标题/描述/页脚 结构的卡片 | 自带 slot padding + gap；别硬套在普通盒子上（那是 Panel 的活） |
| `dialog`、`popover`、`collapsible`、`separator` | 如其名 | |
| `input`、`textarea`、`label`、`checkbox`、`radio-group` | 表单 | |

### 自有共享组件（`components/`）

| 组件 | 用途 | 备注 |
|---|---|---|
| `Panel` | 普通带边框盒子（`border-border bg-card rounded-xl border p-4`） | 即插即用的 styled div；差异通过 `className` 传（twMerge 合并） |
| `EmptyState` | "暂无内容"占位 | 虚线框 + 居中弱化文案 + 可选 `action`；不用于拖放区/交互引导 |
| `TagPathHeader` | 教材面包屑头部 | |
| `LocaleSwitcher` | 语言切换 | |

### 速查

- 长得像按钮 → `Button` / `buttonVariants`
- 小状态标签 → `Badge`
- 带语义色的消息框 → `Alert`
- 普通带边框容器 → `Panel`
- 空占位 → `EmptyState`
- 标题 + 内容（+ 页脚）卡片 → `Card`
- 加载中 → `Loader2` 惯用法

## 5. 国际化

- 所有用户可见文案放 `i18n/messages/{en,zh-CN,zh-TW}.json`——**tsx 里零硬编码文案**，包括标签映射表和 aria-label。
- 命名空间对应页面（`Parent`、`Materials`、`Chat`、`Ingest`……）；key 用 `snake_case`；动态文案用 ICU 占位符（`"{count} 本教材"`）。
- 三份语言文件 key 必须完全一致——加 key 就是三份一起加。
- 代码里不许 `defaultValue:` 兜底——语言文件是唯一事实源。
- 跳转一律用 `@/i18n/routing` 的助手（`Link`、`redirect` 等）。
- 代码注释用英文（项目语言政策）；中文只出现在 `zh-*` 语言文件和 `*.cn.md` 文档里。
