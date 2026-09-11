import { z } from 'zod'

/**
 * 邮件通道的环境变量。**按 MAIL_TRANSPORT 分支校验**——选了 resend 却没给
 * key，进程应该在监听端口之前就炸，而不是等到第一个人注册。
 *
 * ⚠️ **这个文件不在模块顶层读 `process.env`。** mail 会被 auth.ts → app.ts
 * 传递引用，而测试导入的正是 app；顶层读 env 会让整个 api 测试套件因为缺一个
 * 生产变量而起不来，且症状表现成「测试挂了」，没人会想到是邮件模块。
 * 真正的「启动即炸」由 `env.ts`（只被 index.ts import）调 parseMailEnv 达成。
 *
 * ⚠️ **空串不等于「没配」，它会让进程起不来——这是刻意保留的行为。**
 * `?? 'console'` 与 `.default()` 都只对 `undefined` 生效，而 Docker Compose
 * 把**未设置**的变量替换成**空串**（`MAIL_TRANSPORT: ${MAIL_TRANSPORT}` 在
 * 宿主没导出该变量时传进容器的是 `MAIL_TRANSPORT=''`）。于是：
 *
 * - `parseMailEnv({})` → console（本地 shell 里真的没这个变量，dev 与测试）
 * - `parseMailEnv({ MAIL_TRANSPORT: '' })` → **抛错**（compose 漏填）
 *
 * 后者正是我们要的：生产上漏配邮件通道，容器**起不来**（healthcheck 红、
 * 滚动更新停住），而不是静默退回 console 把所有验证码打进日志、看起来一切
 * 正常。`deploy/.env.example` 与 `deploy/compose.yml` 的注释按「必须存在且
 * 非空」写，就是这条。
 *
 * 同一条规则对 `SMTP_SECURE` 一视同仁：它的 `.default('false')` 只在调用方
 * **整个键都不给**时兜底（本地 / 测试），compose 下漏填拿到的是空串、照样
 * 抛错。**不给它开空串豁免**——开了就得给 `MAIL_TRANSPORT` 也开，那等于把
 * 上面那个「起不来」换回「静默 console」。
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
