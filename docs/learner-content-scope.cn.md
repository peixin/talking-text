# 多 Learner 内容范围与分享机制 · Multi-Learner Content Scope & Sharing

> **实现状态：** 分享机制（§6 UC-5/6/7、§8.4）已于 2026-06-11 上线——见 `2026-06-11-dev-log.md` §4。
> 设计文档 —— 于 2026-05-27 收敛定稿，整合了对 [`content-model.md`](content-model.md) 部分章节的修订。
> 本文档**取代** `content-model.md` §5（分享与克隆动力学）并**修订**其 §2 第 6 条原则。
> 英文正本：[`learner-content-scope.md`](learner-content-scope.md)。

---

## 一、目的与读者

本文档规定了 `item_group`（教材、收藏夹等）如何与同一账户内多个 learner 建立关系，以及如何跨账户分享。

读者是负责端到端实现此功能（数据库迁移 + 后端 API + 前端串联）的工程师。文中所有边界决策都已经在 §七 给出明确选择，全文按"实现简报"顺序排列，从头到尾读完即可上手。

它要回答：

- 一份教材，对哪个 learner 可见？哪个 learner 能编辑？
- 家长给某个 learner 创建教材，和孩子 learner 自己创建，机制有何区别？
- 分享教材时，接收方可能想要"独立副本"也可能想要"实时订阅"，如何处理？
- 孩子 learner 能改什么、不能改什么？账户主（家长）的特权是什么？

它**不**涉及：第三方适配层、Scope Computer、掌握度追踪、语音 pipeline、教材识别 AI 流程——这些由其他文档管辖。

---

## 二、核心主旨（Guiding Principles）

### 2.1 把"归属"、"可见性"、"使用范围"三件事拆开

| 关注点 | 实现机制 | 含义 |
|---|---|---|
| **归属**（计费、硬删除权）| `item_group.owner_account_id`（已存在）| "这本教材是这个家庭账户的" |
| **使用范围**（哪个 learner 能用）| `item_group_learner`（新增 join 表）| "这个 learner 被分配到这本教材" |
| **创建出处**（署名、默认行为）| `item_group.created_by_learner_id`（新增列）| "这本最初是为这个 learner 创建的" |

三者相互独立。账户 A 持有的一本教材，可以同时分配给 learner A1 和 A2，并标记"最初为 A1 创建"。

### 2.2 同账户内只有一份真相，绝不 clone

同一账户内，**同一份教材就是一行**。多 learner 通过 join 表实现，不通过复制实现。对教材的编辑会同步影响所有被分配的 learner。这符合一个家庭对待学校课本的方式：一本实体书放在桌上，谁要学谁就拿过来用。

### 2.3 跨账户分享提供两种语义，由接收方在接收时选择

当用户打开来自其他账户的分享链接时，**由接收方在接收的那一刻选择**：

- **Clone（克隆）** —— 把对方的 group 子树深拷贝一份到自己账户。从此独立。原作者后续的修改**不会**传播过来。
- **Reference / Subscription（订阅原版）** —— 不做任何拷贝。接收方订阅原 group；原作者的修改对接收方实时可见。接收方**无法以任何方式编辑**被订阅的 group —— 所有编辑入口都隐藏不显示；如需修改，必须先把订阅 "Fork" 成独立副本。

分享链接本身**不**编码模式。同一个链接可以被甲以 clone 方式接收、被乙以订阅方式接收。

### 2.4 默认可编辑，家长留兜底权

很多家庭的父母没空管理 App。孩子必须能：

- 给教材拍照
- 确认或修正 AI 提取的内容
- 把教材加入每日训练

编辑权限就是为这种自驱场景设计的。家长保留硬删除权、审计可见（`last_edited_by_learner_id`）和可选的 `locked` 锁。

### 2.5 Learner 改"眼睛看得见的事实"；AI/家长管"标签和编排"

孩子可以纠正能对着实体书核对的任何东西——文本、单元名、页码、漏掉/多出的词。但孩子不能改语义标签（`cefr_level`、`pos`、`type`）和 LLM 编排参数（`prompt_notes`）。这些字段由 AI 提取（自动化），必要时由账户主（家长）人工修正。设计理由：大多数家长本身也没有语言学专业能力来判定这些值；系统（AI）是权威来源。`type` 尤其在插入后不可变。

### 2.6 Learner 只能软删除

