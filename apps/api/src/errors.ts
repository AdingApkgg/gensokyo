import { entityIdSchema, userIdSchema } from '@gensokyo/shared'
import { zValidator as zv } from '@hono/zod-validator'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

/**
 * 只列真会抛出的码。错误消息本身不在这里——api 返回 key，
 * 由前端用 Paraglide 本地化，因为同一个错误要用三种语言说。
 */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'rate_limited',
  'quota_exceeded',
  'invalid_state_transition',
  'invalid_url',
  'file_too_large',
  'duplicate_slug',
  'self_action_forbidden',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type ApiError = { error: { code: ErrorCode; fields?: string[] } }

export const fail = (
  c: Context,
  code: ErrorCode,
  status: ContentfulStatusCode = 400,
  fields?: string[],
) =>
  c.json<ApiError>({ error: { code, ...(fields ? { fields } : {}) } }, status)

/**
 * 带统一错误信封的 zValidator。
 *
 * 裸 zValidator 校验失败时返回 ZodError 的英文散文，与 fail() 形状不同——
 * 前端得处理两种错误结构，而「返回 key 交给 Paraglide 本地化」这条约定
 * 恰恰在最高频的错误类型上失效。
 */
type ZodIssueLike = { path: PropertyKey[] }
type ValidationResult =
  | { success: true }
  | { success: false; error: { issues: ZodIssueLike[] } }

// 内部用 any 只是为了原样转发 zValidator 的泛型；对外仍是它的完整签名
export const validate = ((
  // biome-ignore lint/suspicious/noExplicitAny: 泛型转发
  target: any,
  // biome-ignore lint/suspicious/noExplicitAny: 泛型转发
  schema: any,
) =>
  zv(target, schema, (result: ValidationResult, c: Context) => {
    if (!result.success) {
      const fields = [
        ...new Set(
          result.error.issues
            .map((i) =>
              i.path
                .filter((p): p is string | number => typeof p !== 'symbol')
                .join('.'),
            )
            .filter((p) => p !== ''),
        ),
      ]
      return fail(c, 'validation_failed', 400, fields)
    }
  })) as typeof zv

/** 路径里的实体 id 必须先校验；直接喂给 uuid 列会让 Postgres 抛 22P02 → 500 */
export const entityIdParam = validate('param', z.object({ id: entityIdSchema }))

/**
 * 用户 id 是 better-auth 的 32 位随机串，**不是 UUID**。
 * 用 entityIdParam 卡用户路由会让端点对每个真实用户都返回 400。
 */
export const userIdParam = validate('param', z.object({ id: userIdSchema }))
