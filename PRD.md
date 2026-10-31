# HARNESS PRD · 官方 Pi 基础工具加速（求职作品）

> 状态：v0.3.3 已 ship（§12.3 spawn-path Ir：bash truncateTail 扫描；grep/find 保 rg/fd + 后处理）  
> §12.1 JS 热路径 + §12.3 spawn-path 均已收工；门禁 `valgrind-ir` + count-ratchet  
> 日期：2026-10-31（Asia/Shanghai）

## 1. 一句话

钉死官方 `earendil-works/pi`（pi-agent）coding-agent 基础工具为基线，做**可嵌入官方 A/B** 的加速路径；Rust 可选；以**确定性计数（本机 `valgrind-ir`）**为主指标；未过 `/verify` 不写性能结论；MIT 公开作品集。

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
| read | 是 | 默认战场；**本轮 hillclimb 主攻** |
| bash | 是 | 默认战场；尾部截断；spawn 绑定，非本轮硬目标 |
| edit | 是 | 默认战场；**本轮 hillclimb 主攻** |
| write | 是 | 默认战场；**本轮 hillclimb 主攻** |
| grep | 是 | v1；底层 `rg`；spawn 绑定，非本轮硬目标 |
| find | 是 | v1；底层 `fd`；spawn 绑定，非本轮硬目标 |
| ls | 是 | v1；已大胜（Ir ~1.47×），本轮保持 |
| powershell | 否 | 本阶段不碰 |

共享硬顶（基线）：约 **2000 行 / 50KB**（见 `truncate.ts`）。

## 5. Schema 与截断策略

- **保持**与官方相同的工具 schema / 入参出参形状，便于嵌入 A/B。
- **先弄清**官方为何截断（上下文预算、稳定性），再设计可配置或正确移除。
- **禁止** silently 改变语义或截断行为却宣称兼容。

## 6. 指标

| 指标 | 角色 | 说明 |
|---|---|---|
| 确定性计数（探测链：perf instructions → Valgrind Ir → …） | **主（lab）** | 本机选取 **`valgrind-ir`**；见 docs/METRICS.md |
| 墙钟 latency | 次（展示） | fair A/B 中位；**不当 lab 门** |
| 峰值 RSS | 必报 | 内存足迹 |
| 产物体积 | 若有原生二进制则必报 | release 体积 |

**门禁：** verify `count-ratchet` = suite sum `fastCpu <= officialCpu × 1.05` + per-tool `× 1.15`；`wallMs` 不入门。

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

## 12. Ir hillclimb · 本轮目标与 spawn 路径（产品决策）

### 12.1 本轮 /goal（已收工 · v0.3.1→v0.3.2）

| 项 | 内容 |
|---|---|
| **Goal** | 在保持 parity 的前提下压 **Valgrind Ir**，优先让 `read:small` / `read:boundary-lines` / `edit` / `write` 的 `fastCpu < officialCpu`，并尽量拉开 suite 总和 |
| **主攻** | `packages/fast-tools` 的 **read / edit / write / truncate** JS 热路径（少 split/join、少冗余 syscall、边界截断不整文件 re-join；v0.3.2 含 line-only truncate、edit `lastIndexOf`） |
| **门禁不变** | lab metric = `valgrind-ir`；verify `count-ratchet`（suite×1.05 + tool×1.15）；`wallMs` 仅展示（见 `docs/METRICS.md`） |
| **验收** | parity PASS → bench 刷新实测表 → `/verify` PASS → 才允许 commit/push 与更新 README/Page 成绩 |
| **收工对照（v0.3.2 小套件 · 实测见 README）** | suite Ir ~1.10×；`read:boundary-lines` ~1.43×；四目标均 `fastCpu < officialCpu`；`ls` ~1.47× 保持 |

### 12.2 `bash` / `grep` / `find`：spawn-bound 瓶颈（本轮非硬目标）

与 §12.1 的纯 JS 热路径不同，`bash` / `grep` / `find` 在官方实现与本 harness 加速路径上均为 **spawn-bound**：每次工具调用都会重新拉起子进程，并分别绑定到 `bash -c`、`rg`、`fd`。Valgrind Ir 在 `--trace-children` 下汇总 parent Node 与子进程的 cachegrind `summary:`，因此这类工具的 Ir 里相当一部分来自进程启动与外部二进制本身，而不是本仓库可控的 JS 切片/拼装循环。

本轮将三者标为 **「非本轮硬目标」** 是**产品范围决策**（非仓促漏做）：硬压 spawn 路径 Ir 的边际收益小；现有 A/B 仍对它们做 fair 测量与 count-ratchet（每工具 ×1.15），但不把「显著压低其 Ir」当作 §12.1 验收条件。`ls` 已有明显 Ir 优势，本轮仅回归保持。`powershell` 仍「本阶段不碰」（见 §4）。

未来若单独开一轮：合理方向是减少「每次调用都冷启动」的成本——例如在安全边界内**复用长生命周期 helper 进程**，或对 bash 类交互考虑**持久 shell session**——并继续用同一套 `valgrind-ir` + count-ratchet 门禁验收。具体实现与加速比须待新一轮实测；本节不预设未验证方案细节或数字。

### 12.3 spawn-path Ir hillclimb（已收工 · v0.3.3 · 见 `docs/ADR-0002-spawn-reuse.md`）

| 项 | 内容 |
|---|---|
| **Goal** | 压 `bash` / `grep` / `find` 的 Valgrind Ir；方向曾评估持久 session / in-process helper |
| **证据结论** | 持久 bash session 与 in-process grep/find 在本机 Valgrind Ir 下**均不优**（session 更差；JS walk > `rg`/`fd` child） |
| **落地** | **bash：** `truncateTail` 在 byte 帽内用 `countLinesNoAlloc` + 反向扫换行取尾部（避免整表 `split`）；**grep/find：** 保留 `rg`/`fd` spawn，削减后处理 alloc |
| **门禁** | `valgrind-ir` + count-ratchet；parity + `/verify` PASS 后才写结论 |
| **收工对照（小套件实测）** | `bash` ~**1.31×**；grep/find ~1.00×；suite sum ~**1.14×**；`ls` / `read:boundary-lines` 保持 |