硬删除只属于账户主。Learner 任何"删除"动作只是软归档（`archived = true`），账户主可恢复。

### 2.7 全局规范教材（Canonical）延后到 V2

V2 的愿景是"同一本教材在全网只有一行，而不是每家一份"。这需要：不可变版本化的 canonical group + 基于内容寻址的 overlay 路径，才能在结构变动时保持锚定。**V1 不做。** V1 保持 `owner_account_id NOT NULL`，跨账户共享用 Reference（§2.3）作为轻量替代。

---

## 三、术语表

| 术语 | 定义 |
|---|---|
| **Account（账户）** | 登录 + 计费实体，一个家庭一个。表：`account` |
| **Learner（学习者）** | 账户内的学习档案，一账户多个。无独立登录，App 内通过 picker 切换。表：`learner` |
| **Active learner（当前 learner）**| 当前会话所代表的那个 learner。存于 `account.last_active_learner_id` |
| **Group（群组）** | 内容组织树的节点。书、单元、课时、个人收藏夹，都是 `item_group` 行 |
| **Root group（根群组）** | `parent_id IS NULL` 的 `item_group`。通常是 `kind = textbook_book` 或顶层 `personal_collection`。教材库列表只展示根群组 |
| **Owned group（自有群组）** | `owner_account_id = 我的账户` 的 `item_group` |
| **Subscribed group（订阅群组）** | 属于其他账户的 group，通过 `item_group_subscription` 暴露给我 |
| **Assignment（分配）** | `item_group_learner` 的一行。始终在根群组级别 |
| **Adoption（接收）** | 通过 clone 或 reference 把分享群组接收到自己库里的动作 |

---

## 四、数据模型

除非特别注明，本节是对 `content-model.md` schema 的**增量**。

### 4.1 修改 `item_group`

新增 4 列：

```
item_group（已有表 —— 仅增列）
  + created_by_learner_id      UUID NULL  外键 → learner.id      ON DELETE SET NULL
  + last_edited_by_learner_id  UUID NULL  外键 → learner.id      ON DELETE SET NULL
  + locked              BOOLEAN    NOT NULL  DEFAULT false
  + cloned_from_group_id       UUID NULL  外键 → item_group.id   ON DELETE SET NULL
```

注意：`cover_image_url` **V1 不增加**，装饰性元数据推迟到 V2。

语义：

- `created_by_learner_id` —— 创建此 group 时的 active learner。用于家长侧署名（"由 小红 创建"）和某些 UI 流程的默认值。插入后不可变。
- `last_edited_by_learner_id` —— 最近一次对此 group 做用户级修改（改名、增删成员、移树、归档切换）的 active learner。**只**由用户主动操作触发；AI/后台流程不改这个字段。
- `locked` —— 为 `true` 时，只有账户主可以修改**此节点及其所有后代**。适用于任意层级（书、单元、课次、收藏夹）——而不仅限于根节点。锁一个单元只冻结该单元；锁整本书则冻结整棵子树。默认 `false`。UI 在家长管理界面的每一层级卡片上都展示锁定开关。
- `cloned_from_group_id` —— 此 group 是通过 Clone 模式接收而来的（§7.2），指向原 group。从零创建的 group 为 NULL。

已有的 `owner_account_id` 保持 `NOT NULL`。canonical 教材（owner 可空）的概念延后到 V2。

### 4.2 新表 `item_group_learner`

账户内根群组到 learner 的多对多分配。

```
item_group_learner（新表）
  group_id    UUID NOT NULL  外键 → item_group.id  ON DELETE CASCADE
  learner_id  UUID NOT NULL  外键 → learner.id     ON DELETE CASCADE
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
  主键 (group_id, learner_id)
```

索引：`(learner_id)`，用于"我的分配列表"反向查询。

约束（在应用层强制，跨表无法在 schema 层表达）：

1. 仅根群组（`item_group.parent_id IS NULL`）可被分配。否则拒绝插入。
2. 对**自有群组**（`owner_account_id IS NOT NULL`）：`learner.account_id` 必须等于 `item_group.owner_account_id`。Learner 不能被分配到其所在账户不拥有的内容。
3. 对**订阅群组**（调用账户在 `item_group_subscription` 中有匹配行）：`learner.account_id` 必须等于订阅账户。订阅在账户层级，分配在 learner 层级。

