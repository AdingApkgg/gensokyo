# 邮箱验证 / Google 登录 / 找回密码 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给站点装上邮箱验证（6 位 OTP）、「验证后才能写」的强制闸、Google 登录与撞车仲裁、找回密码，并配一条能在 CI 跑的门禁防止新写端点漏挂。

**Architecture:** 发信收敛到 `apps/api/src/mail/` 一个出口，后面挂三个 transport（console / resend / smtp），由 env 分支选择且**惰性解析**。验证用 better-auth 的 `emailOTP` 插件，三个默认值必须显式改掉。「验证后才能写」落成 `requireVerified` 中间件，17 个写端点各挂一道，由 `scripts/check-write-guard.ts` 通过**枚举 `app.routes` 做函数身份比对**钉住。Google 的撞车仲裁挂在 `databaseHooks.account.create.after`，利用「better-auth 把 `emailVerified=true` 写在 `linkAccount` 之后、`createSession` 之前」这个顺序，一个条件分出三种情形。

**Tech Stack:** Bun、Hono、better-auth 1.7.2（`email-otp` 插件）、drizzle + Postgres、zod 4、React Router 8、Paraglide JS、nodemailer（仅 smtp transport）。

**Spec:** `docs/superpowers/specs/2026-09-11-auth-email-google-design.md`

## Global Constraints

以下每条都来自 spec 或 CLAUDE.md，**每个任务的要求都隐含包含本节**：

- **mail 模块禁止在模块顶层读 env。** 它被 `auth.ts` → `app.ts` 传递引用，测试导入的是 `app`。顶层读 env 会让整个 api 测试套件因缺 `RESEND_API_KEY` 而起不来，且症状表现为「测试挂了」。
- **三个 better-auth 默认值必须显式改掉**：`storeOTP: 'hashed'`（默认 `'plain'`）、`disableSignUp: true`（默认 `false`）、`emailAndPassword.revokeSessionsOnPasswordReset: true`（默认 `false`）。
- **不开 `requireEmailVerification`**——那会挡住登录，与「能登录能看」相反。
- **错误码走白名单**：api 侧新增码要进 `apps/api/src/errors.ts` 的 `ERROR_CODES`；前端按 `error.code` 查 Paraglide 文案，**api 不返回人类可读消息**。
- **better-auth 路由的错误信封与 `fail()` 是两套，不要试图统一。**
- **三语齐全**：`apps/web/messages/{zh,ja,en}.json` 三份都要加，改完跑 `bun run check-messages`。api 侧的邮件模板靠 `Record<Locale, …>` 的类型顶。
- **新增 `<Link>` / `<NavLink>` 一律带 `viewTransition`**（全站 34/35，没有门禁能抓）。
- **不引新的前端依赖**；Google 图标内联 SVG。改完 web 跑 `bun run check-bundle-size`。
- **api 测试一律从 `apps/api/src/testing.ts` 拿 `cleanupTracked`**，不要直接引 `@gensokyo/db/testing`。测试打的是共享开发库，不是一次性容器。
- **能抽成纯函数的判断就抽出来**，放 `packages/shared` 或 `apps/web/app/lib`——那两处的测试**进 CI**，api 的不进。
- 每个任务结束跑 `bun run check:fix` 再提交。
- 提交信息末尾加：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `apps/api/src/mail/config.ts` | mail 的 env schema（纯函数 `parseMailEnv`）+ 惰性单例 `mailConfig()` |
| `apps/api/src/mail/index.ts` | `sendMail()`——发信的唯一出口 |
| `apps/api/src/mail/transports/console.ts` | 打 stdout，dev 与测试默认 |
| `apps/api/src/mail/transports/resend.ts` | 一个 fetch 打 api.resend.com，零依赖 |
| `apps/api/src/mail/transports/smtp.ts` | nodemailer |
| `apps/api/src/mail/templates/otp.ts` | 三语 OTP 邮件模板 |
| `apps/api/src/auth/arbitrate.ts` | Google 撞车仲裁——抽出来才测得了 |
| `apps/api/src/otp-rate.ts` | 按邮箱的 OTP 限流（数 `verification` 表的行） |
| `packages/shared/src/request-locale.ts` | 从 header/cookie 挑界面语言的纯函数（测试进 CI） |
| `scripts/check-write-guard.ts` | 门禁：非 GET 路由必须挂守卫 |
| `apps/web/app/lib/verify-step.ts` | `/verify` 分步推进的纯函数（测试进 CI） |
| `apps/web/app/routes/verify.tsx` | 注册后的补全页（验证码 + handle 认领） |
| `apps/web/app/routes/forgot.tsx` | 找回密码 |
| `packages/db/drizzle/0009_*.sql` | 老账号刷成已验证 |

**修改**

| 文件 | 改动 |
|---|---|
| `apps/api/src/auth.ts` | emailOTP 插件、socialProviders.google、accountLinking、validateUserInfo、databaseHooks、限流钩子；**删掉原来的 `hooks.before` 路径闸** |
| `apps/api/src/env.ts` | 调 `parseMailEnv` + Google 凭据 |
| `apps/api/src/errors.ts` | `ERROR_CODES` 加 `email_unverified` |
| `apps/api/src/middleware/require.ts` | 新增 `requireVerified`、守卫 WeakSet；`requireRole` 隐含已验证 |
| `apps/api/src/middleware/session.ts` | `Actor` 加 `emailVerified` |
| `apps/api/src/modules/{shrine,reports,uploads,interactions}.ts`、`modules/kourindou/index.ts` | 17 处 `requireAuth` → `requireVerified` |
| `apps/web/app/lib/auth-client.ts` | 全局带 `X-Gensokyo-Locale` |
| `apps/web/app/routes/{login,register}.tsx` | Google 按钮；register 简化 |
| `apps/web/app/routes.ts` | 加 `verify` / `forgot` |
| `apps/web/messages/{zh,ja,en}.json` | 新增文案 |
| `.github/workflows/ci.yml`、`package.json` | 接 `check-write-guard` |

---

### Task 1: 邮件层骨架 —— `sendMail` 出口、env 分支、console transport

**Files:**
- Create: `apps/api/src/mail/config.ts`
- Create: `apps/api/src/mail/index.ts`
- Create: `apps/api/src/mail/transports/console.ts`
- Test: `apps/api/src/mail/config.test.ts`

**Interfaces:**
- Consumes: 无（本计划的第一个任务）
- Produces:
  - `type Mail = { to: string; subject: string; text: string; html: string }`
  - `sendMail(msg: Mail): Promise<void>`
  - `parseMailEnv(env: Record<string, string | undefined>): MailConfig`
  - `mailConfig(): MailConfig` / `resetMailConfig(): void`
  - `MailConfig` 是三分支联合，`transport` 字段取 `'console' | 'resend' | 'smtp'`

- [ ] **Step 1: 写失败的测试**

创建 `apps/api/src/mail/config.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { parseMailEnv } from './config'

describe('parseMailEnv', () => {
  test('不配 MAIL_TRANSPORT 时默认 console，且不要求任何凭据', () => {
    const cfg = parseMailEnv({})
    expect(cfg.transport).toBe('console')
  })

  test('console 分支不因为缺 RESEND_API_KEY 而失败', () => {
    // 这条钉的是「测试环境不该因为少一个生产变量就整套跑不起来」
    expect(() => parseMailEnv({ MAIL_TRANSPORT: 'console' })).not.toThrow()
  })

  test('resend 分支缺 RESEND_API_KEY 时抛错', () => {
    expect(() =>
      parseMailEnv({ MAIL_TRANSPORT: 'resend', MAIL_FROM: 'a <a@b.c>' }),
    ).toThrow()
  })

  test('resend 分支齐全时解析出 apiKey', () => {
    const cfg = parseMailEnv({
      MAIL_TRANSPORT: 'resend',
      MAIL_FROM: 'a <a@b.c>',
      RESEND_API_KEY: 're_xxx',
    })
    expect(cfg.transport).toBe('resend')
    if (cfg.transport === 'resend') expect(cfg.apiKey).toBe('re_xxx')
  })

  test('smtp 分支缺 SMTP_HOST 时抛错', () => {
    expect(() =>
      parseMailEnv({
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'a <a@b.c>',
        SMTP_PORT: '465',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      }),
    ).toThrow()
  })

  test('smtp 的 PORT 从字符串转成数字，SECURE 从字符串转成布尔', () => {
    const cfg = parseMailEnv({
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'a <a@b.c>',
      SMTP_HOST: 'smtp.resend.com',
      SMTP_PORT: '465',
      SMTP_USER: 'resend',
      SMTP_PASS: 'p',
      SMTP_SECURE: 'true',
    })
    if (cfg.transport !== 'smtp') throw new Error('分支判断错了')
    expect(cfg.port).toBe(465)
    expect(cfg.secure).toBe(true)
  })

  test('未知的 MAIL_TRANSPORT 抛错，不静默回落到 console', () => {
    // 静默回落会让生产上一个拼错的值表现成「邮件发不出去但没有报错」
    expect(() => parseMailEnv({ MAIL_TRANSPORT: 'sendgrid' })).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && bun test src/mail/config.test.ts`
Expected: FAIL，报 `Cannot find module './config'`

- [ ] **Step 3: 写 `apps/api/src/mail/config.ts`**

```ts
import { z } from 'zod'

/**
 * 邮件通道的环境变量。**按 MAIL_TRANSPORT 分支校验**——选了 resend 却没给
 * key，进程应该在监听端口之前就炸，而不是等到第一个人注册。
 *
 * ⚠️ **这个文件不在模块顶层读 `process.env`。** mail 会被 auth.ts → app.ts
 * 传递引用，而测试导入的正是 app；顶层读 env 会让整个 api 测试套件因为缺一个
 * 生产变量而起不来，且症状表现成「测试挂了」，没人会想到是邮件模块。
 * 真正的「启动即炸」由 `env.ts`（只被 index.ts import）调 parseMailEnv 达成。
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true')

const mailEnvSchema = z.discriminatedUnion('MAIL_TRANSPORT', [
  z.object({
    MAIL_TRANSPORT: z.literal('console'),
    // console 通道不投递到任何地方，from 只是打印出来好看
    MAIL_FROM: z.string().default('幻想乡 <noreply@localhost>'),
  }),
  z.object({
    MAIL_TRANSPORT: z.literal('resend'),
    MAIL_FROM: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
  }),
  z.object({
    MAIL_TRANSPORT: z.literal('smtp'),
    MAIL_FROM: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_USER: z.string().min(1),
    SMTP_PASS: z.string().min(1),
    SMTP_SECURE: bool,
  }),
])

export type MailConfig =
  | { transport: 'console'; from: string }
  | { transport: 'resend'; from: string; apiKey: string }
  | {
      transport: 'smtp'
      from: string
      host: string
      port: number
      user: string
      pass: string
      secure: boolean
    }

export function parseMailEnv(
  env: Record<string, string | undefined>,
): MailConfig {
  const raw = mailEnvSchema.parse({
    ...env,
    MAIL_TRANSPORT: env.MAIL_TRANSPORT ?? 'console',
  })
  switch (raw.MAIL_TRANSPORT) {
    case 'console':
      return { transport: 'console', from: raw.MAIL_FROM }
    case 'resend':
      return {
        transport: 'resend',
        from: raw.MAIL_FROM,
        apiKey: raw.RESEND_API_KEY,
      }
    case 'smtp':
      return {
        transport: 'smtp',
        from: raw.MAIL_FROM,
        host: raw.SMTP_HOST,
        port: raw.SMTP_PORT,
        user: raw.SMTP_USER,
        pass: raw.SMTP_PASS,
        secure: raw.SMTP_SECURE,
      }
  }
}

let cached: MailConfig | null = null

/** 惰性单例：第一次真正发信时才解析 env */
export function mailConfig(): MailConfig {
  if (!cached) cached = parseMailEnv(process.env)
  return cached
}

/** 测试用：换一组 env 重新解析 */
export function resetMailConfig(): void {
  cached = null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && bun test src/mail/config.test.ts`
Expected: PASS，7 条全绿

- [ ] **Step 5: 写 console transport 与 `sendMail` 出口**

创建 `apps/api/src/mail/transports/console.ts`：

```ts
import type { MailConfig } from '../config'
import type { Mail } from '../index'

/**
 * dev 与测试的默认通道。**它有两个职责，缺一不可**：
 *
 * 1. 别在开发时往真实邮箱发信；
 * 2. 让验证码能从 stdout 取到——`bun run e2e` 的注册链路靠这个读码。
 */
export async function sendViaConsole(
  cfg: MailConfig,
  msg: Mail,
): Promise<void> {
  console.info(
    `[mail:console] from=${cfg.from} to=${msg.to}\n  subject: ${msg.subject}\n  ${msg.text}`,
  )
}
```

创建 `apps/api/src/mail/index.ts`：

```ts
import { mailConfig } from './config'
import { sendViaConsole } from './transports/console'

export type Mail = {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * 发信的**唯一出口**。别再写第二份 fetch——与 `lib/upload.ts` 的
 * `uploadImage()` 是同一条约定。
 *
 * transport 在这里才解析（见 config.ts 顶部的说明）。
 */
export async function sendMail(msg: Mail): Promise<void> {
  const cfg = mailConfig()
  switch (cfg.transport) {
    case 'console':
      return sendViaConsole(cfg, msg)
    default:
      // resend / smtp 在 Task 2 接上
      throw new Error(`未实现的邮件通道：${cfg.transport}`)
  }
}
```

- [ ] **Step 6: typecheck 与 lint**

Run: `bun run typecheck && bun run check:fix`
Expected: 两者都通过

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/mail
git commit -m "feat(mail): 发信出口与 env 分支校验，先接 console 通道

mail 不在模块顶层读 env：它被 auth.ts → app.ts 传递引用，而测试导入的
正是 app，顶层读会让整个 api 测试套件因缺 RESEND_API_KEY 而起不来。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Resend 与 SMTP 两个真实通道 + 启动即炸

**Files:**
- Create: `apps/api/src/mail/transports/resend.ts`
- Create: `apps/api/src/mail/transports/smtp.ts`
- Modify: `apps/api/src/mail/index.ts`（补上两个分支）
- Modify: `apps/api/src/env.ts`（调 `parseMailEnv`）
- Modify: `apps/api/package.json`（加 `nodemailer`）
- Modify: `.env.example` 若存在，否则跳过
- Test: `apps/api/src/mail/transports/resend.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Mail`、`MailConfig`、`parseMailEnv`
- Produces:
  - `sendViaResend(cfg, msg): Promise<void>`
  - `sendViaSmtp(cfg, msg): Promise<void>`
  - `buildResendRequest(cfg, msg): { url: string; init: RequestInit }`（纯函数，为了可测）

- [ ] **Step 1: 装依赖**

```bash
cd apps/api && bun add nodemailer && bun add -d @types/nodemailer
```

