import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

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