效果：分配意味着该 learner 能在自己的教材库看到该 group 及其**整棵子树**（单元/课时），并可以从其中任意叶子开始练习。子群组通过 `parent_id` 递归遍历到达——**不存在**子树的分配行。

### 4.3 沿用 `group_share_link`

`content-model.md` §3.3 已定义。**不需要**加 `share_mode` 列。模式由接收方在接收时选，不在链接里编码。

若该表尚未实施，按 `content-model.md` §3.3 建表。

### 4.4 新表 `item_group_subscription`

跨账户引用。不复制任何内容。

```
item_group_subscription（新表）
  subscriber_account_id  UUID NOT NULL  外键 → account.id     ON DELETE CASCADE
  source_group_id        UUID NULL      外键 → item_group.id  ON DELETE SET NULL
  subscribed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  主键 (subscriber_account_id, source_group_id)
```

注意事项：

- 当源 group 被原作者硬删除时，`source_group_id` 会被 SET NULL（§7.1）。订阅行保留下来作为 tombstone（墓碑）。
- 由于 SET NULL 行为，主键需要特殊考虑：PostgreSQL 允许多个 `(account_id, NULL)` 同时存在（NULL 在唯一约束中不等于 NULL）。这可以接受——墓碑可能堆积，由用户主动清理。
- 应用层禁止：账户订阅自己拥有的 group。
- 应用层禁止：订阅一个本身就是订阅的 group（禁止嵌套，见 §7.3）。验证条件："源 group 的 `owner_account_id` 非空且不等于订阅者"。

### 4.5 沿用 `group_adoption`（仅 clone 模式）

`group_adoption`（`content-model.md` §3.3）**只**用于 Clone 接收。Reference 接收只走 `item_group_subscription`。

`item_group.cloned_from_group_id`（§4.1）是冗余的指针，与 `group_adoption` 数据重复。两者都保留：`group_adoption` 是分析友好的规范形式，`cloned_from_group_id` 让单行读取即可获取来源。

### 4.6 不需要为 active-learner 改 `account`

`account.last_active_learner_id` 已存在且接入了 auth 流程。直接复用作为"当前 learner"机制（§五）。

---

## 五、Active Learner：服务端会话状态

前端需要一个全局可读的"当前学习者"，驱动 §六 UC-1 到 UC-4。

### 5.1 存储

已有：`account.last_active_learner_id`（`UUID NULL`，外键 → `learner.id` ON DELETE SET NULL）。

### 5.2 端点

（完整 API 表见 §八。如下端点若尚未存在则补充。）

- `GET /me/active-learner` → `{ learner_id: UUID | null }`
- `POST /me/active-learner` body `{ learner_id }` → 204。校验 `learner.account_id == caller.account_id`。

### 5.3 前端行为

- 登录后：若 `last_active_learner_id` 为 NULL，跳转到 learner 选择页。
- 所有已登录页面：顶部导航显示当前 learner，带快速切换按钮。
- 创建/编辑 group 的 Server Action 从会话读 `last_active_learner_id`，写入 `created_by_learner_id` / `last_edited_by_learner_id`。
- 切换 learner 只是一次 POST + 页面 revalidate，无数据迁移。

---

## 六、使用场景（按写入顺序展开）

以下是驱动 §四 与 §七 的真实用例。每个场景一步步说明数据写入。

### UC-1：家长给当前 learner 创建一本教材

前置：家长已登录；`last_active_learner_id = 小明`。

1. 家长打开"新建教材"页面。
2. UI 顶部显示：「当前 learner: 小明 — 切换」。
3. 家长上传照片 / 粘贴文本。
4. AI 提取语言项 + 推测元数据。
5. 家长确认 → 保存。Server Action：
   - INSERT `item_group`：
     - `owner_account_id = 家长账户 id`
     - `created_by_learner_id = 小明 id`
     - `last_edited_by_learner_id = 小明 id`
   - INSERT 子 `item_group` 行（单元、课时）。
   - INSERT `item_group_member` 关联到全局去重的 `language_item`。
   - INSERT `item_group_learner (根 group id, 小明 id)`。

### UC-2：孩子打开 App、切到自己身份、自己创建教材

前置：账户已存在；孩子打开共享设备上的 App。