说明：nodemailer 只进 api，**不进前端包**，与根集预算无关。

- [ ] **Step 2: 写失败的测试**

创建 `apps/api/src/mail/transports/resend.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import type { MailConfig } from '../config'
import { buildResendRequest } from './resend'

const cfg: MailConfig = {
  transport: 'resend',
  from: '幻想乡 <noreply@example.com>',
  apiKey: 're_test_key',
}
const msg = {
  to: 'reimu@example.com',
  subject: '验证码',
  text: '你的验证码是 123456',
  html: '<p>你的验证码是 <b>123456</b></p>',
}

describe('buildResendRequest', () => {
  test('打到 Resend 的 emails 端点', () => {
    expect(buildResendRequest(cfg, msg).url).toBe(
      'https://api.resend.com/emails',
    )
  })

  test('带 Bearer 授权头与 JSON content-type', () => {
    const { init } = buildResendRequest(cfg, msg)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer re_test_key')
    expect(headers['content-type']).toBe('application/json')
  })

  test('from 取配置的值而不是收件人域名', () => {
    const { init } = buildResendRequest(cfg, msg)
    const body = JSON.parse(String(init.body)) as { from: string; to: string[] }
    expect(body.from).toBe('幻想乡 <noreply@example.com>')
    expect(body.to).toEqual(['reimu@example.com'])
  })

  test('text 与 html 都带上', () => {
    // 只发 html 会让纯文本客户端与部分反垃圾评分吃亏
    const body = JSON.parse(
      String(buildResendRequest(cfg, msg).init.body),
    ) as Record<string, unknown>
    expect(body.text).toBe(msg.text)
    expect(body.html).toBe(msg.html)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd apps/api && bun test src/mail/transports/resend.test.ts`
Expected: FAIL，`Cannot find module './resend'`

- [ ] **Step 4: 写两个 transport**

创建 `apps/api/src/mail/transports/resend.ts`：

```ts
import type { MailConfig } from '../config'
import type { Mail } from '../index'

/**
 * 请求的构造抽成纯函数，这样不打网络就能测。
 * 零依赖：一个 fetch，不装 resend SDK。
 */
export function buildResendRequest(
  cfg: Extract<MailConfig, { transport: 'resend' }>,
  msg: Mail,
): { url: string; init: RequestInit } {
  return {
    url: 'https://api.resend.com/emails',
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [msg.to],
        subject: msg.subject,
        // 两种都发：只发 html 会让纯文本客户端与部分反垃圾评分吃亏
        text: msg.text,
        html: msg.html,
      }),
    },
  }
}

export async function sendViaResend(
  cfg: Extract<MailConfig, { transport: 'resend' }>,
  msg: Mail,
): Promise<void> {
  const { url, init } = buildResendRequest(cfg, msg)
  const res = await fetch(url, init)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[mail:resend] ${res.status} ${detail.slice(0, 200)}`)
  }
}
```

创建 `apps/api/src/mail/transports/smtp.ts`：

```ts
import { createTransport, type Transporter } from 'nodemailer'
import type { MailConfig } from '../config'
import type { Mail } from '../index'

let transporter: Transporter | null = null

/**
 * SMTP 通道存在的理由是**换服务商只改环境变量**：Resend 对国内邮箱
 * （QQ / 163 / 126）的送达率是真实风险，而那种失败是静默的——后台显示
 * delivered，用户那边什么都没收到。真出了问题，换成腾讯企业邮 / 阿里云
 * 邮件推送不需要改代码。
 *
 * 连接池复用一个 transporter：每封信重建连接会在发信高峰被服务商限速。
 */
export async function sendViaSmtp(
  cfg: Extract<MailConfig, { transport: 'smtp' }>,
  msg: Mail,
): Promise<void> {
  transporter ??= createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  })
  await transporter.sendMail({
    from: cfg.from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  })
}
```

- [ ] **Step 5: 在 `sendMail` 里接上两个分支**

把 `apps/api/src/mail/index.ts` 的 switch 改成：

```ts
import { mailConfig } from './config'
import { sendViaConsole } from './transports/console'
import { sendViaResend } from './transports/resend'
import { sendViaSmtp } from './transports/smtp'

