# HARNESS PRD · 官方 Pi 基础工具加速（求职作品）

> 状态：FULL 路径已跑完（linux verify PASS；macos SKIP；见 README / results/）  
> 日期：2026-10-31（Asia/Taipei）

## 1. 一句话

钉死官方 `earendil-works/pi`（pi-agent）coding-agent 基础工具为基线，做**可嵌入官方 A/B** 的加速路径；Rust 可选；以 CPU 事件为主指标；未过 `/verify` 不写性能结论；MIT 公开作品集。

## 2. 目标 / 非目标

| | 内容 |
|---|---|
| **目标** | 求职作品：证明能对官方工具路径做可复现、可嵌入的性能优化 |
| **非目标** | 不替换官方 Pi CLI；不重写完整 agent loop；忽略 crates.io 第三方 `pi-agent` 与 `/workspace/pi-rs*` |

## 3. 基线钉死

| 项 | 值 |
|---|---|
| 上游 | `earendil-works/pi` |
| Pin | `86dc686cf2fd795b2b24af3d614bb0e1307bcd76` |
| 工具目录 | `packages/coding-agent/src/core/tools/` |
| 本地镜像 | `/workspace/earendil-pi` |

## 4. v1 工具战场

| 工具 | 默认开 | 备注 |
|---|---|---|
| read | 是 | 默认战场 |
| bash | 是 | 默认战场；尾部截断 |
| edit | 是 | 默认战场 |
| write | 是 | 默认战场 |
| grep | 是 | v1；底层 `rg` |
| find | 是 | v1；底层 `fd`（非纯 JS） |
| ls | 是 | v1 |
| powershell | 否 | 本阶段不碰 |

共享硬顶（基线）：约 **2000 行 / 50KB**（见 `truncate.ts`）。

## 5. Schema 与截断策略

- **保持**与官方相同的工具 schema / 入参出参形状，便于嵌入 A/B。
- **先弄清**官方为何截断（上下文预算、稳定性），再设计可配置或正确移除。
- **禁止** silently 改变语义或截断行为却宣称兼容。

## 6. 指标

| 指标 | 角色 | 说明 |
|---|---|---|
| CPU 事件 / HW counters | **主** | 尽量不依赖具体机器墙钟；跨机可比 |
| 墙钟 latency | 次 | 可复现基准，注明环境 |
| 峰值 RSS | 必报 | 内存足迹 |
| 产物体积 | 若有原生二进制则必报 | release 体积 |

**禁令：** 未过项目 `/verify` 不得写性能结论；README **只允许实测数字**。

## 7. 交付形态

1. **嵌入官方 Pi A/B**：同一 fixture、同一调用面，官方 vs 加速可切换。  
2. **Standalone CLI/lib demo**：允许，便于作品集展示。  
3. **固定 fixture 仓**：基准输入钉死。

## 8. 平台与工程约束

- Linux **与** macOS 都要跑通基准。  
- 若选用 Rust：**禁止 `unsafe`**。  
- 提交 / 部署前：若有 `/verify` skill 必须先跑；FAIL/BLOCKED 不得 commit/deploy，也不得写性能段。

## 9. 许可

MIT，公开仓库，简历可引用。

## 10. 完整路径阶段（对应 `workflows/harness-full.js`）

1. Pin & Inventory  
2. Fixture  
3. Schema & Truncation Audit  
4. Baseline Measure（七工具）  
5. Bottleneck Analysis（按工具并行）  
6. Tech Decision（Rust 可选，证据选型 + ADR）  
7. Adapter Design（官方嵌入 + standalone）  
8. Implement  
9. Parity Tests  
10. Bench A/B（Linux + macOS）  
11. Verify Gate（FAIL → 回修）  
12. Docs & Release（README 仅实测）

## 11. 决策溯源（20 题摘要）

1 求职不换 CLI · 2 钉官方 commit · 3 只做工具路径 · 4–5 七工具进 v1 · 6 Rust 可选 · 7 同 schema + 弄清截断 · 8–11 CPU 事件主 + 墙钟/RSS/体积 · 12 禁 unsafe · 13–14 必须 A/B + 允许 standalone · 15–16 fixture + 双平台 · 17–18 verify 门禁 + 实测 README · 19 MIT · 20 **先 PRD + FULL workflow 审批再开工**。