1. App 启动：显示 learner picker（"谁在学习？"）。
2. 孩子点"小红"；`POST /me/active-learner { learner_id: 小红 id }`。
3. 之后步骤与 UC-1 第 3 步起一致。结果：group 归属账户、创建出处=小红、分配给小红。
4. 家长下次进入教材库，能看到这本，带署名"由 小红 创建于 5/27"。

### UC-3：家长把已有教材分配给另一个 learner

1. 家长在教材库点开一本教材。
2. UI 显示"已分配给：小明"，旁边有"管理分配"按钮。
3. 家长打开弹窗，勾选"小红"。
4. 前端：`POST /item-groups/{group_id}/learners { learner_id: 小红 id }`。
5. 后端 INSERT `item_group_learner (group_id, 小红 id)`。
6. 小明和小红现在都能看到**同一份**教材、同一份内容、同一行。不发生 clone。

### UC-4：孩子修正 AI 弄错的内容

1. 当前 learner = 小红。打开教材。
2. 发现 AI 漏了某页两个词。
3. 孩子点"添加词"，敲进去。Server Action：
   - 对每个新词：若不存在则 INSERT `language_item`（按 `UNIQUE (type, text)` 全局去重），然后 INSERT `item_group_member`。
   - UPDATE 受影响 leaf 的 `item_group.last_edited_by_learner_id = 小红 id`。
4. 家长侧"最近活动"视图（V2）显示："小红 在 Unit 3 添加了 2 个词"。

若该 group 或任一祖先 `locked = true`，第 3 步以 `403 GROUP_LOCKED` 拒绝。

### UC-5：家长把教材分享给另一家（账户 B）

1. 家长 A 在某根群组上点"生成分享链接"。
2. 前端：`POST /item-groups/{group_id}/share-link`。后端 INSERT `group_share_link` 带唯一 `code`；返回 `{ code, expires_at }`。
3. 家长 A 把链接通过外部渠道发给家长 B。
4. 家长 B 打开链接。前端 `GET /share-links/{code}/preview`（预览元数据无需登录）。UI 显示：名称、kind、词数、封面、来源账户标识。
5. 家长 B 登录（若未登录），看到两个按钮：
   - 「复制一份到我的库」（Clone）
   - 「订阅原版」（Reference）
6a. **Clone**：`POST /share-links/{code}/adopt { mode: "clone" }`。后端：
    - 深拷贝 `item_group` 子树（新 UUID）。
    - 新写入的 `item_group_member` 仍指向同一批全局 `language_item` id。
    - 新根的 `owner_account_id = B`，`cloned_from_group_id = source.id`。
    - INSERT `group_adoption (source.id, 新根.id, adopted_by=B)`。
    - 返回 `{ adopted_group_id: 新根.id }`。
6b. **Reference**：`POST /share-links/{code}/adopt { mode: "reference" }`。后端：
    - INSERT `item_group_subscription (subscriber_account_id=B, source_group_id=source.id)`。
    - 返回 `{ adopted_group_id: source.id }`（注意：这个 id 归 A 所有，不归 B）。
7. 家长 B（或 B 的 active learner 小军）现在在自己库里看到这本。要让它可用，B 通过 UC-3 把它分配给某个 learner ——`item_group_learner` 对自有和订阅 group 一视同仁。

### UC-6：订阅方想修改原版教材（Fork）

1. 账户 B 通过 Reference 接收了某 group（UC-5b）。后来 B 想自己加 3 个词。
2. 订阅 group 在 UI 上所有编辑控件禁用，顶部有横幅："这是订阅的教材，无法直接编辑。Fork 一份以自由修改 →"。
3. B 点 Fork。前端：`POST /item-group-subscriptions/{source_group_id}/fork`。
4. 后端（单一事务）：
   - 深拷贝源子树（与 Clone 一致，UC-5 第 6a 步）。
   - 把所有 `item_group_learner` 行（`group_id = source.id`）改写成 `group_id = 新根.id` —— **保留 B 之前对 learner 的分配**。
   - DELETE `item_group_subscription` 那一行。
   - 返回 `{ new_group_id }`。
5. B 现在可以自由编辑。A 后续的修改不再传播到 B。

### UC-8：Learner 遇到订阅的 group

1. 当前 learner = 小明。家长 B 已把该订阅 group 通过 `item_group_learner` 分配给小明。
2. 小明在 learner 端打开该 group，页面以**只读模式**渲染：
   - 所有编辑控件隐藏（无改名输入框、无添加词按钮、无删除按钮）。
   - 页面顶部显示横幅："此教材来自订阅，仅供学习使用。"