export type Mail = {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendMail(msg: Mail): Promise<void> {
  const cfg = mailConfig()
  switch (cfg.transport) {
    case 'console':
      return sendViaConsole(cfg, msg)
    case 'resend':
      return sendViaResend(cfg, msg)
    case 'smtp':
      return sendViaSmtp(cfg, msg)
  }
}
```

- [ ] **Step 6: 让缺配置在启动时炸**

在 `apps/api/src/env.ts` 末尾追加（**不要**把 mail 的键塞进那个 `z.object`——分支校验塞不进去）：

```ts
import { parseMailEnv } from './mail/config'

/**
 * 邮件通道的校验单独跑：它是三分支联合，塞不进上面那个扁平 object。
 * 放在这里意味着它与 DATABASE_URL 们享受同一条承诺——**缺配置在监听端口
 * 之前就炸**。而 mail 模块自己仍然是惰性的，测试不受影响。
 */
export const mailEnv = parseMailEnv(process.env)
```

- [ ] **Step 7: 跑测试与 typecheck**

Run: `cd apps/api && bun test src/mail/ && cd ../.. && bun run typecheck && bun run check:fix`
Expected: 全绿

- [ ] **Step 8: 验证「启动即炸」真的生效**

Run:
```bash
cd apps/api && MAIL_TRANSPORT=resend bun run --env-file=../../.env src/index.ts
```
Expected: 进程立刻抛 zod 错误并退出，消息里点名 `RESEND_API_KEY`；**不会**打印监听端口。

> 若 `.env` 里已经配了 `RESEND_API_KEY`，改用 `MAIL_TRANSPORT=resend RESEND_API_KEY= bun run …` 制造缺失。

- [ ] **Step 9: 提交**

```bash
git add apps/api/src/mail apps/api/src/env.ts apps/api/package.json bun.lock
git commit -m "feat(mail): 接上 Resend HTTP 与通用 SMTP 两个通道

两个通道并存不是过度设计：Resend 对国内邮箱的送达率是真实风险，而那种
失败是静默的（后台显示 delivered，用户什么都没收到）。SMTP 通道让换服务商
只改环境变量。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 界面语言解析（纯函数，测试进 CI）+ 三语 OTP 模板

**Files:**
- Create: `packages/shared/src/request-locale.ts`
- Create: `packages/shared/src/request-locale.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/mail/templates/otp.ts`
- Create: `apps/api/src/mail/templates/otp.test.ts`
- Modify: `apps/web/app/lib/auth-client.ts`

**Interfaces:**
- Consumes: Task 1 的 `Mail`
- Produces:
  - `readCookie(cookieHeader: string | null | undefined, name: string): string | null`
  - `pickRequestLocale(header: string | null | undefined, cookie: string | null | undefined): Locale`
  - `LOCALE_HEADER = 'x-gensokyo-locale'`
  - `type OtpPurpose = 'email-verification' | 'forget-password'`
  - `renderOtpMail(locale: Locale, purpose: OtpPurpose, otp: string, to: string, minutes: number): Mail`

- [ ] **Step 1: 写 shared 侧失败的测试**

创建 `packages/shared/src/request-locale.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { pickRequestLocale, readCookie } from './request-locale'

describe('readCookie', () => {
  test('从 cookie 头里取出指定的键', () => {
    expect(readCookie('a=1; PARAGLIDE_LOCALE=ja; b=2', 'PARAGLIDE_LOCALE')).toBe(
      'ja',
    )
  })

  test('键不存在返回 null', () => {
    expect(readCookie('a=1', 'PARAGLIDE_LOCALE')).toBeNull()
  })

  test('前缀相同的别的键不会被误认', () => {
    // PARAGLIDE_LOCALE_OLD 不应该被当成 PARAGLIDE_LOCALE
    expect(readCookie('PARAGLIDE_LOCALE_OLD=en', 'PARAGLIDE_LOCALE')).toBeNull()
  })

  test('头为 null 或空串时返回 null', () => {
    expect(readCookie(null, 'x')).toBeNull()
    expect(readCookie('', 'x')).toBeNull()
  })
})

describe('pickRequestLocale', () => {
  test('显式头优先于 cookie', () => {
    expect(pickRequestLocale('ja', 'en')).toBe('ja')
  })

  test('没有头时回落到 cookie', () => {
    expect(pickRequestLocale(null, 'en')).toBe('en')
  })

  test('两者都没有时回落到 zh', () => {
    expect(pickRequestLocale(null, null)).toBe('zh')
  })

  test('不认识的值被忽略而不是原样透传', () => {
    // 'zh-TW' 不是我们的内容语种（简繁是显示层转换，库里只有 zh）
    expect(pickRequestLocale('zh-TW', null)).toBe('zh')
    expect(pickRequestLocale('klingon', 'ja')).toBe('ja')
  })

  test('大小写与空白不敏感', () => {
    expect(pickRequestLocale(' JA ', null)).toBe('ja')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && bun test src/request-locale.test.ts`
Expected: FAIL，`Cannot find module './request-locale'`

- [ ] **Step 3: 写 `packages/shared/src/request-locale.ts`**

```ts
import { LOCALES, type Locale } from './localized'

/** 显式头。**刻意不用 `Accept-Language`** —— 见下。 */
export const LOCALE_HEADER = 'x-gensokyo-locale'

/** Paraglide 的 cookie 策略写的键（vite 配置里 strategy 含 'cookie'） */
export const LOCALE_COOKIE = 'PARAGLIDE_LOCALE'

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/**
 * 决定一封邮件用哪种语言写。
 *
 * **不读 `Accept-Language`**：那是浏览器语言，不是用户在站内选的界面语言，
 * 两者经常不一致——在日文站浏览的中文用户是常态。这与「UGC 的语言按写它的人
 * 当时的界面语言归档」是同一条原则。
 *
 * 不认识的值**被忽略而不是原样透传**：`zh-TW` 不是内容语种（简繁是显示层
 * 转换，库里永远只有一个 zh），透传会让模板查表落空。
 */
export function pickRequestLocale(
  header: string | null | undefined,
  cookie: string | null | undefined,
): Locale {
  for (const candidate of [header, cookie]) {
    const v = candidate?.trim().toLowerCase()
    if (v && (LOCALES as readonly string[]).includes(v)) return v as Locale
  }
  return 'zh'
}
```

在 `packages/shared/src/index.ts` 加一行（按字母序插在 `pagination` 之前）：

```ts
export * from './request-locale'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/shared && bun test src/request-locale.test.ts`
Expected: PASS，10 条全绿

- [ ] **Step 5: 写三语模板的失败测试**

创建 `apps/api/src/mail/templates/otp.test.ts`：

```ts
import { LOCALES } from '@gensokyo/shared'
import { describe, expect, test } from 'bun:test'
import { renderOtpMail } from './otp'

describe('renderOtpMail', () => {
  test('三种语言 × 两种用途都渲染得出来，且不含未替换的占位', () => {
    for (const locale of LOCALES) {
      for (const purpose of ['email-verification', 'forget-password'] as const) {
        const mail = renderOtpMail(locale, purpose, '123456', 'a@b.c', 10)
        expect(mail.subject.length).toBeGreaterThan(0)
        expect(mail.text).toContain('123456')
        expect(mail.html).toContain('123456')
        expect(mail.subject + mail.text).not.toContain('{')
      }
    }
  })

  test('收件人就是传进去的地址', () => {
    expect(renderOtpMail('zh', 'email-verification', '1', 'x@y.z', 10).to).toBe(
      'x@y.z',
    )
  })

  test('两种用途的正文不同 —— 找回密码不能说成「欢迎注册」', () => {
    const verify = renderOtpMail('zh', 'email-verification', '1', 'a@b.c', 10)
    const forgot = renderOtpMail('zh', 'forget-password', '1', 'a@b.c', 10)
    expect(verify.subject).not.toBe(forgot.subject)
  })

  test('有效期分钟数出现在正文里', () => {
    expect(
      renderOtpMail('zh', 'email-verification', '1', 'a@b.c', 10).text,
    ).toContain('10')
  })

  test('html 里的验证码做了转义安全的包裹', () => {
    // 验证码是我们自己生成的数字，但模板不应该拼接任何外部字符串进 html
    const mail = renderOtpMail('en', 'email-verification', '654321', 'a@b.c', 10)
    expect(mail.html).toContain('654321')
    expect(mail.html).not.toContain('a@b.c')
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `cd apps/api && bun test src/mail/templates/otp.test.ts`
Expected: FAIL，`Cannot find module './otp'`

- [ ] **Step 7: 写 `apps/api/src/mail/templates/otp.ts`**

```ts
import type { Locale } from '@gensokyo/shared'
import type { Mail } from '../index'

export type OtpPurpose = 'email-verification' | 'forget-password'

type Copy = { subject: string; lead: string; hint: string; ignore: string }

/**
 * 邮件文案。**三语齐全靠类型顶**——`check-messages` 扫的是
 * `apps/web/messages`，管不到 api 侧；这里漏一种语言是编译错误。
 *
 * 正文里**不拼接收件人地址等外部字符串**：模板输出直接进 html，
 * 少一个需要记得转义的地方就少一类事故。
 */
const COPY: Record<Locale, Record<OtpPurpose, (minutes: number) => Copy>> = {
  zh: {
    'email-verification': (m) => ({
      subject: '幻想乡 · 邮箱验证码',
      lead: '这是你的邮箱验证码：',
      hint: `${m} 分钟内有效，最多可尝试 3 次。`,
      ignore: '如果这不是你本人的操作，忽略这封信即可，账号不会有任何变化。',
    }),
    'forget-password': (m) => ({
      subject: '幻想乡 · 重置密码验证码',
      lead: '这是你重置密码用的验证码：',
      hint: `${m} 分钟内有效，最多可尝试 3 次。`,
      ignore:
        '如果你没有申请重置密码，忽略这封信即可，你的密码不会被更改。若频繁收到此类邮件，请联系站点管理员。',
    }),
  },
  ja: {
    'email-verification': (m) => ({
      subject: '幻想郷 · メールアドレス確認コード',
      lead: 'メールアドレスの確認コードです：',
      hint: `${m} 分間有効です。入力は 3 回まで試せます。`,
      ignore:
        'お心当たりがない場合は、このメールを破棄してください。アカウントには何の変更も加えられません。',
    }),
    'forget-password': (m) => ({
      subject: '幻想郷 · パスワード再設定コード',
      lead: 'パスワード再設定用の確認コードです：',
      hint: `${m} 分間有効です。入力は 3 回まで試せます。`,
      ignore:
        'パスワード再設定をご依頼でない場合は、このメールを破棄してください。パスワードは変更されません。',
    }),
  },
  en: {
    'email-verification': (m) => ({
      subject: 'Gensokyo · Email verification code',
      lead: 'Here is your email verification code:',
      hint: `It expires in ${m} minutes and can be tried up to 3 times.`,
      ignore:
        "If you didn't request this, you can ignore this message — nothing will change on your account.",
    }),
    'forget-password': (m) => ({
      subject: 'Gensokyo · Password reset code',
      lead: 'Here is your password reset code:',
      hint: `It expires in ${m} minutes and can be tried up to 3 times.`,
      ignore:
        "If you didn't ask to reset your password, ignore this message — your password stays unchanged.",
    }),
  },
}

export function renderOtpMail(
  locale: Locale,
  purpose: OtpPurpose,
  otp: string,
  to: string,
  minutes: number,
): Mail {
  const c = COPY[locale][purpose](minutes)
  return {
    to,
    subject: c.subject,
    text: `${c.lead}\n\n    ${otp}\n\n${c.hint}\n\n${c.ignore}`,
    html: [
      '<div style="font-family:system-ui,sans-serif;line-height:1.7">',
      `<p>${c.lead}</p>`,
      `<p style="font-size:28px;letter-spacing:.3em;font-weight:700;margin:24px 0">${otp}</p>`,
      `<p>${c.hint}</p>`,
      `<p style="color:#666;font-size:13px">${c.ignore}</p>`,
      '</div>',
    ].join(''),
  }
}
```

- [ ] **Step 8: 跑测试与 typecheck**

Run: `cd apps/api && bun test src/mail/templates/otp.test.ts && cd ../.. && bun run typecheck`
Expected: PASS

- [ ] **Step 9: 让 web 把界面语言带上**

改 `apps/web/app/lib/auth-client.ts`：

```ts
import { LOCALE_HEADER } from '@gensokyo/shared'
import { createAuthClient } from 'better-auth/react'
import { getLocale } from '~/paraglide/runtime'

// SSR 期间没有 origin，相对路径会被拒；浏览器端才拼出同源绝对地址
export const authClient = createAuthClient({
  baseURL:
    typeof window === 'undefined'
      ? 'http://localhost/api/auth'
      : `${window.location.origin}/api/auth`,
  fetchOptions: {
    /**
     * 把界面语言带给 api——验证码邮件要按它选语言。
     * api 读不到这个头时会回落 Paraglide 的 locale cookie，再回落 zh；
     * **两边都不读 `Accept-Language`**（那是浏览器语言，不是站内选的语言）。
     */
    headers: { [LOCALE_HEADER]: getLocale() },
  },
})
```

> ⚠️ `getLocale()` 在模块顶层求值一次。若发现切换语言后邮件语言不跟着变，
> 改成 `onRequest` 钩子里动态取。**实现时手动验一次**：在 `/ja` 下注册，
> 看 console transport 打出的是不是日文。

- [ ] **Step 10: 跑体积门禁**

Run: `cd apps/web && bun run build && cd ../.. && bun run check-bundle-size`
Expected: PASS。`@gensokyo/shared` 已在前端可达图里，新增一个常量与一个纯函数不应改变读数。

- [ ] **Step 11: 提交**

```bash
git add packages/shared apps/api/src/mail apps/web/app/lib/auth-client.ts
git commit -m "feat(mail): 三语 OTP 模板与界面语言解析

语言从 X-Gensokyo-Locale 头取，回落 Paraglide cookie 再回落 zh。
刻意不读 Accept-Language：那是浏览器语言，不是用户在站内选的界面语言，
在日文站浏览的中文用户是常态。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 接上 emailOTP 插件，注册后自动发码

**Files:**
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/middleware/session.ts`（`Actor` 加 `emailVerified`）
- Test: `apps/api/src/email-otp.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `sendMail`、Task 3 的 `renderOtpMail` / `pickRequestLocale` / `readCookie` / `LOCALE_HEADER` / `LOCALE_COOKIE`
- Produces:
  - `OTP_EXPIRES_SECONDS = 600`（从 `auth.ts` 导出，Task 12 的限流与前端文案都要用）
  - `Actor` 多一个字段 `emailVerified: boolean`

- [ ] **Step 1: 写失败的测试**

创建 `apps/api/src/email-otp.test.ts`：

```ts
import { db, schema } from '@gensokyo/db'
import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { app } from './app'
import { cleanupTracked, trackUser } from './testing'

const password = 'hakurei-reimu-514'

afterAll(cleanupTracked)

describe('注册后的邮箱验证码', () => {
  test('注册即发码；码是 6 位数字；库里存的不是明文', async () => {
    const logs: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })

    const email = `otp-${Date.now()}@example.com`
    try {
      const signUp = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: '博丽灵梦' }),
      })
      expect(signUp.status).toBe(200)
      trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    } finally {
      spy.mockRestore()
    }

    const mail = logs.find((l) => l.includes('[mail:console]') && l.includes(email))
    expect(mail).toBeDefined()
    const otp = mail?.match(/\b(\d{6})\b/)?.[1]
    expect(otp).toBeDefined()

    // ⚠️ storeOTP 默认是 'plain'——这条钉的就是它必须是 'hashed'
    const [row] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.identifier, `email-verification:${email}`))
      .limit(1)
    expect(row).toBeDefined()
    expect(row?.value).not.toContain(otp as string)
  })

  test('未验证的账号能登录、能读 /me，且 /me 说它没验证', async () => {
    const email = `otp-login-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: '雾雨魔理沙' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    // 不开 requireEmailVerification：未验证也必须能登录
    expect(signIn.status).toBe(200)

    const cookie = signIn.headers.get('set-cookie') ?? ''
    const me = await app.request('/api/me', { headers: { cookie } })
    const body = (await me.json()) as { user: { emailVerified: boolean } | null }
    expect(body.user?.emailVerified).toBe(false)
  })

  test('输对验证码后 emailVerified 变成 true', async () => {
    const logs: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    const email = `otp-ok-${Date.now()}@example.com`
    let cookie = ''
    try {
      const signUp = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: '十六夜咲夜' }),
      })
      cookie = signUp.headers.get('set-cookie') ?? ''
      trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    } finally {
      spy.mockRestore()
    }
    const otp = logs
      .find((l) => l.includes(email))
      ?.match(/\b(\d{6})\b/)?.[1] as string

    const verify = await app.request('/api/auth/email-otp/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email, otp }),
    })
    expect(verify.status).toBe(200)

    const me = await app.request('/api/me', { headers: { cookie } })
    const body = (await me.json()) as { user: { emailVerified: boolean } | null }
    expect(body.user?.emailVerified).toBe(true)
  })

  test('输错验证码不改变 emailVerified', async () => {
    const email = `otp-bad-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: '魂魄妖梦' }),
    })
    const cookie = signUp.headers.get('set-cookie') ?? ''
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)

    const verify = await app.request('/api/auth/email-otp/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email, otp: '000000' }),
    })
    expect(verify.status).toBeGreaterThanOrEqual(400)

    const me = await app.request('/api/me', { headers: { cookie } })
    const body = (await me.json()) as { user: { emailVerified: boolean } | null }
    expect(body.user?.emailVerified).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && bun test src/email-otp.test.ts`
Expected: FAIL——第一条找不到 `[mail:console]` 日志（还没接插件），最后两条因 `/api/me` 没有 `emailVerified` 字段而 `undefined !== false`

- [ ] **Step 3: 在 `auth.ts` 接上插件**

在 `apps/api/src/auth.ts` 顶部加 import，并在 `betterAuth({...})` 里加 `plugins`：

```ts
import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  pickRequestLocale,
  readCookie,
} from '@gensokyo/shared'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { sendMail } from './mail'
import { renderOtpMail } from './mail/templates/otp'

/** 10 分钟。默认的 5 分钟对「切到手机收信再切回来」偏紧 */
export const OTP_EXPIRES_SECONDS = 600
```

在 `betterAuth({ … })` 的配置对象里追加：

```ts
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_EXPIRES_SECONDS,
      allowedAttempts: 3,
      sendVerificationOnSignUp: true,
      /**
       * ⚠️ **默认是 `'plain'`**——验证码会明文躺在 `verification` 表里，
       * 任何拿到只读库权限的人可以直接读出任何人当下的验证码。
       */
      storeOTP: 'hashed',
      /**
       * ⚠️ **默认是 `false`**——那样 `sign-in` 类型的 OTP 在邮箱不存在时会
       * **自动建号**，等于凭空开出第二条完全绕过注册开关的注册路径。
       * 我们只用 `email-verification` 与 `forget-password` 两种类型。
       */
      disableSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }, ctx) => {
        // 只有这两种类型会被我们触发；别的类型不该发信
        if (type !== 'email-verification' && type !== 'forget-password') return
        const headers = ctx?.request?.headers
        const locale = pickRequestLocale(
          headers?.get(LOCALE_HEADER),
          readCookie(headers?.get('cookie'), LOCALE_COOKIE),
        )
        await sendMail(
          renderOtpMail(locale, type, otp, email, OTP_EXPIRES_SECONDS / 60),
        )
      },
    }),
  ],
```

> **不要**加 `requireEmailVerification`——那会挡住登录，与「能登录能看」相反。

- [ ] **Step 4: 让 `Actor` 带上 `emailVerified`**

改 `apps/api/src/middleware/session.ts`。在 `Actor` 类型里，紧跟 `email` 之后加：

```ts
  /**
   * 来自 better-auth 的 session.user，**不查库也不加列**。
   * 「验证后才能写」的判据（见 middleware/require.ts 的 requireVerified）。
   */
  emailVerified: boolean
```

并在 `c.set('actor', { … })` 里加一行 `emailVerified: session.user.emailVerified,`（放在 `email` 之后）。

- [ ] **Step 5: 让 `/me` 暴露它**

改 `apps/api/src/modules/me.ts` 的 `GET /`：解构里加 `emailVerified`，返回的 `user` 对象里加 `emailVerified`。前端 `/verify` 页要靠它决定显示哪一段。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/api && bun test src/email-otp.test.ts`
Expected: PASS，4 条全绿

- [ ] **Step 7: 确认老测试没被打破**

Run: `cd apps/api && bun test`
Expected: 全绿。**特别注意 `auth.test.ts`**——注册现在会多发一封信，但 console transport 只打日志，不该影响任何断言。

- [ ] **Step 8: lint 与提交**

```bash
bun run check:fix && bun run typecheck
git add apps/api/src
git commit -m "feat(auth): 接上 emailOTP，注册后自动发 6 位验证码

两个默认值显式改掉：storeOTP 默认 'plain'（验证码明文躺在 verification
表里）、disableSignUp 默认 false（等于多一条绕过注册开关的注册路径）。
不开 requireEmailVerification：未验证要能登录能看。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `requireVerified` —— 17 个写端点挂上闸

**Files:**
- Modify: `apps/api/src/errors.ts`（`ERROR_CODES` 加 `email_unverified`）
- Modify: `apps/api/src/middleware/require.ts`
- Modify: `apps/api/src/modules/shrine.ts`（5 处）
- Modify: `apps/api/src/modules/kourindou/index.ts`（7 处）
- Modify: `apps/api/src/modules/interactions.ts`（3 处）
- Modify: `apps/api/src/modules/reports.ts`（1 处）
- Modify: `apps/api/src/modules/uploads.ts`（1 处）
- Modify: `apps/web/messages/{zh,ja,en}.json`
- Test: `apps/api/src/verified-guard.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `Actor.emailVerified`
- Produces:
  - `requireVerified`（Hono 中间件）
  - `isGuard(fn: unknown): boolean` —— Task 6 的门禁靠它做身份比对
  - 错误码 `email_unverified`（403）

- [ ] **Step 1: 写失败的测试**

创建 `apps/api/src/verified-guard.test.ts`：

```ts
import { afterAll, describe, expect, test } from 'bun:test'
import { app } from './app'
import { cleanupTracked, trackUser } from './testing'

const password = 'hakurei-reimu-514'
let cookie = ''

afterAll(cleanupTracked)

async function unverifiedSession() {
  if (cookie) return cookie
  const email = `guard-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: '未验证的人' }),
  })
  trackUser(((await res.json()) as { user?: { id: string } }).user?.id)
  cookie = res.headers.get('set-cookie') ?? ''
  return cookie
}

/** 代表性写端点：每个模块至少一条，覆盖五种 HTTP 方法 */
const WRITE_ENDPOINTS: Array<[string, string, unknown]> = [
  ['POST', '/api/shrine/topics', { board: 'chat', title: '标题', body: '正文' }],
  ['DELETE', '/api/shrine/topics/00000000-0000-4000-8000-000000000000', null],
  ['POST', '/api/kourindou/resources', { titleOriginal: 'x', titleOriginalLocale: 'ja' }],
  ['PATCH', '/api/kourindou/resources/00000000-0000-4000-8000-000000000000', {}],
  ['PUT', '/api/kourindou/resources/some-slug/favorite', null],
  ['POST', '/api/reports', { subjectKind: 'post', subjectId: 'x', reason: 'spam' }],
  ['POST', '/api/uploads/image', null],
]

describe('未验证账号不能写', () => {
  for (const [method, path, body] of WRITE_ENDPOINTS) {
    test(`${method} ${path} → 403 email_unverified`, async () => {
      const res = await app.request(path, {
        method,
        headers: {
          cookie: await unverifiedSession(),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      expect(res.status).toBe(403)
      const json = (await res.json()) as { error?: { code?: string } }
      expect(json.error?.code).toBe('email_unverified')
    })
  }
})

describe('未验证账号仍能做账号内务', () => {
  test('GET /api/me → 200', async () => {
    const res = await app.request('/api/me', {
      headers: { cookie: await unverifiedSession() },
    })
    expect(res.status).toBe(200)
  })

  test('GET /api/notifications → 200', async () => {
    const res = await app.request('/api/notifications', {
      headers: { cookie: await unverifiedSession() },
    })
    expect(res.status).toBe(200)
  })

  test('POST /api/notifications/read → 不是 403', async () => {
    const res = await app.request('/api/notifications/read', {
      method: 'POST',
      headers: {
        cookie: await unverifiedSession(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ all: true }),
    })
    expect(res.status).not.toBe(403)
  })

  test('PUT /api/me/handle → 不是 403（认领 handle 不要求验证）', async () => {
    const res = await app.request('/api/me/handle', {
      method: 'PUT',
      headers: {
        cookie: await unverifiedSession(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ handle: `g${Date.now()}`.slice(0, 20) }),
    })
    expect(res.status).not.toBe(403)
  })
})

describe('未登录仍然是 401 而不是 403', () => {
  test('顺序不能反：401 要先于 403', async () => {
    // requireVerified 里 actor 为 null 先返回 401，否则未登录用户会看到
    // 「邮箱未验证」这种毫无意义的提示
    const res = await app.request('/api/shrine/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: 'chat', title: 't', body: 'b' }),
    })
    expect(res.status).toBe(401)
  })
})
```

> `POST /api/notifications/read` 与 `PUT /api/me/handle` 的断言用
> `not.toBe(403)` 而不是 `toBe(200)`：它们的成功状态码与请求体形状由既有
> 实现决定，这几条测试要钉的只是「没有被验证闸拦住」。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && bun test src/verified-guard.test.ts`
Expected: FAIL——7 条写端点测试拿到的是 400/404/200 之类，不是 403

- [ ] **Step 3: 加错误码**

`apps/api/src/errors.ts` 的 `ERROR_CODES` 数组里，在 `'link_not_allowed'` 之后加：

```ts
  /** 邮箱未验证。**403 不是 401**——登录是有效的，只是还不能写 */
  'email_unverified',
```

- [ ] **Step 4: 写 `requireVerified` 与守卫标记**

改 `apps/api/src/middleware/require.ts`，在文件顶部 `RANK` 之后加：

```ts
/**
 * 写闸的登记处。`scripts/check-write-guard.ts` 枚举 `app.routes` 时，靠
 * **函数身份**（不是名字、不是正则）判断一条路由挂没挂守卫——`requireRole('admin')`
 * 每次调用都产生新函数，只有把它们登记进来才认得出。
 */
const guards = new WeakSet<object>()

const markGuard = <T extends object>(mw: T): T => {
  guards.add(mw)
  return mw
}

/** 给门禁脚本用 */
export const isGuard = (fn: unknown): boolean =>
  typeof fn === 'function' && guards.has(fn as object)
```

然后把 `requireRole` 改成经过 `markGuard`，并新增 `requireVerified`：

```ts
/**
 * 已登录**且邮箱已验证**。挂在一切「造对外可见内容」的写端点上。
 *
 * **401 必须先于 403**：未登录用户看到「邮箱未验证」毫无意义，而且那会泄露
 * 一点点状态机的形状。与 `requireAuth` 永远在 `entityIdParam` 之前是同一类考虑。
 *
 * 判据来自 `Actor.emailVerified`，那是 better-auth 的 session.user 直接搬过来的，
 * 不查库不加列。
 */
export const requireVerified = markGuard(
  createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    if (!actor.emailVerified) return fail(c, 'email_unverified', 403)
    return next()
  }),
)

export const requireRole = (min: UserRole) =>
  markGuard(
    createMiddleware<AppEnv>(async (c, next) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      // staff 也要验证过邮箱。老账号由迁移一次性刷成已验证，新 staff
      // 是从已验证用户里提拔的，所以这一条不会挡住任何真实的人。
      if (!actor.emailVerified) return fail(c, 'email_unverified', 403)
      if (RANK[actor.role] < RANK[min]) return fail(c, 'forbidden', 403)
      return next()
    }),
  )
