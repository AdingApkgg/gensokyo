# 邮箱验证、Google 登录与找回密码 —— 设计

> 2026-09-11 ／ 状态：待实施
>
> 范围：邮件发送层、邮箱验证（6 位 OTP）、「验证后才能写」的强制闸、Google 登录与
> 账号撞车仲裁、找回密码。
>
> **邀请码不在本次范围内。** 讨论中确认它的定位是「用户邀请用户的归因边，以后可能
> 给好处」，不是准入门槛，因此 `registrationOpen` 保持布尔、注册保持开放。归因边的
> 形态（永久推荐码 vs 一次性配额码）未定，留待单独立项。

## 目录

1. [决策摘要](#1-决策摘要)
2. [邮件层](#2-邮件层)
3. [邮箱验证流程](#3-邮箱验证流程)
4. [写闸与老账号迁移](#4-写闸与老账号迁移)
5. [Google 登录](#5-google-登录)
6. [找回密码](#6-找回密码)
7. [测试与门禁](#7-测试与门禁)
8. [已知取舍与后续](#8-已知取舍与后续)

---

## 1. 决策摘要

| 决策 | 取值 | 理由 |
|---|---|---|
| 验证卡在哪一步 | **验证后才能写，但能登录能看** | 邮件通道挂了不会把全站拖下水；老账号不会被锁在门外 |
| 邮件里发什么 | **6 位数字验证码**（`emailOTP` 插件） | 跨设备（手机收信、电脑输码）天然成立；不怕企业邮箱的链接预抓取烧掉一次性 token |
| 发信通道 | **Resend HTTP + 通用 SMTP 两个实现，env 选**，另有 console 通道给 dev/测试 | 国内邮箱送达率是真实风险，换服务商时只改环境变量 |
| 撞车仲裁 | **本地已验证 → 自动合并；未验证 → Google 抢过来** | 能证明邮箱所有权的人获胜，这是唯一合理的仲裁 |
| 强制点 | **`requireVerified` 中间件 + 运行时自省门禁** | 失败模式最可诊断：门禁红了会指名哪个路由 |
| 老账号 | **一律刷成已验证** | 新规矩只管新人；那些账号本来就能写，没有变差 |
| 找回密码 | **做**（`emailOTP` 的 `forget-password`） | 与撞车仲裁天然自洽，见 §6 |

### 本次工作的四条不变式

1. **未验证账号不持有任何对外可见的内容。** 这条是 §5 抢注仲裁能成立的前提——
   仲裁敢动那个账号，正因为它按定义什么都没有。
2. **「验证后才能写」只有一个强制点**：`requireVerified`（以及隐含它的 `requireRole`）。
   新增任何非 GET 路由必须回答「它挂的是哪一个」，`check-write-guard` 把这条钉成断言。
3. **注册开关只有一个强制点**：`user.validateUserInfo` 的 `create-user` 分支。它横跨
   每一种认证方式，所以「加了新登录方式要记得再判一次」这件事不再存在。
4. **mail 模块不在模块顶层读 env。** 见 §2 的警告。

---

## 2. 邮件层

### 2.1 模块布局

```
apps/api/src/mail/
  index.ts               sendMail(msg): Promise<void> —— 唯一出口
  transports/resend.ts   一个 fetch 打 api.resend.com，零依赖
  transports/smtp.ts     nodemailer
  transports/console.ts  把验证码打到 stdout —— dev 与测试的默认
  templates/otp.ts       三语文案
```

`Mail = { to: string; subject: string; text: string; html: string }`。

`sendMail` 是图片上传那条约定的同构物：**发信只有一个入口，别再写第二份 fetch**
（参照 `lib/upload.ts` 的 `uploadImage()`）。

### 2.2 环境变量与分支校验

`MAIL_TRANSPORT` 取 `'resend' | 'smtp' | 'console'`，默认 `console`。用 zod 的
discriminated union 按它分支：

- `resend` 分支要求 `RESEND_API_KEY`
- `smtp` 分支要求 `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE`
- `console` 分支不要求任何一项
- 三个分支共同要求 `MAIL_FROM`（形如 `幻想乡 <noreply@example.com>`）

选了 `resend` 却没给 key 时，**进程在监听端口之前就炸**，而不是等到第一个人注册。
这正是 `apps/api/src/env.ts` 开头那段承诺的东西。

### 2.3 ⚠️ mail 模块不能在模块顶层读 env

`env.ts` 自己的注释写着「只在 `index.ts` 里 import 它，别在 `app.ts` 里——测试导入的
是 app，不该因为少一个生产变量就整套跑不起来」。

而 mail 会被 `auth.ts` 引用、`auth.ts` 被 `app.ts` 引用。若 mail 在模块顶层解析 env，
**整个 api 测试套件会因为缺 `RESEND_API_KEY` 而起不来**，且症状表现成「测试挂了」，
没人会想到是邮件模块。

因此：transport 的选择与凭据解析**推迟到 `sendMail()` 第一次调用时**（惰性单例）。

### 2.4 邮件语言

界面语言由用户在站内选，与浏览器语言经常不一致（在日文站浏览的中文用户是常态），
所以**刻意不读 `Accept-Language`**。

- web 的 `authClient` 全局带 `X-Gensokyo-Locale: getLocale()` 头
- api 从 `sendVerificationOTP(data, ctx)` 的 `ctx.request` 读
- 回落顺序：该头 → Paraglide 的 locale cookie（vite 配置里 strategy 含 `'cookie'`）→ `zh`

这与 CLAUDE.md 已有的「UGC 的语言按写它的人当时的界面语言归档」是同一条原则。

**三语齐全靠类型顶**：模板是 `Record<Locale, (otp: string) => { subject, text, html }>`，
漏一种语言是编译错误。`check-messages` 扫的是 `apps/web/messages`，管不到 api 侧。

---

## 3. 邮箱验证流程

### 3.1 插件配置

```ts
emailOTP({
  otpLength: 6,
  expiresIn: 600,            // 10 分钟。默认 300 对「切到手机收信再切回来」偏紧
  allowedAttempts: 3,
  sendVerificationOnSignUp: true,
  storeOTP: 'hashed',        // ⚠️ 默认 'plain'
  disableSignUp: true,       // ⚠️ 默认 false
  sendVerificationOTP: ({ email, otp, type }, ctx) =>
    sendMail(renderOTP(localeOf(ctx), type, otp, email)),   // → §2
})
```

两项默认值必须显式改掉，理由各自独立：

- **`storeOTP: 'hashed'`**：默认 `'plain'` 会让验证码**明文躺在 `verification` 表里**。
  任何拿到只读库权限的人可以直接读出任何人当下的验证码。
- **`disableSignUp: true`**：默认 `false` 时，`sign-in` 类型的 OTP 在邮箱不存在时会
  **自动建号**——那等于凭空开出第二条完全绕过注册开关的注册路径。我们只用
  `email-verification` 与 `forget-password` 两种类型。

**不开 `requireEmailVerification`**：那会挡住登录，与「能登录能看」相反。

### 3.2 `/verify`：注册后的补全页

新增 web 路由 `/verify`（照旧走 `:locale?` 前缀），两段式：

1. 输验证码（`emailVerified` 已为真则跳过）
2. 认领 handle（`handleSetAt` 非 null 则跳过）

两段都完成就跳 `next`。这同时补上一个缺口：**Google 注册的用户从没经过
`register.tsx`**，那套「注册成功后立刻认领 handle」的一次性机会在 OAuth 路径上
根本不存在。`/verify` 让两类用户落到同一个补全页。

写操作被 403 挡住时，前端也把人引到这里。

`register.tsx` 相应简化：`signUp` 成功 → `navigate('/verify?next=…')`，认领 handle 那段
从注册页移走（连同那个 `registered` 状态位与「只认领不重跑 signUp」的处理）。

### 3.3 分步推进逻辑抽成纯函数

`/verify` 该显示哪一段，是 `{ emailVerified, handleSetAt, next }` 到
`'otp' | 'handle' | 'done'` 的纯映射。抽成 `app/lib/verify-step.ts` 并写单测，
照 `lib/discussion-nav.ts` 的 `replyTarget` 的先例。web 侧已接 `bun test` 且**进 CI**。

---

## 4. 写闸与老账号迁移

### 4.1 `requireVerified`

落在 `middleware/require.ts`，与 `requireAuth` / `requireRole` 同构。

它需要 `Actor` 上有 `emailVerified`——**不用查库也不用改表**：`sessionMiddleware`
已经拿着 `session.user`，`emailVerified` 是 better-auth 的核心字段，直接搬进 `Actor`。

新错误码 `email_unverified` 进 `errors.ts` 的 `ERROR_CODES` 白名单，配三语文案
（前端按 `error.code` 查 Paraglide，api 不返回人类可读消息）。

**`requireRole` 一并隐含「已验证」。** 一行的事，而且让门禁规则变干净：非 GET 路由
必须出现 `requireVerified` 或 `requireRole`，两者都保证已验证。

### 4.2 端点清单（18 个写 + 3 个内务）

判据是「是否产出对外可见的内容」。

**要 `requireVerified`（18）**

| 模块 | 端点 |
|---|---|
| shrine | `POST /topics`、`DELETE /topics/:id`、`POST /topics/:id/posts`、`PATCH /posts/:id`、`DELETE /posts/:id` |
| kourindou | `POST /resources`、`PATCH /resources/:id`、`PATCH /resources/:id/translations`、`POST /resources/:id/submit`、`POST /resources/:id/status`、`PATCH /resources/:id/license`、`POST /resources/:id/versions` |
| interactions | `PUT /resources/:slug/rating`、`PUT /resources/:slug/favorite`、`DELETE /resources/:slug/favorite` |
| reports | `POST /` |
| uploads | `POST /image` |
| me | `PUT /handle` |

**保留 `requireAuth`（3，登录即可）**

`GET /me`、`GET /notifications`、`POST /notifications/read`。

`PUT /me/handle` **2026-09-11 复审改判**、从这一侧挪进了上面的 18：原判据「未验证
账号拿不出任何内容挂在标识符下面」（见 §1 不变式 1）说的是**安全**——不挂闸不会
立刻造成可见的滥用，但不等于**必须不挂闸**。handle 在这套系统里不可逆（进
`/u/:handle`、进已发布正文的纯文本 @mention），而挂上 `requireVerified` 不挡住任何
真实用户：`/verify` 页面本来就是「验证 → 认领」顺序两步，Google 注册的用户邮箱
天生已验证。没有一条合法流程需要在未验证状态下认领 handle，挂闸唯一挡住的是
绕开 `/verify` 页面、直接打接口抢注一个拿不回来的公开标识符。

`moderation` / `admin` 由 `requireRole` 覆盖。

### 4.3 门禁：运行时自省，不扫源码

`scripts/check-write-guard.ts`：

1. `import { app }`，枚举 `app.routes`
2. 按 `method + path` 分组（Hono 对 `.post(path, mw1, mw2, handler)` 会为链上每一环
   注册一条同 method+path 的条目）
3. 对每个 method ∉ {GET, HEAD, OPTIONS} 的分组，断言组内某条目的 `handler` 是守卫
   函数——用 `require.ts` 里一个 `WeakSet` 标记，做**身份比对**而非名字匹配
   （`requireRole('admin')` 每次调用产生新函数，只能靠 WeakSet 认）
4. 豁免名单在脚本顶部，形如 `'POST /api/notifications/read'`

身份比对让改路径、改文件、改写法都不会让门禁失灵，而正则会。

> **实施第一步必须先验证前提**：`app.routes` 是否包含通过 `.route()` 挂载的子应用的
> 中间件条目（`moderation` / `admin` 靠 `.use('*', requireRole(...))`）。**验证不过就
> 退回扫源码**，不要等写完才发现。这条列为计划的第一个任务。

CI（`.github/workflows/ci.yml`）加一步 `check-write-guard`。

### 4.4 老账号迁移

一条 drizzle 迁移：`UPDATE "user" SET email_verified = true`。

它跑在部署流程的 `migrate` 步骤（在 `up -d` 之前），那一刻之前的账号全部既往不咎，
之后注册的才受新规矩管。迁移跑完到新代码上线之间的窗口里跑的是旧代码，不检查
验证，无害。

必须覆盖到的两类账号：站长本人，以及 `shrine@example.com`——六篇引导帖和站规都
挂在它名下。

---

## 5. Google 登录

### 5.1 配置

```ts
socialProviders: { google: { clientId: …, clientSecret: … } }
```

env 新增 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（进 `env.ts` 启动校验）。
回调地址是 `${BETTER_AUTH_URL}/api/auth/callback/google`，开发与生产各登记一条。

### 5.2 注册开关挪家

从现在的「`hooks.before` 拦 `/sign-up/email` 路径」挪到：

```ts
user: {
  validateUserInfo: async ({ source }) => {
    if (source.action !== 'create-user') return
    if (await registrationOpen()) return
    return { error: 'REGISTRATION_CLOSED' }
  },
}
```

这个钩子「在 `create-user` / `link-account` / OAuth 的 `sign-in` 之前触发，**横跨每一种
认证方式**」。`auth.ts` 里那段「将来加社交登录时它的注册路径要另判，这里不会自动
覆盖」的注释可以删掉——新写法让「另判」这件事不再存在。这是把 Google 的洞从
「再加一个路径判断」改成「把判断挪到必经之处」。

> ⚠️ **错误形状会变，前端判据要实测。** `register.tsx` 现按
> `err.code === 'REGISTRATION_CLOSED' || err.status === 403` 判。文档说
> `validateUserInfo` 返回 `{ error }` 时「浏览器流程重定向到错误页，程序化流程给
> 403」。403 还在，`code` 是否仍是原值**必须实测确认**，别默认前端不用改。

### 5.3 撞车仲裁

```ts
account: {
  accountLinking: {
    enabled: true,
    trustedProviders: ['google'],
    requireLocalEmailVerified: false,   // 把仲裁权接管过来
  },
}
```

仲裁挂在 **`databaseHooks.account.create.after`**，即「链接成功之后」。这样
**不存在「密码删了但 Google 没接上」的锁死**。

条件精确得出奇——因为 better-auth 把 `emailVerified = true` 写在 `linkAccount`
**之后**，所以 `after` 钩子跑的时候它还是 false：

| 情形 | `emailVerified` | 有 credential 行 | 动作 |
|---|---|---|---|
| Google 建的新号 | true（Google 给的） | 无 | 不动 |
| 本地已验证 + 接上 Google | true | 有 | 不动（密码保留，两边都是本人） |
| **本地未验证（抢注）** | **false** | **有** | 删 credential 行 + **吊销该 user 全部会话** |

判据落成一行：`providerId === 'google'` 且该 user 此刻 `emailVerified === false`
且它有一行 `credential` account。

**吊销会话不能省**：抢注者很可能正登录着。

「全部会话」就是字面意思，不需要「排除当前会话」——`handleOAuthUserInfo` 在
`linkAccount` 之后才 `createSession`，所以钩子跑的时候本次登录的会话**还不存在**。
误以为要保留当前会话而去写排除逻辑，只会排除掉一个 null。

> ⚠️ **`requireLocalEmailVerified` 已标 deprecated**，源码注释写明下个小版本会变成
> 无条件。升级 better-auth 后这段仲裁失效，行为退回「拒绝链接」——是**朝安全方向
> 的退化**，不是开天窗，但未验证用户会卡住。**要有测试钉住它，升级时会红。**

### 5.4 UI

`login.tsx` 与 `register.tsx` 各加一个「用 Google 继续」，走
`authClient.signIn.social({ provider: 'google', callbackURL })`。

- **不引图标包**，内联 SVG（根集有预算，见 CLAUDE.md）。改完跑 `check-bundle-size`。
- `callbackURL` 统一指 `/verify`，由该页自己判断两段是否都已完成、完成就立刻跳走。
  **不依赖 `newUserCallbackURL`**，少一个待确认的 API 面。
- 新增的 `<Link>` 一律带 `viewTransition`（全站约定，没有门禁能抓）。

---

## 6. 找回密码

### 6.1 内置、不用写的部分（已在源码核过）

- `POST /email-otp/request-password-reset`：邮箱不存在时**照样返回 `{success:true}`**，
  还顺手清掉刚建的 verification 行——**枚举防护是内置的**。
  （旧的 `/forget-password/email-otp` 已 deprecated，不要用）
- `POST /email-otp/reset-password`：校验 OTP → 改密码。
- 重置成功后**自动把 `emailVerified` 置 true**。逻辑正确：能读到那封信就是证明了
  邮箱所有权。这顺带给了「验证邮箱」第二条合法路径。
- 用户没有 credential 行时**自动创建一行**。

### 6.2 与 §5 天然自洽

上面最后一条正好接上抢注仲裁：被 Google 仲裁删掉密码的人可以用找回密码把密码
装回来，而抢注者读不到那个邮箱，走不了这条路。**两个功能不需要额外的协调设计。**

### 6.3 必须显式写的配置

```ts
emailAndPassword: { revokeSessionsOnPasswordReset: true }   // ⚠️ 默认 false
```

找回密码的典型场景就是「怀疑号被盗」。不吊销会话等于没找回。

这是第三个「默认值不对、必须显式写」的项（前两个是 `storeOTP` 与 `disableSignUp`）。
三个凑在一起说明一件事：**这个插件的默认值是为「快速跑通」调的，不是为生产调的**，
所以配置块里每一项都要能说出为什么。

### 6.4 必须自己补：按邮箱限流

插件自带的 `rateLimit` 是 `pathMatcher` + better-auth 核心的**按 IP** 计数。它挡不住
「换 IP 轰炸同一个受害者邮箱」——这个攻击不需要账号、不需要拿到任何验证码，
每一发都真实投递进受害者信箱，还直接烧掉发信额度。

实现很便宜，且不用建新索引：

- `resolveOTP` **每次都 INSERT 一行新的** `verification`（只在唯一冲突时才删旧重插）
- `identifier` 形如 `forget-password:<email>`，`createdAt` 齐全
- **`verification_identifier_idx` 索引已经存在**

所以「按 identifier 数最近一段时间的行」是精确的，约 15 行。这与 `rate.ts` 开篇
「用 SQL 数已有的行，不维护计数器」是同一条原则。

沿用 `rate.ts` 的「冷却窗 + 小时配额」双层形状，取值：**冷却 60 秒、每小时 5 次**。
冷却窗管的是连点重发，配额管的是顺序轰炸；正常人在一小时里不会向同一个邮箱
要第六次验证码。

⚠️ **挂载点与错误形状**：这些是 better-auth 的路由，**不经过我们的 `fail()` 信封**，
所以 `ERROR_CODES` 里的 `rate_limited` 在这里用不上。这一层要挂成 `hooks.before`
并 `throw new APIError('TOO_MANY_REQUESTS', { code: 'RATE_LIMITED' })`——与现有那道
注册开关钩子同一个机制（`auth.ts` 里已有 `throw new APIError('FORBIDDEN', …)` 的
先例）。前端在 authClient 侧按 `err.code` 查 Paraglide 文案，与 api 侧的错误码
体系是两套，**不要试图统一**。

实施时需确认一点：`createAuthMiddleware` 的 ctx 能否读到已解析的 `body.email`
（现有钩子只用了 `ctx.path`）。读不到就退回在 `sendVerificationOTP` 回调里做——
但那里插件用 `runInBackgroundOrAwait` 调用，抛错未必能传回客户端，届时限流
只能表现为「静默不发信」。**优先走 `hooks.before`。**

同一层同时套在 `email-verification` 类型上（重发验证码是同一个轰炸面）。

> `rate.ts` 已列的两条已知限制（先查后写无互斥、只数落库的行）在这里同样成立。
> 这一层挡的是顺序轰炸，不是并发轰炸。

### 6.5 UI

新增 web 路由 `/forgot`，两段式：填邮箱 → 输码并设新密码。`login.tsx` 加入口。
分步逻辑同样抽纯函数写单测。

---

## 7. 测试与门禁

有个结构性事实值得说破：**api 测试刻意不进 CI**（要真实的 pg/redis/Meili/MinIO）。
所以 `check-write-guard` 是这整块工作里**唯一能在 CI 跑的保障**——这反过来证明
§4.3 那条门禁值得做。

| 层 | 内容 | 进 CI |
|---|---|---|
| api | transport 选择；三语模板齐全；未验证账号打 18 个写端点全 403、3 个内务端点 200；Google 撞车三种情形各一条；按邮箱限流 | 否 |
| web | `/verify` 与 `/forgot` 的分步推进纯函数；`ErrorText` 的「拒绝必须有出路」渲染断言 | **是** |
| 门禁 | `check-write-guard`、`check-messages`、`check-bundle-size` | **是** |
| e2e | 现有 40 项后接「注册 → 取码 → 验证 → 发帖」与「未验证不能写」 | 否 |

⚠️ e2e 那一格**与设计时写的不一样，且新的这对更好**：原计划第二条是「找回
密码」，实际接的是「未验证账号发帖 → 403 `email_unverified`」。理由是这两条
恰好夹住本里程碑的承诺——一条验正门开着（验证完能发），一条验闸真的落着
（没验证发不出去）。而「找回密码」的关键性质（限流命中与邮箱未注册外部
不可区分、被限流时手里那个码仍然有效）是**状态码与响应体逐字节比对**，
e2e 这种「跑通就算过」的形状验不了它，那些断言在 `otp-rate.test.ts` 里。

api 测试一律接 `apps/api/src/testing.ts` 的 `cleanupTracked`——测试打的是共享开发库，
不是一次性容器。新建账号的清理要注意 `report.reporter_id` 是 ON DELETE SET NULL
的老问题。

console transport 让验证码能从 stdout 取到，这是它存在的第二个理由（第一个是
「别在 dev 往真实邮箱发信」）。

---

## 8. 已知取舍与后续

### 8.1 单列的可选任务：redis 接 `secondaryStorage`

`REDIS_URL` 已在 `.env`、`bun run services` 也在起它，但**全仓零处使用**。
better-auth 的限流默认存进程内存，多进程部署下等于各算各的，接上 redis 是它的
第一个合理用途。

**但这会让 redis 从「装了没用」变成「挂了影响登录」**，是一次真实的依赖升级。
因此单列成可选任务，不混进主线。

### 8.2 不做的事

- **邀请码**：见开头。定位已明确（归因边，非门槛），形态未定，单独立项。
- **账号设置页 / 主动绑定解绑 Google**：本次只做「登录时自动仲裁」。
- **Resend 的投递事件 webhook**：SMTP 通道拿不到它，两个通道行为不对称，
  等确定长期用哪个再说。

### 8.3 悬而未决、需在实施中确认的三点

1. ~~`app.routes` 是否包含挂载子应用的中间件条目（§4.3）~~ —— **2026-09-11 实测结案。**
   结论比原假设复杂：`app.routes` 确实拿得到（113 条），`r.handler === requireAuth`
   成立所以身份比对可行，且 `DATABASE_URL` 缺失时 import 不抛错所以能进 CI。
   **但子应用的 `.use('*', requireRole(...))` 是独立的 `ALL /api/admin/*` 条目，
   不会并进各路由自己的分组**——门禁必须对这类条目做前缀匹配，否则
   moderation / admin 下的 7 个写端点会被全部误报。实施计划已按实测形状写。
2. ~~`validateUserInfo` 拒绝时前端拿到的 `code` 形状（§5.2）~~ —— **2026-09-11 实测结案。**
   状态 403，body `{ code: 'REGISTRATION_CLOSED', message: 'REGISTRATION_CLOSED' }`——
   与原来的 `APIError` 形状相比，`code` 与 `status` 都不变，只有 `message` 从
   `'registration is closed'` 变成了与 `code` 相同的字符串（没传 `errorDescription`
   时 better-auth 回落成 `error` 本身，前端不读 `message`，不受影响）。`register.tsx`
   已经按 `err.code === 'REGISTRATION_CLOSED'` 判断，**不需要改动**。实测见
   `apps/api/src/auth.test.ts`「注册开关」describe 块里的实测值注释。
3. Resend 对国内邮箱（QQ / 163 / 126）的真实送达率。这是**产品风险不是实现风险**：
   故障模式是静默丢弃或进垃圾箱，而 Resend 后台显示 `delivered`——没有告警，
   表现为「一部分用户注册完就卡在验证页，且只有他们自己知道」。两个 transport
   的设计就是为了让换服务商只改环境变量。
