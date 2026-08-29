# M3 香霖堂设计调研（2026-08-30）

9 个 agent 的并行调研产物：4 份 legacy 代码挖掘 + 3 份方案设计 + 2 份对抗审查。

**这些是原始材料，不是决定。** 正式的 M3 范围与实施步骤见
`docs/superpowers/plans/2026-08-30-m3-kourindou.md`，它采纳了审查意见后大幅收敛了设计。

| 文件 | 内容 | 价值 |
|---|---|---|
| `mined-schema.md` | legacy thdl 13 张表的逐字段提取与缺陷分析 | 高：记录了 legacy 的真实结构与它踩过的坑 |
| `mined-upload.md` | B2 预签名/分片上传链路全流程 | 高：移植参考 |
| `mined-api.md` | legacy 各端点的业务逻辑与权限模型 | 高：移植参考 |
| `mined-ui.md` | 页面信息架构与组件交互 | 中 |
| `designs-schema.md` | 新 schema 提案（24 张表） | 中：已被审查判定过度设计，采纳时大幅削减 |
| `designs-api.md` | API 契约提案（58 条路由） | 中：同上 |
| `designs-plan.md` | 23 个 Task 的拆解提案 | 中：同上 |
| `critiques-gaps.md` | **缺口与错误审查，6 个 P0** | 极高：发现了 id schema 类型错误、GC 会删光封面等致命缺陷 |
| `critiques-simplify.md` | **过度设计审查，D1-D10 削减建议** | 极高：28 张表 → ~12，58 条路由 → ~35，砍掉整条 multipart |

设计方案的代码草稿曾被 agent 直接写进仓库（`packages/db/src/schema/kourindou.ts` 等），
因未经评审且含上述 P0 缺陷，已于 commit 582d02c 撤回。草稿内容保留在
`designs-schema.md` / `designs-api.md` 中。