```

- [ ] **Step 5: 17 个写端点换掉 `requireAuth`**

逐个文件把下列位置的 `requireAuth` 改成 `requireVerified`，并更新各文件顶部的 import。

| 文件 | 端点 |
|---|---|
| `modules/shrine.ts` | `POST /topics`、`DELETE /topics/:id`、`POST /topics/:id/posts`、`PATCH /posts/:id`、`DELETE /posts/:id` |
| `modules/kourindou/index.ts` | `POST /resources`、`PATCH /resources/:id`、`PATCH /resources/:id/translations`、`POST /resources/:id/submit`、`POST /resources/:id/status`、`PATCH /resources/:id/license`、`POST /resources/:id/versions` |
| `modules/interactions.ts` | `PUT /resources/:slug/rating`、`PUT /resources/:slug/favorite`、`DELETE /resources/:slug/favorite` |
| `modules/reports.ts` | `POST /` |
| `modules/uploads.ts` | `POST /image` |

⚠️ **`GET /topics/:id/posts`（shrine.ts 的 `.get('/topics/:id/posts', …)`）不要动**，它是读。
⚠️ **`modules/me.ts` 与 `modules/notifications.ts` 一个都不要动。**

改完确认 `requireAuth` 在 `modules/` 下只剩 4 处：

Run: `grep -rn 'requireAuth' apps/api/src/modules --include='*.ts' | grep -v import`
Expected: 恰好 4 行（me.ts 一处、notifications.ts 两处、以及各自的 import 已被排除）

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/api && bun test src/verified-guard.test.ts`
Expected: PASS，12 条全绿

- [ ] **Step 7: 修既有测试**

Run: `cd apps/api && bun test`
Expected: **会红一片**——既有测试建的账号都没验证过邮箱。

修法：在 `packages/db/src/testing.ts` 旁边不动，改为在 `apps/api/src/testing.ts` 增加一个辅助函数：

```ts
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'

/**
 * 把测试账号标成已验证。**测试里凡是要写东西的账号都要调它一次**——
 * 「验证后才能写」上线之后，不调的话每个写操作都会拿到 403。
 *
 * 直接写库而不是走验证码流程：那条流程有自己的测试（email-otp.test.ts），
 * 在别的测试里重跑一遍只是让每个文件都多几十行噪音。
 */
export async function markVerified(userId: string): Promise<void> {
  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, userId))
}
```

然后在每个建账号后要写东西的测试里，`trackUser(id)` 之后加一行 `await markVerified(id)`。

- [ ] **Step 8: 全套测试通过**

Run: `cd apps/api && bun test`
Expected: 全绿

- [ ] **Step 9: 三语文案**

三份 `apps/web/messages/{zh,ja,en}.json` 各加一个键（按字母序插在 `err_duplicate_slug` 之后）：

```json
"err_email_unverified": "请先验证邮箱后再发布内容。"
```
```json
"err_email_unverified": "投稿する前にメールアドレスの確認を完了してください。"
```
```json
"err_email_unverified": "Please verify your email address before posting."
```

Run: `bun run check-messages`
Expected: PASS

- [ ] **Step 10: 提交**

```bash
bun run check:fix && bun run typecheck
git add apps/api/src apps/web/messages
git commit -m "feat(auth): 验证后才能写——17 个写端点挂上 requireVerified

判据是「是否产出对外可见的内容」。PUT /me/handle 留在不要求验证的一侧：
它产出的是一个标识符，而未验证账号拿不出任何内容挂在它下面。

requireVerified 里 401 先于 403：未登录用户看到「邮箱未验证」毫无意义。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `check-write-guard` 门禁

> **前提已实测确认**（2026-09-11，`bun run` 一次性探针）：
>
> 1. `import { app }` 在 **`DATABASE_URL` 缺失时不抛错**——drizzle/bun-sql 的池构造得足够惰性。所以门禁能在 CI 的裸 runner 上跑。
> 2. `app.routes` 共 113 条；`.post(path, mw1, mw2, handler)` 会为链上每一环注册一条**同 method+path** 的条目。
> 3. `r.handler === requireAuth` 为 **true** —— 身份比对成立。
> 4. `requireRole('moderator') !== requireRole('moderator')` —— 所以必须靠 WeakSet 认，不能靠引用比对单个导出。
> 5. ⚠️ **与 spec §4.3 的假设不同**：子应用的 `.use('*', requireRole(...))` 在 `app.routes` 里是**独立的 `ALL /api/moderation/*` 条目，不会并进各路由自己的分组**。因此门禁必须对这类条目做**前缀匹配**，否则 moderation / admin 下的 7 个写端点会被全部误报。

**Files:**
- Create: `scripts/check-write-guard.ts`
- Modify: `package.json`（scripts 加一条）
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 5 的 `isGuard`
- Produces: `bun run check-write-guard`，退出码 0/1

- [ ] **Step 1: 写门禁脚本**

创建 `scripts/check-write-guard.ts`：

```ts
/**
 * 写闸门禁：
 *   bun run check-write-guard
 *
 * 断言：`/api` 下每一个非 GET 路由的中间件链里都出现了一道守卫
 * （`requireVerified` 或 `requireRole`），豁免必须写进下面的显式名单。
 *
 * 为什么需要它：api 的测试**刻意不进 CI**（要真实的 pg/redis/Meili/MinIO），
 * 所以「新加的写端点忘了挂验证闸」这类回归在 CI 里没有任何东西会响，
 * 而它的表现是一个安全洞，不是一个报错。这条门禁是这块工作里唯一能在
 * CI 跑的保障。
 *
 * **走运行时自省而不是扫源码。** 判据是**函数身份**：`app.routes` 里每条
 * 记录的 `handler` 就是中间件函数本身（实测 `r.handler === requireAuth`
 * 为 true），而守卫在 `middleware/require.ts` 里登记进一个 WeakSet。
 * 这样改路径、改文件名、改路由写法都不会让门禁失灵——正则会。
 * `requireRole('admin')` 每次调用产生新函数，也只有 WeakSet 认得出。
 *
 * ⚠️ **两类条目要分开处理**（实测得到，不要想当然）：
 *
 * - 逐路由的守卫（`.post(p, requireVerified, …)`）与该路由同 method+path，
 *   出现在同一个分组里；
 * - 子应用的前缀守卫（`.use('*', requireRole('admin'))`）是**独立的
 *   `ALL /api/admin/*` 条目**，不会并进 `PATCH /api/admin/config` 的分组。
 *   漏掉这一类会把 moderation / admin 下的 7 个写端点全部误报。
 *
 * 只用 Bun 内置能力，不引依赖。`DATABASE_URL` 缺失时 import 不会抛错，
 * 所以裸 runner 上可跑。
 */
import { app } from '../apps/api/src/app'
import { isGuard } from '../apps/api/src/middleware/require'

type Row = { method: string; path: string; handler: unknown }

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** better-auth 自己挂的处理器。它有自己的一套闸，不归这条门禁管 */
const NOT_OURS = new Set(['/api/auth/*'])

/**
 * 显式豁免：**登录即可、不要求邮箱验证**的「账号内务」端点。
 *
 * 判据是「是否产出对外可见的内容」。这两个产出的都不是内容：
 * 认领 handle 产出一个标识符，而未验证账号拿不出任何东西挂在它下面；
 * 标记通知已读只动自己的收件箱。
 *
 * **往这里加一行就是一次安全决策**，写清楚理由再加。
 */
const ALLOWED_UNVERIFIED = new Set([
  'PUT /api/me/handle',
  'POST /api/notifications/read',
])

const rows = (app as unknown as { routes: Row[] }).routes

// 前缀守卫：'/api/admin/*' → '/api/admin/'
const prefixGuards = rows
  .filter(
    (r) => r.method === 'ALL' && r.path.endsWith('/*') && isGuard(r.handler),
  )
  .map((r) => r.path.slice(0, -1))

const groups = new Map<string, Row[]>()
for (const r of rows) {
  if (r.method === 'ALL' || READ_METHODS.has(r.method)) continue
  if (NOT_OURS.has(r.path)) continue
  const key = `${r.method} ${r.path}`
  const list = groups.get(key)
  if (list) list.push(r)
  else groups.set(key, [r])
}

const unguarded: string[] = []
const exempt: string[] = []
for (const [key, entries] of groups) {
  if (ALLOWED_UNVERIFIED.has(key)) {
    exempt.push(key)
    continue
  }
  const guarded =
    entries.some((r) => isGuard(r.handler)) ||
    prefixGuards.some((p) => entries[0].path.startsWith(p))
  if (!guarded) unguarded.push(key)
}

// 名单腐烂检查：豁免了一个已经不存在的路由，说明名单该清理了
const stale = [...ALLOWED_UNVERIFIED].filter((k) => !groups.has(k))

console.info(
  `[check-write-guard] 非 GET 路由 ${groups.size} 条，已挂守卫 ${
    groups.size - unguarded.length - exempt.length
  } 条，显式豁免 ${exempt.length} 条`,
)
for (const k of exempt) console.info(`  豁免：${k}`)

if (stale.length > 0) {
  console.error('\n[check-write-guard] 豁免名单里有已经不存在的路由：')
  for (const k of stale) console.error(`  ${k}`)
}

if (unguarded.length > 0) {
  console.error('\n[check-write-guard] 下列写端点没有挂验证闸：')
  for (const k of unguarded) console.error(`  ${k}`)
  console.error(
    '\n修法二选一：\n' +
      '  1. 给它挂 requireVerified（或 requireRole）——绝大多数情况是这条；\n' +
      '  2. 如果它确实是「登录即可」的账号内务端点，把它加进脚本顶部的\n' +
      '     ALLOWED_UNVERIFIED 并写清楚理由。那是一次安全决策。',
  )
}

if (unguarded.length > 0 || stale.length > 0) process.exit(1)
console.info('[check-write-guard] 通过')
```

- [ ] **Step 2: 跑它，确认当前是通过的**

Run: `bun run scripts/check-write-guard.ts`
Expected: 打印「非 GET 路由 25 条」上下、两条豁免，最后一行「通过」，退出码 0

> 数字对不上不一定是错——Task 5 之后的路由数以实际为准。要看的是**没有 unguarded**。

- [ ] **Step 3: 故意破坏一次，确认门禁真的会红**

临时把 `apps/api/src/modules/reports.ts` 里的 `requireVerified` 改回 `requireAuth`，然后：

Run: `bun run scripts/check-write-guard.ts; echo "退出码 $?"`
Expected: 报 `POST /api/reports` 没挂闸，退出码 1

**改回来**，再跑一次确认恢复通过。

> 这一步不能跳。一条从来没红过的门禁，和没有门禁是一回事。

- [ ] **Step 4: 接进 package.json 与 CI**

根 `package.json` 的 `scripts` 里，在 `check-bundle-size` 之后加：

```json
"check-write-guard": "bun run scripts/check-write-guard.ts"
```

`.github/workflows/ci.yml` 里，在 `bun run check-motion-boundary` 之后加一行：

```yaml
      # api 的测试刻意不进 CI（要真实的 pg/redis/Meili/MinIO），所以
      # 「新写端点忘了挂验证闸」在 CI 里没有别的东西会响。这条是唯一的保障。
      - run: bun run check-write-guard
```

- [ ] **Step 5: 确认它在没有 .env 的环境下也能跑**

Run: `env -u DATABASE_URL -u MEILI_HOST -u BETTER_AUTH_SECRET bun run check-write-guard`
Expected: 照常通过。**这一条就是它能进 CI 的全部依据**，必须实跑。

- [ ] **Step 6: 提交**

```bash
bun run check:fix
git add scripts/check-write-guard.ts package.json .github/workflows/ci.yml
git commit -m "feat(ci): check-write-guard —— 非 GET 路由必须挂验证闸

走运行时自省而不是扫源码：判据是函数身份（app.routes 里的 handler 就是
中间件函数本身），守卫登记在 WeakSet 里。改路径改文件名都不会让它失灵。

