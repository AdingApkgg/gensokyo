import { m } from '~/paraglide/messages'

/**
 * 把 api 的 `error.code` 翻成人话。
 *
 * 约定是 api **只返回 key**、不返回可读消息（见 CLAUDE.md），
 * 所以这张表是那条约定在前端的另一半。少了它，错误码要么被静默丢弃，
 * 要么原样显示给用户——两种都发生过。
 *
 * 没列在表里的码回落到一句通用文案：**宁可说得笼统，也不能一声不吭**。
 */
const MESSAGES: Record<string, () => string> = {
  rate_limited: () => m.err_rate_limited(),
  link_not_allowed: () => m.err_link_not_allowed(),
  mention_limit_exceeded: () => m.err_mention_limit_exceeded(),
  validation_failed: () => m.err_validation_failed(),
  unauthorized: () => m.err_unauthorized(),
  forbidden: () => m.err_forbidden(),
  not_found: () => m.err_not_found(),
  duplicate_slug: () => m.err_duplicate_slug(),
  invalid_state_transition: () => m.err_invalid_state_transition(),
}

export const errorMessage = (code: string | undefined): string =>
  (code && MESSAGES[code]?.()) || m.err_generic()

/** api 的错误信封。hc 客户端对非 2xx **不抛异常**，所以必须自己读 */
type ApiError = { error?: { code?: string } }

/**
 * 结构化地收 hc 的响应，而不是收 `Response`。
 *
 * hc 返回的是 `ClientResponse<T>`——它带着响应体的类型参数，与 DOM 的
 * `Response` 不兼容（少 textStream 等成员）。这里只用到 `ok` 与 `json()`，
 * 那就只要求这两样，任何端点的响应都能传进来。
 */
type ReadableResponse = { ok: boolean; json: () => Promise<unknown> }

/**
 * 读一个 hc 响应，成功返回 null，失败返回错误码。
 *
 * ⚠️ **hono 的 hc 客户端不会因为 4xx/5xx 抛异常。** `await` 完就当成功
 * 是这个仓库里出现过的真实 bug：资源页的评论 action 无条件返回
 * `{ ok: true }`，于是限流和外链禁令的拒绝变成「评论凭空消失」——
 * 用户看到的是表单清空、没有新楼层、没有任何提示。
 */
export async function apiErrorCode(
  res: ReadableResponse,
): Promise<string | null> {
  if (res.ok) return null
  const body = (await res.json().catch(() => null)) as ApiError | null
  return body?.error?.code ?? 'generic'
}
