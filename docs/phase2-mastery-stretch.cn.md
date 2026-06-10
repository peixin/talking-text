# Phase 2 设计 — 掌握度 + 踮脚词（Mastery + Stretch）

> 状态：**已批准并实施 2026-06-10** —— 决策 A（不建 `learner_word_stats`）与
> B1（`item_group.position`，迁移 `8f2d4b7c1a90`）已由所有者确认。
> 日期：2026-06-10 · 英文版：[`phase2-mastery-stretch.md`](phase2-mastery-stretch.md)
> 上下文：[`roadmap.md`](roadmap.md) Phase 2 · [`architecture.md`](architecture.md) §5

---

## 0. 库存修正 —— 哪些已经存在

Roadmap 的 Phase 2 清单是按"掌握度追踪从零开始"写的，但事实并非如此。自
`b46a6684d7e9`（content-model 迁移）起，仓库已经有一条可运行的 item 级掌握度管线：

| 部件 | 位置 | 状态 |
|---|---|---|
| `learner_item_stats` 表 — `(learner_id, item_id)` 主键，`seen_count`、`used_count`、`correct_count`、`last_seen`、`mastered_at` | `storage/models/learning.py`，迁移 `b46a6684d7e9` | **已上线** |
| 每轮 anchor 扫描（对 `text_user` 中命中的范围内词条累加 `seen_count`/`last_seen`） | `core/mastery.py: scan_turn_for_items` | **已上线**，由 orchestrator 触发 |
| Session 结束 LLM 分析（累加 `used_count`/`correct_count`，阈值 3 时写 `mastered_at`） | `core/mastery.py: analyze_session` | **已上线**，由 orchestrator 触发 |
| 掌握度感知的 scope 裁剪（>100 词条的组按掌握度排序切片） | `core/scope/v1.py` | **已上线** |

所以 Phase 2 **不是**"搭建掌握度追踪器"，而是"让 scope 和家长去*消费*追踪器
已经在采集的数据"。剩余三项工作：

1. Scope Computer V2 —— 来自下一单元、按掌握度加权的踮脚词。
2. 面向家长的周报 —— "孩子这周说出的新词"。
3. （薄切片）follower 渐进解锁 —— 刻意推迟，见 §5。

---

## 1. 决策 A —— 还需要 `learner_word_stats` 吗？**建议：不需要。**

Roadmap（以及 CLAUDE.md 规则 #3）原计划新建 `learner_word_stats (learner_id, word)`
表，每轮增量 upsert。重新审视它的两个预期消费方：

- **踮脚词加权**需要的是*教材词条*的掌握状态 —— 即已存在的
  `learner_item_stats`。踮脚词候选是下一单元的 `LanguageItem`，状态在 item 级，
  不在表面词级。
- **周报**需要的是"本周 `text_user` 中出现、且此前任何 turn 都没出现过的词"。
  这是对该学习者自己的 turn 做读取时集合差。organize inbox 已经在线上做着
  一模一样的计算（`groups.py: _tokenize_words` + 差集），背后没有任何表。
  在 Phase 1 规模（3–5 个家庭，每次会话几分钟语音）下扫描是毫秒级。

规则 #3 自己的前提 —— *词频随时可从 turn 文本派生，它不是独立的事实源* ——
正是"在真实读路径瓶颈出现前不要物化"的论据。**提议：什么都不建；周报读取时
计算。等报告延迟或 turn 体量真正成为问题再回头。** 这样 Phase 2 **最多只有
一个** schema 变更（决策 B），甚至可能为零。

---

## 2. 决策 B —— "下一单元"需要排序依据。**schema 选择 —— 待批准。**

踮脚词 = "下一单元的 ~10% 词汇"。但 `item_group` **没有兄弟排序列**。单元是
书节点下的兄弟 `ItemGroup` 行，除了名字之外没有任何东西记录 Unit 2 在 Unit 1
之后。