子应用的 .use('*', requireRole(...)) 在 app.routes 里是独立的
ALL /api/admin/* 条目、不会并进各路由分组，所以前缀守卫单独匹配——
漏掉这一类会把 moderation/admin 下 7 个写端点全部误报。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 老账号一次性刷成已验证

**Files:**
- Create: `packages/db/drizzle/0009_<drizzle 生成的名字>.sql`
- Test: 手动核对（迁移不写单测）

**Interfaces:**
- Consumes: 无
- Produces: 迁移后 `user.email_verified` 全为 true

- [ ] **Step 1: 写迁移**

drizzle 的 schema 没变（`email_verified` 列早就有），所以这是一条**纯数据迁移**，
`drizzle-kit generate` 不会生成它。手写一个空迁移再填内容：

```bash
cd packages/db && bunx drizzle-kit generate --custom --name verify_existing_users
```

在生成的 SQL 文件里写：

```sql
-- 「验证后才能写」上线前的一次性既往不咎。
--
-- user.email_verified 全库为 false（列有默认值，从来没人写过它），
-- 而新规矩是未验证不能写。不刷的话，上线当天每一个现存用户下次发帖
-- 都会被 403 拦住——包括站长本人，以及 shrine 种子账号（六篇引导帖
-- 与站规都挂在它名下）。
--
-- 分界线就是这条迁移跑的时刻：它跑在部署流程的 migrate 步骤、up -d 之前，
-- 所以此刻之前注册的账号既往不咎，之后注册的才受新规矩管。
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
```

- [ ] **Step 2: 在开发库上跑一次**

Run: `cd packages/db && bun run migrate`
Expected: 无报错

- [ ] **Step 3: 核对结果**

Run:
```bash
psql "$DATABASE_URL" -c 'select email_verified, count(*) from "user" group by 1'
```
Expected: 只有一行 `t | <账号总数>`

- [ ] **Step 4: 确认种子账号在内**

Run:
```bash
psql "$DATABASE_URL" -c $'select email, email_verified from "user" where email like \'shrine@%\''
```
Expected: `email_verified` 为 `t`

- [ ] **Step 5: 提交**

```bash
git add packages/db/drizzle
git commit -m "feat(db): 老账号一次性刷成已验证

分界线是这条迁移跑的时刻（部署流程里 migrate 在 up -d 之前）：此刻之前
注册的既往不咎，之后的才受新规矩管。不刷的话上线当天每个现存用户发帖
都会被 403，包括站长与 shrine 种子账号。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `/verify` —— 注册后的补全页（验证码 + handle 认领）

**Files:**
- Create: `apps/web/app/lib/verify-step.ts`
- Create: `apps/web/app/lib/verify-step.test.ts`
- Create: `apps/web/app/routes/verify.tsx`
- Modify: `apps/web/app/routes.ts`
- Modify: `apps/web/app/lib/auth-client.ts`（加 `emailOTPClient` 插件）
- Modify: `apps/web/app/routes/register.tsx`（移走 handle 认领）
- Modify: `apps/web/messages/{zh,ja,en}.json`

**Interfaces:**
- Consumes: Task 4 的 `/api/me` 多出来的 `emailVerified`
- Produces:
  - `type VerifyStep = 'anonymous' | 'otp' | 'handle' | 'done'`
  - `verifyStep(user: { emailVerified: boolean; handleSetAt: string | null } | null): VerifyStep`

- [ ] **Step 1: 写纯函数的失败测试（这条进 CI）**

创建 `apps/web/app/lib/verify-step.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { verifyStep } from './verify-step'

describe('verifyStep', () => {
  test('未登录 → anonymous', () => {
    expect(verifyStep(null)).toBe('anonymous')
  })

  test('没验证邮箱 → otp，即使 handle 也没认领', () => {
    // 顺序不能反：先证明邮箱是你的，再让你占一个公开标识符
    expect(verifyStep({ emailVerified: false, handleSetAt: null })).toBe('otp')
  })

  test('验证了但没认领 handle → handle', () => {
    expect(verifyStep({ emailVerified: true, handleSetAt: null })).toBe('handle')
  })

  test('两段都完成 → done', () => {
    expect(
      verifyStep({ emailVerified: true, handleSetAt: '2026-09-11T00:00:00Z' }),
    ).toBe('done')
  })

  test('Google 注册的用户（邮箱天生已验证）直接落到 handle 段', () => {
    // 这正是 /verify 兼做认领页的理由：OAuth 路径上没有注册表单，
    // 「注册成功后立刻认领 handle」那一次性机会在那条路上不存在
    expect(verifyStep({ emailVerified: true, handleSetAt: null })).toBe('handle')
  })

  test('已验证且已认领的老用户误入本页 → done（页面据此立刻跳走）', () => {
    expect(
      verifyStep({ emailVerified: true, handleSetAt: '2020-01-01T00:00:00Z' }),
    ).toBe('done')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && bun test app/lib/verify-step.test.ts`
Expected: FAIL，`Cannot find module './verify-step'`

- [ ] **Step 3: 写纯函数**

创建 `apps/web/app/lib/verify-step.ts`：

```ts
export type VerifyStep = 'anonymous' | 'otp' | 'handle' | 'done'

/**
 * `/verify` 该显示哪一段。
 *
 * 这一页同时服务两类人：邮箱密码注册的（要走 otp → handle 两段）与
 * Google 注册的（邮箱天生已验证，只剩 handle）。抽成纯函数是因为
 * web 的测试**进 CI**，而 api 的不进。
 *
 * 顺序不能反：先证明邮箱是你的，再让你占一个公开的、不可逆的标识符。
 */
