# HARNESS PRD · 官方 Pi 基础工具加速（求职作品）

> 状态：v0.3.4 **已收工** — §12.4 native Ir worker（`bin/harness-helper`，ADR-0003）；小套件八行 Ir 均 ≥2.0×  
> 门禁仍 `valgrind-ir` + count-ratchet；`wallMs` / softCpu 仅展示  
> 日期：2026-10-31（Asia/Taipei）

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
| ls | 是 | v1；§12.4 后小套件 Ir ~12.24×（≥2×） |
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

## 12.4 / 13. /goal · 每工具 ≥2× Ir（**已收工 · v0.3.4** · 相对 tip `98cc5ad` / v0.3.3）

> 本节 = per-tool ≥2× 规格。**v0.3.4 已收工**（ADR-0003 native Ir worker）。下方 **12.4.2 / 12.4.3** 保留 tip-`98cc5ad` **开工前基线**；**12.4.6** 为收工后实测。lab 仍 `valgrind-ir`；softCpu/wall 仅展示。

### 12.4.1 度量定义（按 tool 统一）

| 项 | 定义 |
|---|---|
| **Lab 主指标** | Valgrind cachegrind **Ir**（`officialCpu` / `fastCpu`），见 `docs/METRICS.md` |
| **加速比** | `speedup = officialCpu / fastCpu`；**达标 = speedup ≥ 2.0**（fast Ir ≤ 官方一半） |
| **相对谁** | **官方 shim**（同一 pin `86dc686` 的 official 路径） vs **本仓 fast-tools**；对照 tip = **`98cc5ad`（v0.3.3）** 已测 JSON，不是口头基线 |
| **Suite** | **小套件**为硬验收（八行：`read:small`、`read:boundary-lines`、`bash`、`edit`、`write`、`grep`、`find`、`ls`）；**大套件**同步跟踪（尽量 ≥2×，不单独放宽小套件门） |
| **兼报（非门）** | `softCpuUs` 比、`wallMs` 比 —— Page/README 可展示，**不入 count-ratchet / 不判达标** |
| **验收门禁** | 改动后仍须 **parity PASS** + 项目 **`/verify` PASS**（含 count-ratchet：suite sum `fast ≤ official × 1.05`、per-tool `× 1.15`）；未过 verify **不得**写性能结论或 commit 宣称 |
| **达不到 2×** | PRD/ADR 写 **「候选路径 vs 已知硬顶」** + 实测证据；**禁止**假装必达或编造倍数 |

**硬顶证据（空 worker，ir-rounds=20）：** Node no-op ≈110M Ir；同场景 Rust no-op ≈0.32M Ir。故小工具在「官方 Node worker vs 加速 Node worker」下理论 ≤~1.2×；≥2× 必须让 fast 的 lab worker 离开 Node（ADR-0003）。

### 12.4.2 小套件缺口表（开工前基线 · tip `98cc5ad` · lab=Ir · **历史**）

| tool | Ir×（目标 ≥2.0） | softCpu×（展示） | wall×（展示） | 状态 | 候选路径 | 已知硬顶 / 证据 |
|---|---:|---:|---:|---|---|---|
| `read:small` | **1.000** | 3.978 | 1.273 | 目标 ≥2× | 减父进程固定开销；字节路径 / 少 alloc（见 `bottlenecks.json`） | 小文件 Ir 几乎贴官方；固定 Node+Valgrind 底座占比高 |
| `read:boundary-lines` | **1.431** | 2.482 | 1.954 | 目标 ≥2× | 继续截断热路径（v0.3.1–0.3.2 已有胜）；避免全量 `split` | 已有截断胜；再翻倍需更深父进程路径 |
| `bash` | **1.306** | 1.053 | 1.045 | 目标 ≥2× 相对当前 baseline | 父进程侧再削；**native 长生命周期 helper**（若证据优） | ADR-0002：持久 bash session 在本机 Ir **更差**；`bash -c` exec 进命令、child 计量绑定 |
| `edit` | **0.998** | 1.912 | 0.894 | 目标 ≥2× | 单遍 replace / 少字符串拷（bottlenecks） | 现 Ir ≈ 平手甚至略负；热路径短，固定底座占比高 |
| `write` | **0.999** | 1.108 | 1.247 | 目标 ≥2× | 几乎无算法头寸（mkdir+write） | bottlenecks：expectedWin = noise-level |
| `grep` | **1.000** | 0.961 | 0.997 | 目标 ≥2× 相对当前 baseline | 保留 `rg`；试 **native helper 摊销 spawn**；禁再走已拒的 in-process | ADR-0002：in-process JS walk Ir **劣于** spawn `rg`（~0.69×） |
| `find` | **1.003** | 0.977 | 1.002 | 目标 ≥2× 相对当前 baseline | 同 grep：`fd` + 可选 native helper | ADR-0002：in-process 劣于 `fd`（~0.92×） |
| `ls` | **1.468** | **16.943** | **17.649** | **Ir 未达标**（目标 ≥2×）；soft/wall 已远超 2×（仅展示） | `withFileTypes` 等再削父进程 Ir；勿为 wall 牺牲 Ir 叙事 | soft/wall 大胜 ≠ Ir 达标；lab 仍以 Ir 判 |

