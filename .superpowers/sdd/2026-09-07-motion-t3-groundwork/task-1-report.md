# Task 1 报告：`authClient` 移出首屏

## 状态

完成。Step 1–3、5 全部执行并通过；Step 4（浏览器实测登出）按 brief 要求跳过，留给控制者。

## Step 1：改动前基线

```
root 首屏集 23 个文件 160.53 KB gz
   55.63  entry.client-B-5h7vmR.js
   27.52  jsx-runtime-hDT1Eiup.js
   19.93  dist-B5htWCvE.js
   11.31  errorBoundaries-DdXcpLF8.js
   10.65  auth-client-e0WVfnyZ.js
    8.52  root-BoCx8Z8a.js
```

与 brief 期望（约 161 KB、23 个文件，`auth-client-*.js` 约 10.7 KB）一致。

## Step 2：改动

`apps/web/app/components/site-header.tsx`：删掉顶层 `import { authClient } from '~/lib/auth-client'`；`logout()` 内改为动态 `const { authClient } = await import('~/lib/auth-client')`，其余逻辑不变（含注释，按 brief 原文落地）。

构建时出现一条信息性警告：

```
[INEFFECTIVE_DYNAMIC_IMPORT] app/lib/auth-client.ts is dynamically imported by
app/components/site-header.tsx but also statically imported by app/routes/login.tsx,
app/routes/register.tsx, dynamic import will not move module into another chunk.
```

含义：由于 login/register 已经静态 import 了 `auth-client`，打包器把它归入这两个路由自己的 chunk，而不是单独为 `site-header` 的动态 import 再切一个 chunk——这正是我们要的结果（复用已有 chunk，异步加载，不进 root 首屏集），Step 3 的测量证实了这一点，不是需要修的问题。

## Step 3：改动后测量

```
root 首屏集 22 个文件 149.99 KB gz
   55.63  entry.client-D261O9VY.js
   27.52  jsx-runtime-hDT1Eiup.js
   19.93  dist-B5htWCvE.js
   11.32  errorBoundaries-Cul_ekXD.js
    8.64  root-MVHeghrQ.js
    8.36  utils-DojpP95n.js
```

`auth-client-*.js` 已不在列表里。`grep -rn "auth-client" apps/web/app` 确认只剩 `login.tsx`、`register.tsx`（各自路由 chunk）和 `site-header.tsx`（动态 import 那一行）三处引用，没有其他 root 树模块引入它。

**差值**：160.53 KB → 149.99 KB，**降低 10.54 KB gz**（文件数 23 → 22），与 brief 期望的「降到约 150.5 KB」基本吻合。

## Step 4：浏览器实测

跳过——按 brief 要求，这一步留给控制者用 Browser pane 验证（登录后点头像菜单登出，确认会话结束、无控制台错误）。

## Step 5：门禁与提交

- `bun run check` → `biome check .`：Checked 188 files，无需修复
- `bun run typecheck`（turbo，6 个包）：全部通过（4 cached + 1 executed）
- `cd apps/web && bun test`：13 pass / 0 fail
- 提交：`74a7f04 perf(web): authClient 改动态 import，根集减重 10.7 KB gz`（含 brief 原文 commit message，末尾 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`）

## 顾虑

无自行扩大改动范围的情况——`auth-client-*.js` 已成功移出首屏集，无需 grep 排查「仍在列表里」的分支。唯一需要控制者留意的是 Step 4 浏览器实测本身尚未做。

---

# Task 1.1 修正报告：登出失败兜底

## 问题

代码审查后发现：动态 import 引入了顶层 import 不存在的失败模式——部署后老页面还开着、chunk 哈希已变，点登出时 `await import(...)` 会 404 抛异常，按钮什么都不做。

## 修法（控制者裁定）

`apps/web/app/components/site-header.tsx` 的 `logout()` 加上 try/catch/finally：
- try：动态 import 和 signOut
- catch：记录错误（`console.error`），**不 rethrow**（从 async onClick 抛出是 unhandled rejection，React 接不住）
- finally：仍然 `revalidate()`（失败时 UI 会如实显示「仍处于登录态」）

## 修改行数

- 第 42–65 行：添加完整的 try/catch/finally 包装和扩展注释
- 总计增加 12 行、删除 2 行

## 验收

```
✓ bun run check                    Checked 189 files, no fixes needed
✓ bun run typecheck               6 packages all pass
✓ cd apps/web && bun test         13 pass / 0 fail
✓ cd apps/web && bun run build    Built successfully
✓ bun run check-bundle-size       首屏集 150.65 KB / 预算 155 KB（22 个文件）
                                  单路由最重 251.02 KB / 预算 270 KB
```

首屏数字 150.65 KB 与改动前 149.99 KB 基本一致（try/catch 增加约百字节）。

## grep 确认

```
53:     * **finally 里仍然 revalidate**：登出失败时它会如实显示「仍处于登录态」，
57:      const { authClient } = await import('~/lib/auth-client')
62:      revalidator.revalidate()
```

## 提交

```
f434750 fix(web): 登出的动态 import 补上失败兜底
```

## 顾虑

无。try/catch/finally 结构是标准防守模式，finally 中保留 revalidate 确保真实状态展示，测试与构建全绿。
