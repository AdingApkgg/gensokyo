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
 * （只在唯一冲突时才删旧重插），`createdAt` 齐全，而
 * `verification_identifier_idx` 索引**本来就有**，不用新建。
 *
 * ⚠️ **`identifier` 的拼接格式不是我们定的，是 better-auth 内部私有的
 * `toOTPIdentifier()`**（`better-auth/dist/plugins/email-otp/utils.mjs`，
 * 未导出、不属于公开 API）：
 * ```js
 * function toOTPIdentifier(type, email) {
 * \treturn `${type}-otp-${email}`;
 * }
 * ```
 * 也就是 `email-verification-otp-<email>` / `forget-password-otp-<email>`，
 * **不是**直觉上更好读的 `<type>:<email>`。email 在 better-auth 侧写库前
 * 已经 `.toLowerCase()` 过（`send-verification-otp` 与
 * `request-password-reset` 两条路径都是），这里的 `toIdentifier()` 同样
 * 转小写，保证探针大小写无关地命中同一行。
 *
 * 这处耦合没有类型能保护——写错格式不会报错，只会让下面的 COUNT 永远数到
 * 0 行，限流表现成「永远放行」且不抛任何异常，是本仓库最怕的静默失效。
 * `otp-rate.test.ts` 里额外有一条测试专门钉住这一点：真实触发一次发码，
 * 断言 `countOtpRows` 数得到 ≥ 1 行；一旦 better-auth 升级改了格式，
 * 那条测试会先红，而不是线上限流悄悄失效。
 *
 * `rate.ts` 已列的两条已知限制在这里同样成立：先查后写没有互斥、只数落库的
 * 行。这一层挡的是顺序轰炸，不是并发轰炸。
 *
 * 决策部分单独成纯函数以便测试。**没有搬去 packages/shared**（那里的测试
 * 进 CI）是刻意的：它与 `verification` 表的行形状耦合，搬过去等于把一个概念
 * 劈成两个包，读的人要跳两处才看得全。这里接受「测试不进 CI」。
 *
 * 挂载点：`auth.ts` 的 `hooks.before`，不是 `sendVerificationOTP` 回调。
 * Step 1 探针已经证实 `hooks.before` 里 `ctx.body` 对
 * `/email-otp/send-verification-otp` 与 `/email-otp/request-password-reset`
 * 都是**已解析好的请求体**（打印出了完整的 `{ email, type }` /
 * `{ email }`），不需要 `ctx.request?.clone().json()` 兜底。选 `hooks.before`
 * 而不是回调，是因为回调被插件用 `runInBackgroundOrAwait` 调用，那里抛错
 * 未必能传回客户端——限流会表现成「静默不发信」而不是明确的 429。
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

/**
 * better-auth 私有 `toOTPIdentifier()` 的镜像实现——见上方长注释。
 * 格式：`${purpose}-otp-${email}`，email 小写。
 */
function toIdentifier(purpose: OtpPurpose, email: string): string {
  return `${purpose}-otp-${email.toLowerCase()}`
}

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

/**
 * 数「某邮箱 + 某用途」在过去 `seconds` 秒内 better-auth 写下的验证码行数。
 *
 * 单独导出（而不是把 identifier 拼接藏在 `assertOtpRate` 内部）是为了让
 * `otp-rate.test.ts` 能绕开 `decideOtpRate` 的冷却/配额判断，直接断言
 * 「真实发一次码之后，这里数得到 ≥ 1 行」——那条测试锁的是 identifier
 * 拼接格式本身，不是限流决策逻辑。
 */
export async function countOtpRows(
  purpose: OtpPurpose,
  email: string,
  seconds = 3600,
): Promise<number> {
  return countSince(toIdentifier(purpose, email), since(seconds))
}

export async function assertOtpRate(
  purpose: OtpPurpose,
  email: string,
): Promise<OtpRateResult> {
  return decideOtpRate(
    await countOtpRows(purpose, email, OTP_COOLDOWN_SECONDS),
    await countOtpRows(purpose, email, 3600),
  )
}
