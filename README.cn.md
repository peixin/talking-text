# Talking Text · 字有天地

> **言出成界** · Words become your world.

一款面向儿童的英语口语陪练 app。让 AI 只在孩子已学的范围（加一点点踮脚够得到的新词）里和他聊天——把课本上静态的文字，变成日常敢说出口的话。

---

## 文档

| 文档 | 内容 |
|---|---|
| [产品说明](docs/product.cn.md) | 缘起、哲学根源（维特根斯坦 × 李白/余光中）、品牌体系、开屏词库 |
| [技术架构](docs/architecture.cn.md) | 技术栈、仓库结构、数据模型、Scope Computer、对话数据流、Adapter 模式、部署规划 |
| [技术选型清单](docs/tech-stack.cn.md) | 每项技术选型的「是什么、为什么选、考虑过什么、为什么不用」 |
| [Session 记录](docs/session-log.cn.md) | 从想法到脚手架跑通的完整对话缩影，含关键分歧与反转点 |
| [协作指南](CLAUDE.cn.md) | 给 Claude Code 和未来贡献者的项目上下文 |

---

## 一眼看懂

- **问题** · 孩子学英语时间不少，开口机会很少。通用 AI 闲聊没范围，孩子容易撞边界、生挫败。
- **方案** · 把孩子的课本喂给 AI，让 AI 在"已学 + 10% 踮脚"范围里陪聊。每一次开口都从自信的中心出发，边界一寸一寸往外推。
- **哲学** · 维特根斯坦：语言的边界就是世界的边界 × 余光中/李白：绣口一吐，就半个盛唐。
- **技术** · Web PWA（Next.js 全范式 + FastAPI）· 火山方舟 STT/LLM/TTS 全家桶 · PostgreSQL + Redis + 火山 TOS。

---

## 快速开发

```bash
just install        # 一次性安装前后端依赖
just dev            # 同时起后端和前端
just api            # 只起后端 (http://localhost:8000)
just web            # 只起前端 (http://localhost:3000)
just                # 查看所有可用命令
```

需要本地 Postgres + Redis（V1 阶段不上 Docker，详见架构文档"部署"一节）。

---

## License

暂未发布。
