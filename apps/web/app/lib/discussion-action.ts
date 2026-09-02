import { LOCALES, type Locale, REPORT_REASON } from '@gensokyo/shared'
import { apiFor } from '~/lib/api'
import { apiErrorCode } from '~/lib/api-error'

/**
 * `?floor=` 只在是正整数时才传给 api；别的值一律回落第一页。
 * 直接透传的话 api 对 abc/0/-1 回 400，loader 把整个讨论区置空——用户看到的是
 * 「还没有人评论」的假象，连回复框都没了。两个页面共用这一条。
 */
export function floorParam(url: string): { from?: string } {
  const raw = new URL(url).searchParams.get('floor')
  if (!raw || !/^[1-9][0-9]{0,8}$/.test(raw)) return {}
  return { from: raw }
}

const localeOf = (v: FormDataEntryValue | null): Locale | undefined =>
  typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
    ? (v as Locale)
    : undefined

export type DiscussionResult =
  | { ok: true; intent: string; floor?: number }
  | { ok: false; intent: string; code: string; draft?: string }

/**
 * 讨论区四个 intent 的 action 处理。资源页与主题页**共用这一份**——
 * 两个页面各写一遍就是两份错误映射、两份参数解析，必然漂移。
 *
 * 返回 null 表示这个 intent 不归它管，调用方接着处理自己的（评分、收藏、下架）。
 * hc 客户端对 4xx/5xx 不抛异常，每一条都要读响应。
 */
export async function discussionAction(
  request: Request,
  form: FormData,
  topicId: string | null,
): Promise<DiscussionResult | null> {
  const intent = String(form.get('intent') ?? '')
  const api = apiFor(request)

  const locale = localeOf(form.get('locale'))

  if (intent === 'comment') {
    const bodyMd = String(form.get('bodyMd') ?? '').trim()
    const parentId = String(form.get('parentId') ?? '') || undefined
    if (!bodyMd || !topicId)
      return { ok: false, intent, code: 'validation_failed' }
    const res = await api.api.shrine.topics[':id'].posts.$post({
      param: { id: topicId },
      json: {
        bodyMd,
        ...(parentId ? { parentId } : {}),
        ...(locale ? { locale } : {}),
      },
    })
    const code = await apiErrorCode(res)
    if (code) return { ok: false, intent, code, draft: bodyMd }
    const { floor } = (await res.json()) as { floor: number }
    return { ok: true, intent, floor }
  }

  if (intent === 'edit') {
    const bodyMd = String(form.get('bodyMd') ?? '').trim()
    const postId = String(form.get('postId') ?? '')
    if (!bodyMd || !postId)
      return { ok: false, intent, code: 'validation_failed' }
    const res = await api.api.shrine.posts[':id'].$patch({
      param: { id: postId },
      json: { bodyMd, ...(locale ? { locale } : {}) },
    })
    const code = await apiErrorCode(res)
    return code
      ? { ok: false, intent, code, draft: bodyMd }
      : { ok: true, intent }
  }

  if (intent === 'delete') {
    const postId = String(form.get('postId') ?? '')
    const reason = String(form.get('reason') ?? '') || undefined
    if (!postId) return { ok: false, intent, code: 'validation_failed' }
    /**
     * api 的 DELETE 故意不挂 validate('json')（作者删自己的楼不带 body），
     * 所以 hc 没有 json 槽——body 走 init，content-type 走 headers（**不能**放进
     * init.headers：那会整体覆盖 hc 合成的 headers，把转发的 cookie 一起丢掉）。
     */
    const res = await api.api.shrine.posts[':id'].$delete(
      { param: { id: postId } },
      reason
        ? {
            headers: { 'content-type': 'application/json' },
            init: { body: JSON.stringify({ reason }) },
          }
        : undefined,
    )
    const code = await apiErrorCode(res)
    return code ? { ok: false, intent, code } : { ok: true, intent }
  }

  if (intent === 'report') {
    const targetKind =
      form.get('targetKind') === 'resource' ? 'resource' : 'post'
    const targetId = String(form.get('targetId') ?? '')
    const reasonRaw = String(form.get('reason') ?? '')
    const detail = String(form.get('detail') ?? '').slice(0, 2000)
    // 枚举守卫之后不需要断言；`as never` 会把整个参数变成 never，键名写错都不报
    const reason = (REPORT_REASON as readonly string[]).includes(reasonRaw)
      ? (reasonRaw as (typeof REPORT_REASON)[number])
      : null
    if (!targetId || !reason)
      return { ok: false, intent, code: 'validation_failed' }
    const res = await api.api.reports.$post({
      json: { targetKind, targetId, reason, detail },
    })
    const code = await apiErrorCode(res)
    return code ? { ok: false, intent, code } : { ok: true, intent }
  }

  return null
}