3. 小明仍可从任意叶子 group 启动练习会话（会话创建不受订阅状态影响）。
4. 家长 B 在家长端打开同一 group，能看到 Fork 横幅和操作按钮。Learner 永远看不到 Fork 选项 —— 那是账户管理层的动作。

### UC-9：家长管理哪些 learner 能看到某本教材

1. 家长进入 `/parent/materials/{groupId}/learners`。
2. 页面列出账户内所有 learner，每人一行，显示当前对此根 group 的分配状态（开关）。
3. 家长拨开开关 → `POST /item-groups/{id}/learners { learner_id }`。
4. 家长关闭开关 → `DELETE /item-groups/{id}/learners/{learner_id}`。
5. 分配立即生效，learner 下次加载教材库即可看到（或看不到）该 group。

### UC-7：原作者删除被订阅的 group

（策略见 §7.1，这里只给流程。）

1. 账户 A 硬删除某根群组。后端：`DELETE FROM item_group WHERE id = ...`。
2. CASCADE 删除子 `item_group`、`item_group_member`、`item_group_learner` 行。
3. 所有订阅者的 `item_group_subscription.source_group_id` SET NULL。
4. 账户 B 的教材库查询（§8.5）现在把这条订阅返回为 tombstone。UI 渲染："原作者已删除此教材（订阅于 2026-04-12）— 移除"。
5. B 点"移除"；后端 DELETE 这行 tombstone。
6. 指向已删除 group 的 `item_group_learner` 行已随 CASCADE 消失，learner 的分配列表自动干净。

---

## 七、边界决策

设计阶段的三个活议题已敲定，按此实现即可。

### 7.1 原作者删除被订阅的 group

**决策：SET NULL + tombstone UI。**

- `item_group_subscription.source_group_id` 在源被删时 SET NULL。
- 订阅者 UI 显示墓碑："原作者已删除此教材"。
- 墓碑提供"移除"按钮，删除订阅行。
- 指向被删 group 的 `item_group_learner` 行因 CASCADE 已消失，learner 分配自动清理。

否决的替代方案：

- CASCADE 删除 `item_group_subscription` → 太突兀，用户感知不到。
- RESTRICT → 原作者删不掉，反社交。

### 7.2 Fork 语义

**决策：Fork 等价于一次 Clone 接收，并替换掉订阅行。**

- 拷贝机制与 Clone（UC-5 6a）完全一致。
- 额外一步：把所有 `item_group_learner`（`group_id = source.id AND learner_id IN (订阅者的 learner)`）重写为指向新克隆体的根 id，保留 learner 分配。
- DELETE `item_group_subscription` 那一行，在同一事务内完成。
- 新克隆的 `cloned_from_group_id` 指向源。
- 新克隆的 `created_by_learner_id` 写 **fork 方**的 active learner（干净起步，不从源继承）。

### 7.3 嵌套订阅 / 转分享

**决策：V1 禁止嵌套。**

- 订阅方不能为订阅 group 生成 `group_share_link`。
- 后端在"创建分享链接"端点检查 `item_group.owner_account_id == caller.account_id`。订阅 group 的 `owner_account_id` 是源账户的，该检查自然失败。返回 `403 CANNOT_SHARE_NON_OWNED_GROUP`。
- 想分享的话，先 Fork 成自己的，再分享 fork。

---

## 八、API 接口

路径仅作示意，遵循 `backend/app/api/` 现有约定。除非注明，所有端点要求认证。

### 8.1 Active learner

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| GET | `/me/active-learner` | — | `{ learner_id: UUID \| null }` |
| POST | `/me/active-learner` | `{ learner_id }` | 204 |

校验：`learner.account_id == caller.account_id`。