**小套件结论（诚实）：八行无一 Ir ≥2.0×。** suite sum ~1.14×（v0.3.3 收工文案）。

### 12.4.3 大套件跟踪（开工前基线 · 同 tip 测次 · **历史**）

| tool | Ir× | softCpu× | wall× | 备注 |
|---|---:|---:|---:|---|
| `read:large-2mb` | **1.828** | 1.937 | 2.739 | **未达** Ir 2×（旧口误「已 ≥2×」以本表为准）；须保持并继续压 |
| `read:near-2000` | 1.290 | 1.736 | 1.886 | 目标 ≥2× |
| `read:near-50kb` | 1.050 | 1.981 | 1.564 | 目标 ≥2× |
| `ls:dir-2k` | 1.790 | 8.542 | 25.891 | Ir 未达 2×；soft/wall 已远超（展示） |
| `find:dir-2k` | **0.915** | 0.897 | 0.900 | 目标 ≥2×；现 **劣于** 官方 Ir |
| `grep:large-2mb` | 1.148 | 1.391 | 1.196 | 目标 ≥2× |

### 12.4.4 开工顺序（已执行完毕 · 归档）

1. `edit` / `write` / `read:small`（JS 热路径缺口最大或平手）。  
2. `read:boundary-lines` 与 `ls`：从 ~1.4× Ir 冲 2×（勿把 soft/wall 当已收工）。  
3. `bash` / `grep` / `find`：优先 **native 长生命周期 helper** 证据；ADR-0002 已拒持久 session 与 in-process grep/find（Ir）。  
4. 每批：parity → bench-ab → `/verify` → README/Page → commit/push **main**（无 branch/CI）。  
5. 若某工具经严肃尝试仍不可达：回写本表「硬顶」行 + ADR，标例外，**不**编倍数。

### 12.4.5 硬约束

- 不改官方 pin `86dc686`；不碰 `powershell`。  
- 不破坏已有相对领先（如 `ls` soft/wall、boundary 截断胜）除非 suite 净胜有证据。  
- 未过 `/verify` 不宣称；Page/README **只贴实测**。

### 12.4.6 收工对照（v0.3.4 · 实测 `results/bench-linux*.json` · 2026-10-31 14:05/14:07 CST）

| 项 | 内容 |
|---|---|
| **落地** | `bin/harness-helper` + `native/harness-helper/`（forbidUnsafe）；lab fast = native `ir-worker`；runtime = `serve` JSONL；见 ADR-0003 |
| **小套件（硬验收）** | **八行全部 Ir ≥2.0×**；min **bash 2.50×** / **find 2.30×**；suite sum **4.915×**（off `2111834999` → fast `429680804`） |
| **小套件逐工具 Ir×** | read:small **293.79×**；boundary-lines **11.07×**；bash **2.50×**；edit **285.39×**；write **326.14×**；grep **4.86×**；find **2.30×**；ls **12.24×** |
| **大套件（跟踪）** | suite sum **~1.72×**；**并非全部 ≥2×**：large-2mb **1.97×**、ls:dir-2k **1.37×**、find:dir-2k **1.62×**、grep:large-2mb **1.53×**；near-2000 **14.72×**、near-50kb **13.05×** |
| **诚实注** | 空 Node worker ≈110M Ir → Node-only 理论 ≤~1.2×；≥2× 依赖 native lab worker。softCpu/wall 非门；write softCpu 可能显示更差 |
| **门禁** | parity PASS + `/verify` PASS（含 ADR-0003、forbid-unsafe、count-ratchet）后才宣称 |

