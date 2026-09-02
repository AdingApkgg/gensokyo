import { REPORT_REASON, type ReportReason } from '@gensokyo/shared'
import { Link, useFetcher } from 'react-router'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { apiFor } from '~/lib/api'
import { apiErrorCode, errorMessage } from '~/lib/api-error'
import { displayTitle, reportReasonLabel } from '~/lib/display'
import { formatAbsolute } from '~/lib/time'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/reports'

export function meta() {
  return [{ title: `${m.dash_reports()} · ${m.dash()}` }]
}

/** api 已按紧急度排好（版权/违法 → 骚扰 → 灌水 → 其他），这里不再重排 */
export async function loader({ request }: Route.LoaderArgs) {
  const res = await apiFor(request).api.moderation.reports.$get({
    query: { pageSize: '50' },
  })
  const body = await res.json()
  if ('error' in body) return { items: [], total: 0 }
  return body
}

/**
 * 三个动作：已处理 / 驳回（只改 report.status），以及 **删楼并结案**——
 * 此前处理一条帖子举报要「复制 uuid → 猜属于哪个主题 → 去删楼 → 回来 resolve」，
 * 第 2、3 步做不到，「举报-处理-申诉闭环」在帖子上就是断的（P0-7）。
 * 删楼的理由就是举报的理由（同一个枚举），staff 删他人楼会按理由记违规并通知作者。
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const api = apiFor(request)
  const id = String(form.get('id'))

  if (form.get('intent') === 'delete_post') {
    const postId = String(form.get('postId') ?? '')
    const reasonRaw = String(form.get('reason') ?? '')
    const reason = (REPORT_REASON as readonly string[]).includes(reasonRaw)
      ? (reasonRaw as ReportReason)
      : null
    if (!postId || !reason)
      return { ok: false as const, code: 'validation_failed' }
    const del = await api.api.shrine.posts[':id'].$delete(
      { param: { id: postId } },
      {
        headers: { 'content-type': 'application/json' },
        init: { body: JSON.stringify({ reason }) },
      },
    )
    const code = await apiErrorCode(del)
    if (code) return { ok: false as const, code }
  }

  const res = await api.api.moderation.reports[':id'].resolve.$post({
    param: { id },
    json: {
      status: form.get('status') === 'rejected' ? 'rejected' : 'resolved',
    },
  })
  const code = await apiErrorCode(res)
  return code ? { ok: false as const, code } : { ok: true as const }
}

type Item = Awaited<ReturnType<typeof loader>>['items'][number]

const URGENT: ReportReason[] = ['copyright', 'illegal']

/** 举报对象的跳转零件：帖子 → 所属主题（资源主题去资源页）；资源 → 资源页 */
function targetOf(r: Item): {
  label: string
  href: string | null
  gone: boolean
} {
  if (r.targetKind === 'post') {
    if (!r.postTopicId)
      return { label: m.dash_target_gone(), href: null, gone: true }
    const floor = `?floor=${r.postFloor}#p${r.postFloor}`
    const title = r.resourceSlug
      ? displayTitle({
          titleOriginal: r.resourceTitleOriginal ?? '',
          titleOriginalLocale: r.resourceTitleOriginalLocale ?? 'ja',
          title: r.resourceTitle,
        })
      : (r.topicTitle ?? '')
    const href = r.resourceSlug
      ? `${localizeHref(`/kourindou/${r.resourceSlug}`)}${floor}`
      : `${localizeHref(`/shrine/t/${r.postTopicId}`)}${floor}`
    return { label: `#${r.postFloor} · ${title}`, href, gone: false }
  }
  if (!r.resourceSlug)
    return { label: m.dash_target_gone(), href: null, gone: true }
  return {
    label: displayTitle({
      titleOriginal: r.resourceTitleOriginal ?? '',
      titleOriginalLocale: r.resourceTitleOriginalLocale ?? 'ja',
      title: r.resourceTitle,
    }),
    href: localizeHref(`/kourindou/${r.resourceSlug}`),
    gone: false,
  }
}

function Actions({ r }: { r: Item }) {
  const fetcher = useFetcher<typeof action>()
  const busy = fetcher.state !== 'idle'
  const canDelete =
    r.targetKind === 'post' && !!r.postTopicId && !r.postDeletedAt
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {canDelete && (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() =>
              fetcher.submit(
                {
                  id: r.id,
                  intent: 'delete_post',
                  postId: r.targetId,
                  reason: r.reason,
                  status: 'resolved',
                },
                { method: 'post' },
              )
            }
          >
            {m.dash_delete_and_resolve()}
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            fetcher.submit({ id: r.id, status: 'resolved' }, { method: 'post' })
          }
        >
          {m.dash_report_resolve()}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            fetcher.submit({ id: r.id, status: 'rejected' }, { method: 'post' })
          }
        >
          {m.dash_report_dismiss()}
        </Button>
      </div>
      {fetcher.data && !fetcher.data.ok && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(fetcher.data.code)}
        </p>
      )}
    </div>
  )
}

export default function Reports({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData

  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="font-heading text-lg">{m.dash_empty_reports()}</p>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-4">
      {items.map((r) => {
        const t = targetOf(r)
        return (
          <Card key={r.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    URGENT.includes(r.reason) ? 'destructive' : 'secondary'
                  }
                >
                  {reportReasonLabel(r.reason)}
                </Badge>
                <Badge variant="outline">
                  {r.targetKind === 'post'
                    ? m.dash_target_post()
                    : m.dash_target_resource()}
                </Badge>
                {r.targetKind === 'post' && r.postDeletedAt && (
                  <Badge variant="outline">{m.dash_target_deleted()}</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatAbsolute(r.createdAt)}
                </span>
              </div>
              <CardTitle className="mt-2 text-base">
                {t.href ? (
                  <Link to={t.href} className="hover:underline">
                    {t.label}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{t.label}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {r.detail && (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {r.detail}
                </p>
              )}
              <Actions r={r} />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