### 8.2 教材库列表

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/me/library` | `[{ id, name, kind, cover_image_url, source: "owned" \| "subscribed", subscribed_at?, last_edited_by_learner_id?, ... }]` |
| GET | `/me/library/tombstones` | `[{ subscribed_at, source_account_handle }]` |

主列表查询见 §8.5 的 SQL。

### 8.3 分配

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| GET | `/item-groups/{id}/learners` | — | `[{ learner_id, learner_name, assigned_at }]` |
| POST | `/item-groups/{id}/learners` | `{ learner_id }` | 201 |
| DELETE | `/item-groups/{id}/learners/{learner_id}` | — | 204 |

校验：

- 调用方拥有此 group **或** 已订阅此 group。
- `learner_id` 必须属于调用方账户。
- Group 必须是根群组（`parent_id IS NULL`）。

### 8.4 分享

| 方法 | 路径 | 请求体 | 返回 |
|---|---|---|---|
| POST | `/item-groups/{id}/share-link` | `{ expires_at? }` | `{ code, expires_at }` |
| GET | `/share-links/{code}/preview` | — | `{ name, kind, item_count, cover_image_url, source_account_handle }`（无需认证）|
| POST | `/share-links/{code}/adopt` | `{ mode: "clone" \| "reference" }` | `{ adopted_group_id }` |
| POST | `/item-group-subscriptions/{source_group_id}/fork` | — | `{ new_group_id }` |
| DELETE | `/item-group-subscriptions/{source_group_id}` | — | 204（退订 / 清理墓碑）|

`share-link` POST 校验：调用方拥有此 group 且 `parent_id IS NULL`（只允许根群组分享）。

### 8.5 教材库列表 SQL 示意

```sql
-- 自有根群组
SELECT
  g.id, g.name, g.kind, g.cover_image_url,
  g.created_by_learner_id, g.last_edited_by_learner_id,
  'owned' AS source,
  NULL AS subscribed_at
FROM item_group g
WHERE g.owner_account_id = :me
  AND g.archived = false
  AND g.parent_id IS NULL

UNION ALL

-- 订阅根群组（非墓碑）
SELECT
  g.id, g.name, g.kind, g.cover_image_url,
  g.created_by_learner_id, g.last_edited_by_learner_id,
  'subscribed' AS source,
  s.subscribed_at
FROM item_group g
JOIN item_group_subscription s ON s.source_group_id = g.id
WHERE s.subscriber_account_id = :me
  AND g.archived = false
  AND g.parent_id IS NULL
;

-- 墓碑（独立查询，UI 区分渲染）
SELECT subscribed_at
FROM item_group_subscription
WHERE subscriber_account_id = :me
  AND source_group_id IS NULL