| 方案 | schema 变更 | 行为 |
|---|---|---|
| **B1（推荐）** —— 给 `item_group` 加可空 `position: int`；兄弟按 `(position NULLS LAST, 自然排序(name))` 排 | 一个可空列 + 迁移，无需回填 | 自然排序兜底意味着现有树原样可用（"Unit 2" < "Unit 10" 正确处理）；organize 工作台以后可以暴露显式排序而无需再迁移 |
| B2 —— 仅按 `name` 自然排序 | 无 | 零迁移，但在非编号名字（"Food"、"My Family"）上静默失效 —— 手作书和 Tot Talk 恰恰是这种 |
| B3 —— 按 `created_at` 排 | 无 | 采集顺序 ≠ 教材顺序；乱序拍页会永久污染序列 |

B1 的列定义：

```python
# item_group
position: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
# 不加索引：永远与已有索引的 parent_id 一起读。
```

"下一单元"的定义（V2 刻意收窄）：

- 会话锚定组在同一父节点下、按上述顺序的下一个**兄弟**。
- 锚在 lesson → 下一个 lesson；锚在 unit → 下一个 unit。
- 最后一个兄弟、根组、free/calibration 模式 → **踮脚词为空**。
  跨父节点（Unit 1 最后一课 → Unit 2 第一课）是 V2 的非目标。

---

## 3. Scope Computer V2 —— 踮脚词选取

### 3.1 Protocol 扩展（增量式 —— 不破坏冻结接口）

```python
@dataclass
class ScopeResult:
    ...现有字段不变...
    stretch_words: list[str] = field(default_factory=list)   # 新增
    stretch_ratio: float = 0.0                                # 新增，回显配置
```

### 3.2 选取算法（`core/scope/v2.py`，仅 group 模式）

1. 解析下一个兄弟组（§2）；收集其后代中 `type == "word"` 的词条。没有 → 原样
   返回 V1 结果。
2. 排除已在基础范围内的词（与 `words` 去重）。
3. 排除已掌握的词（`learner_item_stats.mastered_at IS NOT NULL`）。
4. 预算 = `ceil(stretch_ratio × len(base_words))`，上限 `stretch_max_words`。
   （50 个基础词 × 0.10 → 5 个踮脚词。）
5. **按掌握度加权排序**，两档：
   - 第一档：瞥见过但未掌握（`seen_count > 0`）—— 强化孩子已经擦过边的词。
   - 第二档：从未见过。
   每档内用 **`session_id` 做种子**洗牌 —— 会话内确定（每轮同一批词，LLM 可以
   持续铺垫，选取无需持久化即可复现），跨会话轮换（同样 5 个词不会永远霸占
   踮脚位）。

### 3.3 配置（业务参数 → `config.toml`，遵循配置分层）

```toml
[scope]
stretch_ratio = 0.10
stretch_max_words = 8
```

### 3.4 Prompt assembler —— 新增段落（group 模式、踮脚词非空时）

放在基础词表段之后，措辞大意：

> "踮脚词 —— 孩子还**没有**学过这些：{words}。每次对话最多悄悄织入一到两个，
> 只在语境能让含义不言自明（手势级清晰度）的地方用，顺口解释一次也可以。
> 绝不测验、绝不罗列、绝不让孩子觉得这些是'考点'。如果孩子接住并用出来了，
> 简短地庆祝一下。"

现有基础词表指令写的是"不要引入列表之外的词汇（每次会话一两个新词没关系）"
—— V2 把这个逃生口改为指向踮脚词列表，而不是放任 LLM 自由发挥：
"如果要引入新词，从踮脚词列表里取。"

### 3.5 验证产品论题 —— 在 `core/mastery.py` 里闭环

通过线是"踮脚词在曝光后一周内真实出现在孩子的口语里"。今天
`scan_turn_for_items` 和 `analyze_session` 只看锚定组的词条，孩子*用出*踮脚词
是不可见的。

修法（无 schema 变更）：两个函数都把词条集合扩展为含下一兄弟组的 word 词条
（与 §2 相同的解析 —— 重算，不持久化）。孩子说出的任何下一单元词由此进入
`learner_item_stats` 既有的 seen/used/correct 机制。曝光体现在下一单元词条的
`seen_count`，产出体现在 `used_count`。周报（§4）负责呈现。