export function verifyStep(
  user: { emailVerified: boolean; handleSetAt: string | null } | null,
): VerifyStep {
  if (!user) return 'anonymous'
  if (!user.emailVerified) return 'otp'
  if (user.handleSetAt === null) return 'handle'
  return 'done'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && bun test app/lib/verify-step.test.ts`
Expected: PASS，6 条全绿

- [ ] **Step 5: 给 web 的 authClient 加 emailOTP 插件**

改 `apps/web/app/lib/auth-client.ts`，加 import 与 `plugins`：

```ts
import { emailOTPClient } from 'better-auth/client/plugins'
```

在 `createAuthClient({ … })` 里加：

```ts
  plugins: [emailOTPClient()],
```

这样 `authClient.emailOtp.verifyEmail()` / `.sendVerificationOtp()` / `.resetPassword()`
才存在。

- [ ] **Step 6: 加路由**

`apps/web/app/routes.ts`，在 `route('register', …)` 之后加两行（`forgot` 的页面在
Task 13 建，路由现在就一起加会让 build 失败，所以**这一步只加 verify**）：

```ts
    route('verify', 'routes/verify.tsx'),
```

- [ ] **Step 7: 三语文案**

三份 `apps/web/messages/*.json` 各加（键按字母序插入）：

| 键 | zh | ja | en |
|---|---|---|---|
| `auth_verify_title` | 验证邮箱 | メールアドレスの確認 | Verify your email |
| `auth_verify_sent` | 验证码已发到你的邮箱，10 分钟内有效。 | 確認コードをメールで送信しました。10 分間有効です。 | We sent a code to your inbox. It expires in 10 minutes. |
| `auth_verify_code` | 验证码 | 確認コード | Verification code |
| `auth_verify_submit` | 验证 | 確認する | Verify |
| `auth_verify_resend` | 没收到？重新发送 | 届きませんか？再送する | Didn't get it? Send again |
| `auth_verify_bad_code` | 验证码不对或已过期，请重新获取。 | コードが正しくないか、有効期限が切れています。 | That code is wrong or expired. Request a new one. |
| `auth_verify_done` | 邮箱已验证。 | メールアドレスを確認しました。 | Your email is verified. |
| `auth_claim_title` | 取个用户名 | ユーザー名を決める | Choose a username |

- [ ] **Step 8: 写 `/verify` 页**

创建 `apps/web/app/routes/verify.tsx`：

```tsx
import { HANDLE_RE } from '@gensokyo/shared'
import { useEffect, useState } from 'react'
import { redirect, useNavigate, useSearchParams } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { apiFor, browserApi } from '~/lib/api'
import { authClient } from '~/lib/auth-client'
import { safeNext } from '~/lib/links'
import { verifyStep } from '~/lib/verify-step'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/verify'

export function meta() {
  return [{ title: `${m.auth_verify_title()} · ${m.site_name()}` }]
}

/**
 * 注册后的补全页。它同时服务两类人——邮箱密码注册的走「验证码 → 认领 handle」
 * 两段，Google 注册的邮箱天生已验证、只剩认领那一段。
 *
 * 写操作被 403 挡住时，前端也把人引到这里。
 */
export async function loader({ request }: Route.LoaderArgs) {
  // SSR 取会话要手动转发 cookie
  const res = await apiFor(request).api.me.$get()
  const body = (await res.json()) as {
    user: { email: string; emailVerified: boolean; handleSetAt: string | null } | null
  }
  const step = verifyStep(body.user)
  if (step === 'anonymous') throw redirect(localizeHref('/login'))
  return { step, email: body.user?.email ?? '' }
}

export default function Verify({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next')) ?? localizeHref('/')
  const [step, setStep] = useState(loaderData.step)
  const [error, setError] = useState<'code' | 'handle-taken' | 'handle-bad' | null>(
    null,
  )
  const [pending, setPending] = useState(false)

  // 两段都完成就别停在这一页
  useEffect(() => {
    if (step === 'done') navigate(next)
  }, [step, next, navigate])

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const otp = String(new FormData(e.currentTarget).get('otp') ?? '').trim()
    const { error: err } = await authClient.emailOtp.verifyEmail({
      email: loaderData.email,
      otp,
    })
    setPending(false)
    if (err) return setError('code')
    // 验证完接着认领 handle；已认领过的会被下一次 loader 判成 done
    setStep('handle')
  }

  async function onResend() {
    setPending(true)
    setError(null)
    await authClient.emailOtp.sendVerificationOtp({
      email: loaderData.email,
      type: 'email-verification',
    })
    setPending(false)
  }

  async function onClaim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const handle = String(new FormData(e.currentTarget).get('handle') ?? '')
      .trim()
      .toLowerCase()
    if (!handle) {
      setPending(false)
      return navigate(next)
    }
    if (!HANDLE_RE.test(handle)) {
      setPending(false)
      return setError('handle-bad')
    }
    const res = await browserApi().api.me.handle.$put({ json: { handle } })
    setPending(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string }
      } | null
      return setError(
        body?.error?.code === 'duplicate_slug' ? 'handle-taken' : 'handle-bad',
      )
    }
    navigate(next)
  }

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            {step === 'handle' ? m.auth_claim_title() : m.auth_verify_title()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'otp' && (
            <form onSubmit={onVerify} className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {m.auth_verify_sent()}
              </p>
              <div className="grid gap-2">
                <Label htmlFor="otp">{m.auth_verify_code()}</Label>
                <Input
                  id="otp"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  aria-invalid={error === 'code' ? true : undefined}
                />
              </div>
              {error === 'code' && (
                <p role="alert" className="text-sm text-destructive">
                  {m.auth_verify_bad_code()}
                </p>
              )}
              <Button type="submit" disabled={pending}>
                {m.auth_verify_submit()}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onResend}
                disabled={pending}
              >
                {m.auth_verify_resend()}
              </Button>
            </form>
          )}

          {step === 'handle' && (
            <form onSubmit={onClaim} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="handle">{m.auth_handle()}</Label>
                <Input
                  id="handle"
                  name="handle"
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={error?.startsWith('handle') ? true : undefined}
                  aria-describedby="handle-hint"
                />
                <p id="handle-hint" className="text-xs text-muted-foreground">
                  {m.auth_handle_hint()}
                </p>
                {error === 'handle-taken' && (
                  <p role="alert" className="text-sm text-destructive">
                    {m.auth_handle_taken()}
                  </p>
                )}
                {error === 'handle-bad' && (
                  <p role="alert" className="text-sm text-destructive">
                    {m.auth_handle_invalid()}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={pending}>
                {m.auth_verify_submit()}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(next)}
                disabled={pending}
              >
                {m.auth_handle_skip()}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
```

> **动效红线**：这一页的节点全部会进 SSR HTML，所以**零 `initial` 隐藏态**，
> 也不引 `motion/react`——`verify` 不在「匿名可读七路由」名单里，但没有任何
> 动效需求，别顺手加。

- [ ] **Step 9: 简化 `register.tsx`**

把注册页改成「注册成功就跳 `/verify`」：

- 删掉 `registered` 状态位、`handleError` 状态、handle 那一整个 `<div className="grid gap-2">` 块、以及 `PUT /me/handle` 的调用与相关 import（`HANDLE_RE`、`browserApi`）。
- `onSubmit` 里 `signUp` 成功后改成：

```ts
    setPending(false)
    navigate(
      next
        ? `${localizeHref('/verify')}?next=${encodeURIComponent(next)}`
        : localizeHref('/verify'),
    )
```

- 其余（注册开关提示、错误处理、去登录的链接）保持不动。

- [ ] **Step 10: 跑测试、构建与体积门禁**

Run:
```bash
cd apps/web && bun test && bun run build && cd ../.. && bun run check-messages && bun run check-bundle-size
```
Expected: 全绿。

> ⚠️ `emailOTPClient()` 会让 `auth-client` 这个 chunk 变大。它**不在根集里**
> （`site-header.tsx` 用的是动态 `import('~/lib/auth-client')`，而 login/register/verify
> 是静态 import，属于 CLAUDE.md 说的「纯动态撞纯静态」那种 Vite 会警告的情形）。
> 若 `check-bundle-size` 红了，先看是首屏集超了还是单路由超了：**首屏集超了**
> 说明 rolldown 把 auth-client 提进了共享 chunk，那要把 login/register/verify 对
> auth-client 的引用也改成动态；**单路由超了**才考虑调预算，且要在脚本里写明理由。

- [ ] **Step 11: 手动验一次语言**

Run: `bun run dev`，然后在浏览器开 `http://localhost:3000/ja/register` 注册一个账号，
看 api 进程的 stdout。
Expected: `[mail:console]` 那行的 subject 是 `幻想郷 · メールアドレス確認コード`

> 若打出的是中文，说明 Task 3 Step 9 那个「`getLocale()` 在模块顶层求值一次」的
> 隐患成真了——改成在 `fetchOptions.onRequest` 里动态取。

- [ ] **Step 12: 提交**

```bash
bun run check:fix && bun run typecheck
git add apps/web
git commit -m "feat(web): /verify —— 注册后的补全页（验证码 + handle 认领）

一页服务两类人：邮箱密码注册的走两段，Google 注册的邮箱天生已验证、
只剩认领。这同时补上一个缺口——OAuth 路径上没有注册表单，「注册成功后
立刻认领 handle」那一次性机会在那条路上根本不存在。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 注册开关挪到 `validateUserInfo`

**Files:**
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/auth.test.ts`
- Modify: `apps/web/app/routes/register.tsx`（若实测发现判据变了）

**Interfaces:**
- Consumes: 无
- Produces: 注册开关在**所有**注册路径上生效（为 Task 10 的 Google 铺路）

- [ ] **Step 1: 先实测错误形状**

这一步是**测量，不是实现**。先把 `auth.ts` 的 `hooks.before` 换成 `validateUserInfo`：

```ts
  user: {
    /**
     * 注册开关的**唯一**强制点。
     *
     * 这个钩子「在 create-user / link-account / OAuth 的 sign-in 之前触发，
     * 横跨每一种认证方式」。挪到这里之前它是按路径拦 `/sign-up/email` 的，
     * 那样每加一种登录方式就要记得再判一次——而「记得」不是一种机制。
     */
    validateUserInfo: async ({ source }) => {
      if (source.action !== 'create-user') return
      if (await registrationOpen()) return
      return { error: 'REGISTRATION_CLOSED' }
    },
  },
```

并把原来的 `hooks: { before: createAuthMiddleware(...) }` 整块删掉（连同
`APIError` / `createAuthMiddleware` 两个已不再使用的 import）。

然后跑既有测试看实际拿到什么：

Run: `cd apps/api && bun test src/auth.test.ts`
Expected: 「registrationOpen=false」那条**可能失败**。把实际的 status 与 body
打出来记下：

```bash
cd apps/api && bun test src/auth.test.ts 2>&1 | tail -30
```

- [ ] **Step 2: 按实测结果更新测试断言**

改 `apps/api/src/auth.test.ts` 里那条测试。若 `body.code` 不再是
`REGISTRATION_CLOSED`，把断言改成实际值，并在测试里加一句注释说明这个码
就是前端要匹配的东西：

```ts
      expect(res.status).toBe(403)
      const body = (await res.json()) as { code?: string; message?: string }
      // ⚠️ 这个码是前端 register.tsx 的匹配依据。改这里就要同步改那里。
      // 填 Step 1 实际打印出来的值。预期仍是 'REGISTRATION_CLOSED'，
      // 但**必须实测确认**——validateUserInfo 的错误形状与原来的
      // APIError 不一定相同，这正是 Step 1 存在的理由。
      expect(body.code).toBe('REGISTRATION_CLOSED')
```

- [ ] **Step 3: 加一条钉住「横跨所有路径」的测试**

在 `apps/api/src/auth.test.ts` 的「注册开关」describe 里加：

```ts
  test('开关关闭时，emailOTP 的 sign-in 路径也建不出新号', async () => {
    // disableSignUp: true 已经挡住这条路，但这条测试钉的是「注册开关
    // 不再依赖路径匹配」——将来谁把 disableSignUp 改回 false，
    // validateUserInfo 仍然是最后一道闸。
    const { db, schema } = await import('@gensokyo/db')
    const { eq } = await import('drizzle-orm')
    const { invalidateConfig } = await import('./site-config')
    await db
      .insert(schema.siteConfig)
      .values({ key: 'registrationOpen', value: false })
      .onConflictDoUpdate({
        target: schema.siteConfig.key,
        set: { value: false },
      })
    invalidateConfig()
    const fresh = `otp-signup-${Date.now()}@example.com`
    try {
      const res = await app.request('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: fresh, otp: '000000' }),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
      const [created] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, fresh))
        .limit(1)
      expect(created).toBeUndefined()
    } finally {
      await db
        .delete(schema.siteConfig)
        .where(eq(schema.siteConfig.key, 'registrationOpen'))
      invalidateConfig()
    }
  })
```

- [ ] **Step 4: 若前端判据变了，同步改 `register.tsx`**

`register.tsx` 现在的判据是：

```ts
        const closed =
          (err as { code?: string }).code === 'REGISTRATION_CLOSED' ||
          (err as { status?: number }).status === 403
```

`status === 403` 那一半在任何情况下都还成立，所以**最坏情况也只是 `code`
那一半失效、不会误判**。但仍要按 Step 1 的实测值把 `code` 改对——留着一个
永远匹配不上的字符串，下次有人读这段会以为它在起作用。

- [ ] **Step 5: 全套测试**

Run: `cd apps/api && bun test`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
bun run check:fix && bun run typecheck
git add apps/api/src apps/web/app/routes/register.tsx
git commit -m "refactor(auth): 注册开关挪到 validateUserInfo，横跨所有注册路径

原来按路径拦 /sign-up/email，注释里自己写了「将来加社交登录时要另判」。
挪到 validateUserInfo 之后「另判」这件事不再存在——它在 create-user 之前
触发，横跨每一种认证方式。这是 Google 登录的前置条件。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Google 登录后端 + 抢注仲裁

**Files:**
- Create: `apps/api/src/auth/arbitrate.ts`
- Create: `apps/api/src/auth/arbitrate.test.ts`
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/modules/admin.ts`（`publicConfig` 加 `googleEnabled`）

**Interfaces:**
- Consumes: Task 9 的 `validateUserInfo` 布局
- Produces:
  - `takeoverIfUnverified(userId: string): Promise<boolean>` —— 执行了接管返回 true
  - `googleConfigured(): boolean`
  - `GET /api/config` 响应多一个顶层字段 `googleEnabled: boolean`

- [ ] **Step 1: 写仲裁函数的失败测试**

创建 `apps/api/src/auth/arbitrate.test.ts`：

```ts
import { db, schema } from '@gensokyo/db'
import { afterAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { app } from '../app'
import { cleanupTracked, markVerified, trackUser } from '../testing'
import { takeoverIfUnverified } from './arbitrate'

const password = 'hakurei-reimu-514'

afterAll(cleanupTracked)

/** 建一个真账号：signUp 会同时造出 user、credential account 与一个 session */
async function signUp(tag: string) {
  const email = `arb-${tag}-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: '测试' }),
  })
  const id = ((await res.json()) as { user?: { id: string } }).user?.id as string
  trackUser(id)
  return { id, email }
}

const credentials = (userId: string) =>
  db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'credential'),
      ),
    )

const sessions = (userId: string) =>
  db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.userId, userId))

describe('takeoverIfUnverified', () => {
  test('未验证 + 有密码 → 接管：删掉密码，吊销全部会话', async () => {
    const { id } = await signUp('takeover')
    expect(await credentials(id)).not.toHaveLength(0)
    expect(await sessions(id)).not.toHaveLength(0)

    expect(await takeoverIfUnverified(id)).toBe(true)

    // 抢注者的密码从此无效
    expect(await credentials(id)).toHaveLength(0)
    // 抢注者可能正登录着，会话必须一起吊销
    expect(await sessions(id)).toHaveLength(0)
  })

  test('已验证 → 不动：密码保留，会话保留（两边都是本人）', async () => {
    const { id } = await signUp('verified')
    await markVerified(id)

    expect(await takeoverIfUnverified(id)).toBe(false)

    expect(await credentials(id)).not.toHaveLength(0)
    expect(await sessions(id)).not.toHaveLength(0)
  })

  test('未验证但没有密码 → 不动（这是 Google 刚建的新号，没什么可接管的）', async () => {
    const { id } = await signUp('nopass')
    await db
      .delete(schema.account)
      .where(
        and(
          eq(schema.account.userId, id),
          eq(schema.account.providerId, 'credential'),
        ),
      )

    expect(await takeoverIfUnverified(id)).toBe(false)
    // 没有误伤会话
    expect(await sessions(id)).not.toHaveLength(0)
  })

  test('用户不存在 → 返回 false 而不是抛错', async () => {
    expect(await takeoverIfUnverified('no-such-user-id')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && bun test src/auth/arbitrate.test.ts`
Expected: FAIL，`Cannot find module './arbitrate'`

- [ ] **Step 3: 写仲裁函数**

创建 `apps/api/src/auth/arbitrate.ts`：

```ts
import { db, schema } from '@gensokyo/db'
import { and, eq } from 'drizzle-orm'

/**
 * Google 撞车仲裁：**能证明邮箱所有权的人获胜**。
 *
 * 挂在 `databaseHooks.account.create.after`，即「链接成功之后」。这个位置
 * 是从 better-auth 的实现顺序推出来的，不是随便挑的：
 *
 *   linkAccount → [本钩子] → updateUser({emailVerified:true}) → createSession
 *
 * 三个后果：
 *
 * 1. 钩子跑的时候 `emailVerified` **还是 false**，所以它能当判据；
 * 2. 本次登录的 session **还没建**，所以「吊销全部会话」不会误伤刚登录的人——
 *    不需要写「排除当前会话」的逻辑，那只会排除掉一个 null；
 * 3. 链接已经成功了，所以**不存在「密码删了但 Google 没接上」的锁死**。
 *
 * 三种情形被一个条件自动分开：
 *
 * | 情形 | emailVerified | 有 credential | 动作 |
 * |---|---|---|---|
 * | Google 建的新号 | true（Google 给的） | 无 | 不动 |
 * | 本地已验证 + 接上 Google | true | 有 | 不动 |
 * | 本地未验证（抢注） | false | 有 | 删密码 + 吊销会话 |
 *
 * 敢动那个账号，是因为「未验证账号不持有任何对外可见的内容」——这条由
 * `requireVerified` 保证。被删了密码的人若真是本人，可以用找回密码把密码
 * 装回来（better-auth 在没有 credential 行时会自动创建一行）；抢注者读不到
 * 那个邮箱，走不了这条路。
 *
 * ⚠️ **依赖 `accountLinking.requireLocalEmailVerified: false`**，而那个选项
 * 已标 deprecated、下个小版本会变成无条件。升级 better-auth 之后本函数不再
 * 被触发，行为退回「拒绝链接」——是**朝安全方向的退化**，不是开天窗，但
 * 未验证用户会卡住。`arbitrate.test.ts` 的第一条会在那时变红。
 */
export async function takeoverIfUnverified(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  if (!row || row.emailVerified) return false

  const removed = await db
    .delete(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, 'credential'),
      ),
    )
    .returning({ id: schema.account.id })
  // 没有密码可删 = 不是抢注，别顺手吊销人家的会话
  if (removed.length === 0) return false

  await db.delete(schema.session).where(eq(schema.session.userId, userId))
  return true
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && bun test src/auth/arbitrate.test.ts`
Expected: PASS，4 条全绿

- [ ] **Step 5: 在 `auth.ts` 接上 Google 与钩子**

顶部加：

```ts
import { takeoverIfUnverified } from './auth/arbitrate'

/**
 * Google 凭据是**可选**的：本地开发不该因为没申请 OAuth 应用就跑不起来。
 * 两个都配齐才注册这个 provider，前端靠 `GET /api/config` 的 googleEnabled
 * 决定要不要显示按钮。
 */
export const googleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
```

在 `betterAuth({ … })` 里加三块：

```ts
  socialProviders: googleConfigured()
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : {},

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      /**
       * ⚠️ 把仲裁权接管过来。默认 true 时 better-auth 会直接**拒绝**链接到
       * 未验证的本地账号——那是安全的，但用户会卡死且没有出路。
       * 我们改成放行链接，再由 databaseHooks 里的 takeoverIfUnverified
       * 把抢注者的密码与会话清掉。见 auth/arbitrate.ts 的长注释。
       */
      requireLocalEmailVerified: false,
    },
  },

  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          if (account.providerId !== 'google') return
          await takeoverIfUnverified(account.userId)
        },
      },
    },
  },
```

- [ ] **Step 6: 让前端知道 Google 开没开**

改 `apps/api/src/modules/admin.ts` 的 `publicConfig`：

```ts
import { googleConfigured } from '../auth'

export const publicConfig = new Hono<AppEnv>().get('/', async (c) => {
  const rows = await db
    .select()
    .from(siteConfig)
    .where(inArray(siteConfig.key, [...PUBLIC_CONFIG_KEYS]))
  return c.json({
    config: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    /**
     * **不放进 config 里**：那是 site_config 表的白名单键，由 admin 写；
     * 这个是进程配置，admin 改不了。混在一起会让「后台能改的东西」这条
     * 边界变糊。
     */
    googleEnabled: googleConfigured(),
  })
})
```

- [ ] **Step 7: 配置 Google Cloud Console 并手动验一次**

1. 在 Google Cloud Console 建 OAuth 2.0 客户端（Web application）。
2. 授权重定向 URI 填 `http://localhost:3001/api/auth/callback/google`（开发）与
   `https://<生产域名>/api/auth/callback/google`（生产）。
3. 把 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 写进 `.env`。
4. `bun run dev`，浏览器打开
   `http://localhost:3000/api/auth/sign-in/social?provider=google`（或等 Task 11 的按钮），
   走完一次授权。

Expected: 回到站点且已登录；`psql "$DATABASE_URL" -c $'select email, email_verified from "user" order by created_at desc limit 1'` 显示 `email_verified` 为 `t`。

> ⚠️ **重定向 URI 用的是 api 的端口 3001，不是 web 的 3000**——`BETTER_AUTH_URL`
> 指向 api。填错的表现是 Google 那边报 `redirect_uri_mismatch`。

- [ ] **Step 8: 手动验一次抢注仲裁**

1. 用你的 Gmail 地址在站内注册一个密码账号，**不要验证邮箱**。
2. 记下密码，然后用同一个 Gmail 走 Google 登录。
3. 登录成功后，回登录页用**第 1 步那个密码**尝试登录。

Expected: 第 3 步失败（密码已被作废）。同时
`psql "$DATABASE_URL" -c $'select provider_id from account where user_id = \'<那个 id>\''`
只剩 `google` 一行。

- [ ] **Step 9: 全套测试与提交**

```bash
cd apps/api && bun test && cd ../.. && bun run check:fix && bun run typecheck
git add apps/api/src
git commit -m "feat(auth): Google 登录与抢注仲裁

仲裁挂在 databaseHooks.account.create.after，位置是从 better-auth 的实现
顺序推出来的：linkAccount → 本钩子 → emailVerified=true → createSession。
所以钩子里 emailVerified 还是 false（能当判据）、session 还没建（吊销全部
会话不会误伤刚登录的人）、链接已成功（不存在密码删了但没接上的锁死）。

Google 凭据可选：本地开发不该因为没申请 OAuth 应用就跑不起来。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: 登录 / 注册页的 Google 按钮

**Files:**
- Create: `apps/web/app/components/google-button.tsx`
- Modify: `apps/web/app/routes/login.tsx`
- Modify: `apps/web/app/routes/register.tsx`
- Modify: `apps/web/messages/{zh,ja,en}.json`

**Interfaces:**
- Consumes: Task 10 的 `GET /api/config` 的 `googleEnabled`
- Produces: `<GoogleButton next={string | null} />`

- [ ] **Step 1: 三语文案**

| 键 | zh | ja | en |
|---|---|---|---|
| `auth_continue_google` | 用 Google 继续 | Google で続ける | Continue with Google |
| `auth_or` | 或 | または | or |

- [ ] **Step 2: 写按钮组件**

创建 `apps/web/app/components/google-button.tsx`：

```tsx
import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

/**
 * 图标内联而不是装图标包——根集有预算（见 CLAUDE.md），为一个 4 色小图标
 * 引一整个包不划算。
 *
 * callbackURL 统一指 /verify：那一页自己判断「邮箱验证 + handle 认领」两段
 * 是否都已完成、完成就立刻跳走。**不依赖 newUserCallbackURL**，少一个
 * 待确认的 API 面。
 */
export function GoogleButton({ next }: { next: string | null }) {
  const callbackURL = next
    ? `${localizeHref('/verify')}?next=${encodeURIComponent(next)}`
    : localizeHref('/verify')

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() =>
        authClient.signIn.social({ provider: 'google', callbackURL })
      }
    >
      <svg
        viewBox="0 0 18 18"
        aria-hidden="true"
        className="size-4"
        focusable="false"
      >
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
        />
      </svg>
      {m.auth_continue_google()}
    </Button>
  )
}
```

- [ ] **Step 3: 登录页加 loader 与按钮**

`apps/web/app/routes/login.tsx` 加一个 loader（照 `register.tsx` 的写法）：

```tsx
import { apiFor } from '~/lib/api'
import { GoogleButton } from '~/components/google-button'
import type { Route } from './+types/login'

/**
 * 只为了知道 Google 配没配。读不到时按「没配」处理——宁可少显示一个按钮，
 * 也别显示一个点下去必然失败的按钮。
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const res = await apiFor(request).api.config.$get()
    const body = (await res.json()) as { googleEnabled?: boolean }
    return { googleEnabled: body.googleEnabled === true }
  } catch {
    return { googleEnabled: false }
  }
}
```

组件签名改成 `export default function Login({ loaderData }: Route.ComponentProps)`，
并在密码表单的 `</form>` 之后插入：

```tsx
          {loaderData.googleEnabled && (
            <>
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-foreground/10" />
                <span className="text-xs text-muted-foreground">
                  {m.auth_or()}
                </span>
                <span className="h-px flex-1 bg-foreground/10" />
              </div>
              <GoogleButton next={next} />
            </>
          )}
```

- [ ] **Step 4: 注册页加同样的块**

`register.tsx` 的 loader 已经在读 `/api/config`，把它的返回值扩成：

```tsx
    return {
      registrationOpen: body.config?.registrationOpen !== false,
      googleEnabled: body.googleEnabled === true,
    }
```

并把 `catch` 分支改成 `{ registrationOpen: true, googleEnabled: false }`。

在注册表单的 `</form>` 之后插入与 Step 3 相同的那个块（**照抄，不要抽公共组件**——
两处的上下文条件不同：注册页那块还要受 `registrationOpen` 控制，抽出来反而要传更多参数）。

注意注册页的 Google 块要放在 `loaderData.registrationOpen` 为真的那个分支里，
关注册时连 Google 一起关掉——否则那就是一条绕过开关的路。

- [ ] **Step 5: 构建、门禁、手动验**

Run:
```bash
cd apps/web && bun run build && cd ../.. && bun run check-messages && bun run check-bundle-size && bun run check-css-layers
```
Expected: 全绿

Run: `bun run dev`，打开 `http://localhost:3000/login`
Expected: 配了 Google 凭据时能看到按钮并走通授权；把 `.env` 里的
`GOOGLE_CLIENT_ID` 注释掉重启后按钮消失。

- [ ] **Step 6: 提交**

```bash
bun run check:fix
git add apps/web
git commit -m "feat(web): 登录与注册页的 Google 按钮

图标内联，不引图标包（根集有预算）。注册页的按钮放在 registrationOpen
分支内——关注册时连 Google 一起关掉，否则那就是一条绕过开关的路。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: 找回密码后端 + 按邮箱的 OTP 限流

**Files:**
- Create: `apps/api/src/otp-rate.ts`
- Create: `apps/api/src/otp-rate.test.ts`
- Modify: `apps/api/src/auth.ts`

**Interfaces:**
- Consumes: Task 4 的 `OTP_EXPIRES_SECONDS`
- Produces:
  - `OTP_COOLDOWN_SECONDS = 60` / `OTP_HOURLY_QUOTA = 5`
  - `decideOtpRate(cooldownHits: number, hourHits: number): OtpRateResult`
  - **复用** Task 3 的 `OtpPurpose`，不重新定义
  - `assertOtpRate(purpose: 'email-verification' | 'forget-password', email: string): Promise<OtpRateResult>`

- [ ] **Step 1: 先探一下 `ctx.body` 拿不拿得到**

限流要按邮箱计数，而邮箱在请求体里。现有的注册开关钩子只用了 `ctx.path`，
`ctx.body` 有没有被解析**没人验证过**。先探：

在 `apps/api/src/auth.ts` 里临时加一个 `hooks.before`：

```ts
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith('/email-otp/')) {
        console.info('[probe]', ctx.path, JSON.stringify(ctx.body))
      }
    }),
  },
```

Run:
```bash
cd apps/api && bun test src/email-otp.test.ts 2>&1 | grep '\[probe\]' | head
```
Expected: 打出 `[probe] /email-otp/verify-email {"email":"...","otp":"..."}`

- 拿得到 → 按下面的 Step 3 实现，**探针代码删掉**。
- 拿不到 → 改用 `await ctx.request?.clone().json()` 读体；再不行就退回在
  `sendVerificationOTP` 回调里做，但那里插件用 `runInBackgroundOrAwait` 调用，
  抛错未必能传回客户端，限流会表现为「静默不发信」。**把实际走的是哪条路
  写进 `otp-rate.ts` 的注释。**

- [ ] **Step 2: 写失败的测试**

创建 `apps/api/src/otp-rate.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { decideOtpRate, OTP_HOURLY_QUOTA } from './otp-rate'

describe('decideOtpRate', () => {
  test('冷却窗内有过一次 → 拒绝，并给出等待秒数', () => {
    const r = decideOtpRate(1, 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryAfterSeconds).toBeGreaterThan(0)
  })

  test('冷却窗空着但小时配额用尽 → 拒绝', () => {
    const r = decideOtpRate(0, OTP_HOURLY_QUOTA)
    expect(r.ok).toBe(false)
  })

  test('两者都没超 → 放行', () => {
    expect(decideOtpRate(0, 0).ok).toBe(true)
    expect(decideOtpRate(0, OTP_HOURLY_QUOTA - 1).ok).toBe(true)
  })

  test('冷却窗优先于配额报出来 —— 它更早触发，反馈也更直观', () => {
    const r = decideOtpRate(1, OTP_HOURLY_QUOTA)
    expect(r.ok).toBe(false)
    // 冷却窗的等待时间远短于一小时
    if (!r.ok) expect(r.retryAfterSeconds).toBeLessThanOrEqual(60)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd apps/api && bun test src/otp-rate.test.ts`
Expected: FAIL，`Cannot find module './otp-rate'`

- [ ] **Step 4: 写 `apps/api/src/otp-rate.ts`**

```ts
import { db, schema } from '@gensokyo/db'
import { and, count, eq, gte } from 'drizzle-orm'
// OtpPurpose 只在一处定义（模板那边），别在这里再写一份同名同值的联合类型
import type { OtpPurpose } from './mail/templates/otp'

/**
 * OTP 的**按邮箱**限流。
 *
 * 为什么插件自带的不够：emailOTP 的 `rateLimit` 是 `pathMatcher` + better-auth
 * 核心的**按 IP** 计数。它挡不住「换 IP 轰炸同一个受害者邮箱」——那个攻击
 * 不需要账号、不需要拿到任何验证码，每一发都真实投递进受害者信箱，还直接
 * 烧掉发信额度。按 IP 还有反向代价：一个 NAT 后面的校园网共用同一份预算。
 *
 * 实现沿用 `rate.ts` 的原则：**用 SQL 数已有的行，不维护计数器**。
 * 这里数的是 `verification` 表——`resolveOTP` 每次都 INSERT 一行新的
 * （只在唯一冲突时才删旧重插），`identifier` 形如 `forget-password:<email>`，
 * `createdAt` 齐全，而 `verification_identifier_idx` 索引**本来就有**，
 * 不用新建。
 *
 * `rate.ts` 已列的两条已知限制在这里同样成立：先查后写没有互斥、只数落库的
 * 行。这一层挡的是顺序轰炸，不是并发轰炸。
 *
 * 决策部分单独成纯函数以便测试。**没有搬去 packages/shared**（那里的测试
 * 进 CI）是刻意的：它与 `verification` 表的行形状耦合，搬过去等于把一个概念
 * 劈成两个包，读的人要跳两处才看得全。这里接受「测试不进 CI」。
 */

/** 冷却窗：防连点与重复提交 */
export const OTP_COOLDOWN_SECONDS = 60
/** 小时配额：正常人一小时不会向同一个邮箱要第六次验证码 */
export const OTP_HOURLY_QUOTA = 5

export type OtpRateResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

export function decideOtpRate(
  cooldownHits: number,
  hourHits: number,
): OtpRateResult {
  // 冷却窗先判：它更早触发，给出的反馈也更直观
  if (cooldownHits > 0)
    return { ok: false, retryAfterSeconds: OTP_COOLDOWN_SECONDS }
  if (hourHits >= OTP_HOURLY_QUOTA)
    return { ok: false, retryAfterSeconds: 3600 }
  return { ok: true }
}

const since = (seconds: number) => new Date(Date.now() - seconds * 1000)

async function countSince(identifier: string, from: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.verification)
    .where(
      and(
        eq(schema.verification.identifier, identifier),
        gte(schema.verification.createdAt, from),
      ),
    )
  return Number(row?.n ?? 0)
}

export async function assertOtpRate(
  purpose: OtpPurpose,
  email: string,
): Promise<OtpRateResult> {
  const identifier = `${purpose}:${email.toLowerCase()}`
  return decideOtpRate(
    await countSince(identifier, since(OTP_COOLDOWN_SECONDS)),
    await countSince(identifier, since(3600)),
  )
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && bun test src/otp-rate.test.ts`
Expected: PASS，4 条全绿

- [ ] **Step 6: 在 `auth.ts` 接上限流与找回密码**

`emailAndPassword` 改成：

```ts
  emailAndPassword: {
    enabled: true,
    /**
     * ⚠️ **默认是 `false`。** 找回密码的典型场景就是「怀疑号被盗」——
     * 不吊销会话等于没找回：盗号者手里那个会话照样有效。
     */
    revokeSessionsOnPasswordReset: true,
  },
```

加回一个 `hooks.before`（Task 9 删掉的那个不要恢复，这是新的一道）：

```ts
  hooks: {
    /**
     * 发码类端点的**按邮箱**限流。挂在这里而不是 `sendVerificationOTP`
     * 回调里：那个回调被 `runInBackgroundOrAwait` 调用，抛错未必能传回
     * 客户端，限流会表现成「静默不发信」。
     *
     * ⚠️ 这是 better-auth 的错误信封，**不是 `fail()` 那套**——
     * `ERROR_CODES` 里的 `rate_limited` 在这里用不上。前端在 authClient
     * 侧按 `err.code` 查文案。两套错误码体系刻意不统一。
     */
    before: createAuthMiddleware(async (ctx) => {
      const purpose =
        ctx.path === '/email-otp/send-verification-otp'
          ? ((ctx.body as { type?: string })?.type as OtpPurpose | undefined)
          : ctx.path === '/email-otp/request-password-reset'
            ? ('forget-password' as const)
            : undefined
      if (!purpose) return
      const email = (ctx.body as { email?: string })?.email
      if (!email) return
      const verdict = await assertOtpRate(purpose, email)
      if (verdict.ok) return
      throw new APIError('TOO_MANY_REQUESTS', {
        code: 'RATE_LIMITED',
        message: `请等待 ${verdict.retryAfterSeconds} 秒后再试`,
      })
    }),
  },
```

（`APIError` 与 `createAuthMiddleware` 的 import 在 Task 9 删掉了，这里加回来。）

- [ ] **Step 7: 写限流的集成测试**

在 `apps/api/src/otp-rate.test.ts` 末尾追加：

```ts
import { afterAll } from 'bun:test'
import { app } from './app'
import { cleanupTracked, trackUser } from './testing'

afterAll(cleanupTracked)

describe('发码端点的按邮箱限流', () => {
  test('连着要两次验证码，第二次被冷却窗挡住', async () => {
    const email = `rate-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'hakurei-reimu-514', name: 'x' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    // 注册本身已经发过一次码（sendVerificationOnSignUp），所以下面这次
    // 必然落在冷却窗里
    const again = await app.request('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, type: 'email-verification' }),
    })
    expect(again.status).toBe(429)
  })

  test('找回密码对不存在的邮箱也返回成功 —— 不泄露邮箱是否注册过', async () => {
    const res = await app.request('/api/auth/email-otp/request-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ghost-${Date.now()}@example.com` }),
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 8: 跑全套并提交**

```bash
cd apps/api && bun test && cd ../.. && bun run check:fix && bun run typecheck
git add apps/api/src
git commit -m "feat(auth): 找回密码 + 按邮箱的 OTP 限流

revokeSessionsOnPasswordReset 默认 false，必须显式开：找回密码的典型场景
就是「怀疑号被盗」，不吊销会话等于没找回。

插件自带的限流是按 IP 的，挡不住换 IP 轰炸同一个受害者邮箱——那个攻击
不需要账号、每一发都真实投递进受害者信箱。按邮箱数 verification 表的行，
索引本来就有，沿用 rate.ts「数已有的行不维护计数器」的原则。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `/forgot` 找回密码页

**Files:**
- Create: `apps/web/app/lib/forgot-step.ts`
- Create: `apps/web/app/lib/forgot-step.test.ts`
- Create: `apps/web/app/routes/forgot.tsx`
- Modify: `apps/web/app/routes.ts`
- Modify: `apps/web/app/routes/login.tsx`（加入口链接）
- Modify: `apps/web/messages/{zh,ja,en}.json`

**Interfaces:**
- Consumes: Task 12 的后端端点
- Produces: `forgotStep(state): 'email' | 'reset' | 'done'`

- [ ] **Step 1: 写纯函数的失败测试（进 CI）**

创建 `apps/web/app/lib/forgot-step.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { forgotStep } from './forgot-step'

describe('forgotStep', () => {
  test('还没请求过 → email', () => {
    expect(forgotStep({ requested: false, reset: false })).toBe('email')
  })

  test('请求过还没重置 → reset', () => {
    expect(forgotStep({ requested: true, reset: false })).toBe('reset')
  })

  test('重置完成 → done', () => {
    expect(forgotStep({ requested: true, reset: true })).toBe('done')
  })

  test('没请求就标记重置完成是不可能的状态，按 done 处理不回退', () => {
    // 页面不该因为一个自相矛盾的状态把用户打回第一步重来
    expect(forgotStep({ requested: false, reset: true })).toBe('done')
  })
})
```

- [ ] **Step 2: 跑测试确认失败，然后写纯函数**

Run: `cd apps/web && bun test app/lib/forgot-step.test.ts` → FAIL

创建 `apps/web/app/lib/forgot-step.ts`：

```ts
export type ForgotStep = 'email' | 'reset' | 'done'

/**
 * 找回密码走到哪一步了。抽成纯函数是因为 web 的测试**进 CI**。
 *
 * `reset` 为真时一律返回 done，即使 `requested` 为假——那是个自相矛盾的
 * 状态，但把用户打回第一步重来比接受它更糟。
 */
export function forgotStep(state: {
  requested: boolean
  reset: boolean
}): ForgotStep {
  if (state.reset) return 'done'
  return state.requested ? 'reset' : 'email'
}
```

Run: `cd apps/web && bun test app/lib/forgot-step.test.ts` → PASS

- [ ] **Step 3: 三语文案**

| 键 | zh | ja | en |
|---|---|---|---|
| `auth_forgot_link` | 忘记密码？ | パスワードをお忘れですか？ | Forgot your password? |
| `auth_forgot_title` | 重置密码 | パスワードの再設定 | Reset your password |
| `auth_forgot_lead` | 填入你的邮箱，我们会发一个验证码过去。 | メールアドレスを入力すると、確認コードをお送りします。 | Enter your email and we'll send you a code. |
| `auth_forgot_sent` | 如果这个邮箱注册过，验证码已经发出了。 | このメールアドレスが登録済みであれば、確認コードを送信しました。 | If that address has an account, the code is on its way. |
| `auth_forgot_new_password` | 新密码 | 新しいパスワード | New password |
| `auth_forgot_submit` | 重置密码 | 再設定する | Reset password |
| `auth_forgot_done` | 密码已重置，请用新密码登录。 | パスワードを再設定しました。新しいパスワードでログインしてください。 | Your password is reset. Sign in with it now. |
| `auth_forgot_failed` | 验证码不对或已过期。 | コードが正しくないか、有効期限が切れています。 | That code is wrong or expired. |

> `check-messages` 只查键是否三语齐全，**查不出文案本身写错了语言**——
> 往这三张表里填字时，日文那列尤其容易混进中文汉字词。这类错误只有人能看出来。

- [ ] **Step 4: 写 `/forgot` 页**

创建 `apps/web/app/routes/forgot.tsx`。结构与 `/verify` 同构（两段式 + `useState`
推进），差别只在调用的端点：

```tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { authClient } from '~/lib/auth-client'
import { forgotStep } from '~/lib/forgot-step'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

export function meta() {
  return [{ title: `${m.auth_forgot_title()} · ${m.site_name()}` }]
}

export default function Forgot() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ requested: false, reset: false })
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const step = forgotStep(state)

  async function onRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setFailed(false)
    const value = String(new FormData(e.currentTarget).get('email') ?? '').trim()
    // 不看返回值：后端对不存在的邮箱也回成功，这是刻意的枚举防护，
    // 前端跟着一视同仁才不会把它漏掉
    await authClient.emailOtp.requestPasswordReset({ email: value })
    setEmail(value)
    setState({ requested: true, reset: false })
    setPending(false)
  }

  async function onReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setFailed(false)
    const form = new FormData(e.currentTarget)
    const { error } = await authClient.emailOtp.resetPassword({
      email,
      otp: String(form.get('otp') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    })
    setPending(false)
    if (error) return setFailed(true)
    setState({ requested: true, reset: true })
  }

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{m.auth_forgot_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'email' && (
            <form onSubmit={onRequest} className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {m.auth_forgot_lead()}
              </p>
              <div className="grid gap-2">
                <Label htmlFor="email">{m.auth_email()}</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <Button type="submit" disabled={pending}>
                {m.auth_forgot_submit()}
              </Button>
            </form>
          )}

          {step === 'reset' && (
            <form onSubmit={onReset} className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {m.auth_forgot_sent()}
              </p>
              <div className="grid gap-2">
                <Label htmlFor="otp">{m.auth_verify_code()}</Label>
                <Input
                  id="otp"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{m.auth_forgot_new_password()}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {failed && (
                <p role="alert" className="text-sm text-destructive">
                  {m.auth_forgot_failed()}
                </p>
              )}
              <Button type="submit" disabled={pending}>
                {m.auth_forgot_submit()}
              </Button>
            </form>
          )}

          {step === 'done' && (
            <div className="grid gap-4">
              <p className="text-sm">{m.auth_forgot_done()}</p>
              <Button
                type="button"
                onClick={() => navigate(localizeHref('/login'))}
              >
                {m.auth_login()}
              </Button>
            </div>
          )}

          <Link
            to={localizeHref('/login')}
            viewTransition
            className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {m.auth_have_account()}
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
```

- [ ] **Step 5: 加路由与登录页入口**

`apps/web/app/routes.ts`，在 `route('verify', …)` 之后加：

```ts
    route('forgot', 'routes/forgot.tsx'),
```

`login.tsx` 的密码字段之后加一个链接：

```tsx
            <Link
              to={localizeHref('/forgot')}
              viewTransition
              className="text-right text-xs text-muted-foreground hover:text-foreground"
            >
              {m.auth_forgot_link()}
            </Link>
```

- [ ] **Step 6: 手动走一遍完整链路**

Run: `bun run dev`
1. `/forgot` 填一个已注册邮箱 → 看 api 的 stdout 取码
2. 填码 + 新密码 → 提示成功
3. 用新密码登录 → 成功
4. `psql "$DATABASE_URL" -c $'select email_verified from "user" where email = \'<那个邮箱>\''`

Expected: 第 4 步是 `t`——**重置密码会顺带把邮箱标成已验证**（better-auth 内置，
逻辑正确：能读到那封信就是证明了邮箱所有权）。这同时意味着找回密码是「验证邮箱」
的第二条合法路径。

- [ ] **Step 7: 门禁与提交**

```bash
cd apps/web && bun test && bun run build && cd ../.. && bun run check-messages && bun run check-bundle-size && bun run check:fix
git add apps/web
git commit -m "feat(web): /forgot 找回密码页

前端对「邮箱不存在」也一视同仁地显示成功——后端的枚举防护是内置的，
前端跟着一视同仁才不会把它漏掉。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: e2e、全门禁、文档收尾

**Files:**
- Modify: `apps/api/scripts/e2e.ts`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-11-auth-email-google-design.md`
- Modify: `deploy/compose.yml`、`.env.example`（若存在）

**Interfaces:**
- Consumes: 前 13 个任务的全部产出
- Produces: 可上线的完整功能

- [ ] **Step 1: 给 e2e 加两条链路**

先看清现有结构（40 项验收都在这一个文件里）：

Run: `sed -n '1,80p' apps/api/scripts/e2e.ts`

然后加两条：

1. **注册 → 取码 → 验证 → 发帖**：注册一个账号，从 console transport 的 stdout
   取出 6 位码（e2e 与 api 同进程时直接拦 `console.info`；不同进程时读日志），
   打 `/api/auth/email-otp/verify-email`，再发一个主题并断言 201。
2. **未验证不能发帖**：注册后**不验证**，直接发主题，断言 403 且
   `error.code === 'email_unverified'`。

第 2 条比第 1 条重要——它是这个里程碑的核心承诺。

- [ ] **Step 2: 跑 e2e**

Run: `cd apps/api && bun run e2e`
Expected: 原有 40 项 + 新增 2 项全绿，跑完自清理

- [ ] **Step 3: 跑全套门禁**

Run:
```bash
bun run check && bun run typecheck && bun run check-messages \
  && bunx turbo run test --filter=@gensokyo/web --filter=@gensokyo/shared \
  && bun run check-motion-boundary \
  && (cd apps/web && bun run build) \
  && bun run check-css-layers && bun run check-bundle-size && bun run check-write-guard
```
Expected: 全绿。**这一串就是 CI 会跑的东西**，本地过了 CI 才会过。

Run: `cd apps/api && bun test && cd ../packages/db && bun test`
Expected: 全绿（这两个不进 CI，只能本地跑）

- [ ] **Step 4: 生产环境变量**

`deploy/compose.yml` 的 `app-env` 锚点里补上新变量：

```yaml
  MAIL_TRANSPORT: ${MAIL_TRANSPORT}
  MAIL_FROM: ${MAIL_FROM}
  RESEND_API_KEY: ${RESEND_API_KEY}
  SMTP_HOST: ${SMTP_HOST}
  SMTP_PORT: ${SMTP_PORT}
  SMTP_USER: ${SMTP_USER}
  SMTP_PASS: ${SMTP_PASS}
  SMTP_SECURE: ${SMTP_SECURE}
  GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
  GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
```

> ⚠️ 漏一个的表现与 `SITE_URL` 那次一样：**不报错，只是行为不对**——
> `MAIL_TRANSPORT` 没传进容器时会默认成 `console`，于是生产上所有验证码
> 都打进了容器日志、一封信都没发出去，而用户只看到「卡在验证页」。
>
> 上线后**必须实际注册一个账号收一封信**才算验完。

- [ ] **Step 5: 更新 CLAUDE.md**

在「博丽神社（M4，已完成）约定」之后插入一段「认证（M6）约定」：

```markdown
- 认证（邮箱验证 / Google / 找回密码）约定：
  - **「验证后才能写」只有一个强制点**：`requireVerified`（`requireRole` 隐含它）。
    判据是「是否产出对外可见的内容」。**新增任何非 GET 路由必须回答「它挂的是
    哪一个」**——`bun run check-write-guard` 把这条钉成断言，它枚举 `app.routes`
    做**函数身份**比对（守卫登记在 `middleware/require.ts` 的 WeakSet 里），
    所以改路径改文件名都不会让它失灵。豁免写在脚本顶部，**往那里加一行就是
    一次安全决策**。子应用的 `.use('*', requireRole(...))` 在 `app.routes` 里是
    独立的 `ALL /api/admin/*` 条目、不并进各路由分组，所以前缀守卫要单独匹配
  - **注册开关只有一个强制点**：`user.validateUserInfo` 的 `create-user` 分支。
    它横跨每一种认证方式，所以「加了新登录方式要记得再判一次」这件事不存在。
    **不要退回按路径拦 `/sign-up/email`**
  - **emailOTP 插件有三个默认值是为「快速跑通」调的，不是为生产调的**：
    `storeOTP` 默认 `'plain'`（验证码明文躺在 `verification` 表）、`disableSignUp`
    默认 `false`（等于多一条绕过注册开关的注册路径）、
    `emailAndPassword.revokeSessionsOnPasswordReset` 默认 `false`（找回密码不吊销
    会话）。配置块里每一项都要能说出为什么
  - **Google 撞车仲裁挂在 `databaseHooks.account.create.after`**，位置由 better-auth
    的实现顺序决定：`linkAccount → 本钩子 → emailVerified=true → createSession`。
    所以钩子里 `emailVerified` 还是 false（能当判据）、session 还没建（吊销全部会话
    不会误伤刚登录的人）、链接已成功（不存在密码删了但没接上的锁死）。
    它依赖 `requireLocalEmailVerified: false`，而那个选项**已 deprecated**，
    升级 better-auth 后仲裁失效、退回「拒绝链接」——朝安全方向的退化，
    `arbitrate.test.ts` 会在那时变红
  - **mail 模块不在模块顶层读 env**：它被 `auth.ts` → `app.ts` 传递引用，而测试
    导入的正是 app。顶层读会让整个 api 测试套件因缺 `RESEND_API_KEY` 而起不来，
    症状表现成「测试挂了」。启动即炸由 `env.ts`（只被 index.ts import）负责
  - 发信只有一个出口 `sendMail()`（`mail/index.ts`），三个 transport 由
    `MAIL_TRANSPORT` 选。**console 通道不是玩具**：e2e 靠它取验证码
  - 邮件语言从 `X-Gensokyo-Locale` 头取，回落 Paraglide cookie 再回落 `zh`。
    **不读 `Accept-Language`**——那是浏览器语言，不是站内选的界面语言
  - OTP 的按邮箱限流在 `otp-rate.ts`，数 `verification` 表的行（索引本来就有）。
    插件自带的是按 IP 的，挡不住换 IP 轰炸同一个受害者邮箱
  - **better-auth 路由的错误信封与 `fail()` 的 `ERROR_CODES` 是两套，不要统一**
```

同时把「常用脚本」那条里补上 `check-write-guard`。

- [ ] **Step 6: 把 spec 里已解决的悬念标掉**

改 `docs/superpowers/specs/2026-09-11-auth-email-google-design.md` 的 §8.3：

- 第 1 条（`app.routes` 形状）**写计划时已实测结案**，spec 里已经改好，不用动。
- 第 2 条（`validateUserInfo` 拒绝时的 `code`）按 Task 9 Step 1 的实测结果填上
  实际值并标为结案。
- 第 3 条（国内邮箱送达率）**保持开放**——它是产品风险不是实现风险，只有
  上线后拿真实邮箱试过才能结案。上线检查表第 5 项就是它。

- [ ] **Step 7: 提交**

```bash
bun run check:fix
git add -A
git commit -m "docs+test: 认证里程碑收尾——e2e、CLAUDE.md 约定、spec 悬念结案

e2e 的第二条链路（未验证不能发帖）比第一条重要：它是这个里程碑的核心承诺。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 不在本计划内的一件事

spec §8.1 列了一个**单列的可选任务**：把 better-auth 的限流接到 redis 的
`secondaryStorage`。本计划**不做它**，理由是它会让 redis 从「装了没用」变成
「挂了影响登录」，是一次真实的依赖升级，值得单独决策。

它的现状与影响，供将来决定时参考：

- `REDIS_URL` 已在 `.env`、`bun run services` 也在起它，但**全仓零处使用**。
- better-auth 核心的限流默认存进程内存，**多进程部署下各算各的**。
- 本计划 Task 12 的按邮箱限流**不受这条影响**——它数的是 Postgres 里的行，
  跨进程天然一致。受影响的只有 better-auth 自带的那层按 IP 限流。

换句话说：不接 redis 的代价是「按 IP 那层在多进程下变松」，而真正挡轰炸的
那层（按邮箱）是准确的。

---

## 上线检查表

按 `prod-deploy-procedure` 的顺序（rsync → build → **单独 migrate** → up -d），另加：

1. **先配齐环境变量再 migrate**：`MAIL_TRANSPORT` / `MAIL_FROM` / 对应通道的凭据 /
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`。漏了不报错，只是行为不对。
2. **Google Cloud Console 里加生产回调 URI**：`https://<域名>/api/auth/callback/google`。
3. **migrate 跑完确认老账号都刷成了已验证**：
   `select email_verified, count(*) from "user" group by 1` 应只有一行 `t`。
4. **上线后实际注册一个账号、收一封真信**。这一步不能用日志代替——
   `MAIL_TRANSPORT` 没传进容器时会默认成 `console`，表现是「所有验证码都进了
   容器日志，一封信都没发出去」，而这在日志里看起来一切正常。
5. **特别留意国内邮箱**：拿一个 QQ 邮箱和一个 163 邮箱各注册一次。收不到就是
   spec §8.3 第 3 条那个风险成真了，改 `MAIL_TRANSPORT=smtp` 换国内服务商。