;
```

若列表按 learner 而非账户展示，可在第二个 SELECT 上再 JOIN `item_group_learner`。

### 8.6 写操作的权限检查

所有对 `item_group` 的写操作（改名、增删 member、移树、归档切换）必须：

1. 加载 group。
2. 若此 group 或任一祖先 `locked = true`，且调用方不是账户主，返回 `403 GROUP_LOCKED`。
3. 若是订阅 group（`owner_account_id != caller.account_id`），返回 `403 CANNOT_EDIT_SUBSCRIBED_GROUP`。
4. 执行写入。同时 UPDATE `last_edited_by_learner_id = :active_learner_id`（仅用户主动操作时；AI / 系统写入不动这个字段）。

---

## 九、权限矩阵

后端鉴权代码必须严格对照本节。

### 9.1 符号说明

- **Owner（账户主）** = 调用方账户 id 等于 `item_group.owner_account_id`。
- **Assigned learner（被分配的 learner）** = `item_group_learner` 中存在此 group 的 learner，且该 learner 的 `account_id == 调用方账户`。
- **Active learner** = 调用方账户的 `last_active_learner_id`。
- **Subscriber（订阅方）** = 调用方账户在 `item_group_subscription` 有指向此 group 的行。

### 9.2 `item_group` 字段级权限（自有，非订阅）

| 字段 | 账户主 | active learner = 创建者 | active learner = 被分配（非创建者）| `locked = true` 时 |
|---|---|---|---|---|
| `name` | ✓ | ✓ | ✓ | learner ✗，owner ✓ |
| `source_book_hint` | ✓ | ✓ | ✓ | learner ✗，owner ✓ |
| `parent_id`（在同一根树内移）| ✓ | ✓ | ✓ | learner ✗，owner ✓ |
| `parent_id`（跨根树移）| ✓ | ✗ | ✗ | learner ✗，owner ✓ |
| `archived = true`（软删除）| ✓ | ✓ | ✓ | learner ✗，owner ✓ |
| `archived = false`（恢复）| ✓ | ✓ | ✓ | learner ✗，owner ✓ |
| 硬删除（`DELETE FROM item_group`）| ✓ | ✗ | ✗ | learner 永远 ✗ |
| `kind` | ✓ | ✗ | ✗ | learner ✗，owner ✓ |
| `cefr_level` / `pos`（language_item 上）| ✓（家长修正 AI）| ✗ | ✗ | learner ✗，owner ✓ |
| `prompt_notes` | ✓ | ✗ | ✗ | learner ✗，owner ✓ |
| `owner_account_id` | ✗（插入后不可变）| ✗ | ✗ | — |
| `locked` | ✓ | ✗ | ✗ | — |
| `created_by_learner_id` | ✗（插入后不可变）| ✗ | ✗ | — |
| `last_edited_by_learner_id` | 系统填写 | 系统填写 | 系统填写 | — |
| `cloned_from_group_id` | ✗（插入后不可变）| ✗ | ✗ | — |

注：`cover_image_url` 不是 V1 字段，行已省略。`name` 有意允许任何被分配的 learner 修改 —— 账户主可用 `locked` 在需要时加锁。

### 9.3 group 内的 `language_item` 操作（自有 group）

| 操作 | 账户主 | active learner | `locked = true` |
|---|---|---|---|
| 添加成员（关联已有或新建 `language_item`）| ✓ | ✓ | learner ✗ |
| 删除成员（删除 `item_group_member`）| ✓ | ✓ | learner ✗ |
| 直接编辑 `language_item.text` | ✗ | ✗ | — 永远 ✗ |
| 编辑 `language_item.cefr_level` / `pos` / `type` | ✗ | ✗ | — 永远 ✗ |

修正错字的正确方式：因为 `language_item` 在全局通过 `UNIQUE (type, text)` 去重，直接改 `text` 会影响所有账户里引用该行的 group。正确流程是**删除 + 添加**：删掉错的成员，添加对的成员（按需懒创建 `language_item`）。UI 可以叫它"修正词"，但实现上是原子的 删+加。

### 9.4 订阅 group

| 操作 | 订阅方 | 源 group 持有方 |
|---|---|---|
| 阅读 group 及子树 | ✓ | ✓ |
| 分配给自己的 learner（`item_group_learner`）| ✓ | n/a |
| 取消自己 learner 的分配 | ✓ | n/a |
| 任何对 group 本身的写操作（改名、加词、删除）| ✗ —— 先 Fork | ✓ |
| Fork（订阅升级为克隆）| ✓ | — |
| 退订（DELETE 订阅行）| ✓ | — |
| 从此 group 生成分享链接 | ✗（§7.3）| ✓ |

**UI 规则（订阅 group）**：所有编辑控件完全隐藏（改名输入框、加词/删词按钮、删除入口、移树入口一律不渲染）。页面顶部固定横幅：「此教材来自订阅，仅供学习使用，无法编辑。如需自定义，请 Fork 一份 →」。页面仅展示 Fork 和退订两个操作入口。

---

## 十、迁移计划

### 10.1 单一 Alembic 迁移

一个迁移文件完成：

1. `item_group` 加列：
   - `created_by_learner_id UUID NULL`（FK SET NULL → `learner.id`）
   - `last_edited_by_learner_id UUID NULL`（FK SET NULL → `learner.id`）
   - `locked BOOLEAN NOT NULL DEFAULT false`，`server_default=sa.text("false")`
   - `cloned_from_group_id UUID NULL`（FK SET NULL → `item_group.id`）
2. 新表 `item_group_learner`（§4.2），按项目规范同时带 `TimestampMixin` 的 `created_at` / `updated_at`。
3. 新表 `item_group_subscription`（§4.4），同上加时间戳列。
4. 核对 `group_share_link`、`group_adoption` 是否存在；若不存在，按 `content-model.md` §3.3 建表。
5. 索引：
   - `item_group_learner (learner_id)` 反向查询用
   - `item_group_subscription (subscriber_account_id)` 教材库列表用
   - `item_group (last_edited_by_learner_id)` 家长活动 feed 用

### 10.2 数据回填（在同一迁移内完成）

1. `item_group.created_by_learner_id`：留 NULL，没有历史信号。
2. `item_group.last_edited_by_learner_id`：留 NULL。
3. `item_group.locked`：默认 false（已正确）。
4. `item_group.cloned_from_group_id`：NULL（已正确）。
5. `item_group_learner` **必须回填**。对每个 `parent_id IS NULL` 的 `item_group`，给账户内每个 learner 插入一行：
   ```sql
   INSERT INTO item_group_learner (group_id, learner_id)
   SELECT g.id, l.id
   FROM item_group g
   JOIN learner l ON l.account_id = g.owner_account_id
   WHERE g.parent_id IS NULL;
   ```
   保留"账户内人人可见所有 group"的现有行为。若不回填，老 learner 会丢失对老 group 的访问。

### 10.3 多 PR 上线顺序

schema 迁移作为一个 PR；后续功能 PR 按以下顺序：

1. **Schema 迁移**（上文）。落地后 App 行为不变，新表已建好但暂未使用。
2. **按分配过滤 scope** —— 修改 Scope Computer / 会话创建守卫，按 `item_group_learner` 而非 `owner_account_id` 过滤。落地后 learner 只看到分配给自己的 group。
3. **Active-learner 端点 + 前端串联** —— 顶部 UI、learner picker、Server Action。
4. **分配管理 UI** —— UC-3 里的"管理分配"弹窗。
5. **跨账户分享 + 模式选择** —— `share-link/adopt` 接受 `mode`；UI 提供 Clone vs Reference 二选一。
6. **Fork + 墓碑** —— 完成订阅生命周期。
7. **Parent-lock 切换** —— 设置区域 UI。

每一步独立可发布。

---

## 十一、与其他文档的关系

- `content-model.md` §2 原则 #6（"分享 = 克隆，而非引用"）：**修订** —— 分享提供 clone 或 reference 二选一，由接收方选。
- `content-model.md` §5（分享与克隆动力学）：**取代** —— 改用本文 §六 UC-5、UC-6、§七。
- `content-model.md` §3.5 `session.group_id`：不变 —— session 仍指向单个 `item_group`（自有或订阅都行，session 视角不区分）。
- `architecture.md` Scope Computer 章节：澄清 —— scope 查询应按 active learner 的 `item_group_learner` 过滤，而非按 `owner_account_id`。
- `CLAUDE.md` 八大架构规则第 5 条（Account vs Learner）：强化 —— Account 是归属/计费层，Learner 是 scope 层。本文档把这个区分落到实操。

---

## 十二、V1 不做（推到 V2+）

以下明确不在本文档范围：

1. **canonical / 全局教材**（`owner_account_id IS NULL`）。V2 引入不可变版本化的 canonical group + 内容寻址的 overlay 路径。
2. **账户内的 per-learner overlay**（如每个 learner 单独的显示名）。曾考虑后否决：V1 无此需求；UUID 锚定的 overlay 抵抗不了结构变动。若日后需要，与 canonical-textbook 一起设计。
3. **订阅版本号 + 升级提示**。V1 订阅实时跟随源；无版本意识。
4. **转分享订阅 group**（订阅嵌套）。
5. **完整的结构变更审计**。V1 只记录 `last_edited_by_learner_id`（最近一次编辑者）。完整 `group_audit` 表是 V2。
6. **跨家庭共享 learner**。V1 假定一个 learner 恰属一个账户。
7. **针对 learner 危险动作的家长通知**。V1 靠审计字段；真正的通知系统是 V2。

---

## 十三、工程师常见疑问

下列已有推荐答案；如要改方向请先和产品同步。

- **Q1**：`locked` 开关应该出现在每一层级的管理卡片上，还是藏在“高级设置”里？
  → 展示在每一层级卡片上。家长可以只锁某个单元，而不必锁整本书。一个小锁头图标按钮就够。
- **Q2**：learner 做破坏性动作（如归档整个单元），是否通知家长？
  → V1 不通知。审计字段够用。V2 加活动 feed。
- **Q3**：Fork 时，`created_by_learner_id` 是从源继承，还是写当前 learner？
  → 写 fork 方的当前 learner。干净起步。
- **Q4**：订阅源更新（原作者加词），是否通知订阅方？
  → V1 不通知。V2 可加一个安静的"原作者新增 N 条"角标。
- **Q5**：active learner 被删除，他"创建"的 group 怎么办？
  → `created_by_learner_id` SET NULL（FK 已配置）。Group 仍归账户所有，署名变匿名。
- **Q6**：并发竞态下，家长同一 group 同一 learner 分配了两次怎么办？
  → `item_group_learner` 复合主键阻止重复。第二次 INSERT 返回 409；UI 把 409 当 no-op。

---

文档完。