刻意简化：我们追踪的是孩子对*整个*下一单元的使用，而非只追那 ~5 个被选中的
词。孩子自发说出一个 Tina 从没说过的下一单元词，是更强的论题信号，还省去了
持久化每会话踮脚词选取的麻烦。

---

## 4. 家长周报 —— "孩子这周说出的新词"

按 roadmap：**纯列表，不要图表。** 一个产物同时检验论题（踮脚词出现在列表里）
和留存钩子（家长回来看它）。

### 4.1 计算（读取时，不建新表 —— 见决策 A）

对该学习者，在最近 7 天的 turn 上：

1. `this_week = tokenize(窗口内 turn 的 text_user)`（复用 `_tokenize_words`）。
2. `before = tokenize(窗口之前所有 turn 的 text_user)`。
3. `new = this_week − before`，附首次说出日期和次数。
4. 给每个词打标：
   - **curriculum** —— 命中该学习者已分配组范围内 word 类型的 `LanguageItem`；
   - **stretch** —— 相对本周有过会话的任一组，命中其下一单元词条（论题列）；
   - **wild** —— 都不是（教材外的口语；organize inbox 已经把同一集合收割为
     practice candidates）。

本轮不做停用词过滤 —— 高级降噪管线已在
`feature-proposal-spoken-vocabulary.md` 单独立项并继续推迟。如果裸列表对家长
太嘈杂，第一根便宜的杠杆是隐藏一两个字母的 token，而不是引入词表数据库。

### 4.2 呈现面

- 后端：`GET /learners/{learner_id}/report/weekly` →
  `{week_start, week_end, new_words: [{text, first_said_at, count, tag}]}`。
  账户属主鉴权，复用现有 learner 端点的依赖链。
- 前端：现有家长页面上的一个区块（Server Component，数据经 `lib/backend.ts`；
  文案进 `i18n/messages/*`）。除非家长页已经拥挤，否则不开新路由。

### 4.3 本切片不做

报告推送/通知、周环比、按会话拆分、图表。通过线是"家长不经提示主动谈起
报告" —— 一张他们自己拉出来看的列表足以检验这一点。

---

## 5. Follower 渐进解锁 —— 刻意做薄

Roadmap 列了它（关键路径第 5 步，与
[`learner-content-scope.md`](learner-content-scope.md) 的订阅机制重叠）。
订阅已经存在（`item_group_subscription`，clone/reference/fork）。"渐进解锁"
要新增的 —— 掌握度过阈值后自动推进 follower 的锚定单元 —— 恰恰依赖本阶段
才开始产生的 mastery + stretch 数据。

**提议：本轮不做自动推进。** follower 家长在会话开始时手选单元*就是*手动版
渐进解锁，而且已经能用。等周报数据证明掌握度阈值可信到足以驱动推进时再回头
—— 错误的自动推进比没有更糟。

---

## 6. 待批准事项汇总

| # | 决策 | 建议 |
|---|---|---|
| 1 | `learner_word_stats` 表 | **不建** —— 周报读取时计算（决策 A） |
| 2 | "下一单元"的兄弟排序 | **B1**：可空 `item_group.position` + 自然排序兜底（Phase 2 唯一 schema 变更） |
| 3 | `ScopeResult` 新增 `stretch_words` / `stretch_ratio`（增量式） | 批准 |
| 4 | Mastery 扫描扩展到下一单元词条（无 schema 变更） | 批准 |
| 5 | 周报端点 + 家长页区块，不建新表 | 批准 |
| 6 | Follower 自动推进 | **推迟**（手选单元已可用） |

批准后的实施顺序：§2 迁移 → §3 scope V2 + assembler + mastery 扩展（纯后端，
现有夹具可测）→ §4 周报 → 先用创始人自家孩子人工验证踮脚词，再让 Phase 1
家庭看到。
