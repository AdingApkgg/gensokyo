import { REPORT_REASON, type ReportReason } from '@gensokyo/shared'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useFetchers, useSearchParams } from 'react-router'
import { AlertLine } from '~/components/alert-line'
import { LiveRegion } from '~/components/live-region'
import { RemovableRow } from '~/components/removable-row'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '~/components/ui/pagination'
import { apiFor } from '~/lib/api'
import { apiErrorCode, errorMessage } from '~/lib/api-error'
import {
  mergeWatched,
  pendingIdsFrom,
  withoutPending,
} from '~/lib/dash-pending'
import { displayTitle, reportReasonLabel } from '~/lib/display'
import { pageWindow } from '~/lib/paging'
import { formatAbsolute } from '~/lib/time'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/reports'

export function meta() {
  return [{ title: `${m.dash_reports()} · ${m.dash()}` }]
}

/** api 已按紧急度排好（版权/违法 → 骚扰 → 灌水 → 其他），这里不再重排 */
export async function loader({ request }: Route.LoaderArgs) {
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1
  const res = await apiFor(request).api.moderation.reports.$get({
    query: { page: String(page), pageSize: '50' },
  })
  const body = await res.json()
  // 失败分支也要给全形状：少了 page/pageSize，loaderData 会是联合类型，
  // 组件里读 loaderData.page 直接是 TS 错误
  if ('error' in body) return { items: [], page: 1, pageSize: 50, total: 0 }
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

/**
 * 前缀**不能与 queue 的 `review:` 共用**：两个页面的 action 返回形状不同，
 * 共用会让一边的列表层读到另一边的 data。
 */
const FETCHER_PREFIX = 'report:'

/**
 * 替一张已经飞出去的卡片守着它的 fetcher，结算时把结果交回列表层。
 * 理由同 queue.tsx 的同名组件：卡片在 submitting 那一帧就卸载，
 * 而 data 要到 idle 才有，写在卡片里的 effect 永远不触发。
 */
function PendingWatcher({
  id,
  onSettled,
}: {
  id: string
  onSettled: (id: string, code?: string) => void
}) {
  const fetcher = useFetcher<typeof action>({ key: `${FETCHER_PREFIX}${id}` })
  const { state, data } = fetcher
  useEffect(() => {
    if (state !== 'idle' || !data) return
    onSettled(id, data.ok === false ? data.code : undefined)
  }, [state, data, id, onSettled])
  return null
}

function Actions({ r }: { r: Item }) {
  const fetcher = useFetcher<typeof action>({
    key: `${FETCHER_PREFIX}${r.id}`,
  })
  const busy = fetcher.state !== 'idle'
  const canDelete =
    r.targetKind === 'post' && !!r.postTopicId && !r.postDeletedAt
  return (
    // relative：AlertLine 的 popLayout 用 offsetParent 定位退场元素（红线 9）
    <div className="relative grid gap-2">
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
      {/*
        这一行在按钮**之后**，出现时按钮位置不动——所以按钮行不加 layout，
        加了是纯空操作。canDelete 那个条件不在本任务范围：它由行数据决定
        （targetKind/postTopicId/postDeletedAt），不是客户端交互驱动的。
      */}
      <AlertLine
        show={!!fetcher.data && !fetcher.data.ok}
        className="text-xs text-destructive"
      >
        {fetcher.data && !fetcher.data.ok
          ? errorMessage(fetcher.data.code)
          : null}
      </AlertLine>
    </div>
  )
}

export default function Reports({ loaderData }: Route.ComponentProps) {
  const { items, total, page, pageSize } = loaderData
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const [params] = useSearchParams()
  /** 照抄 kourindou/list.tsx：第 1 页不写 ?page=1，翻页保住现有 query */
  const pageHref = (p: number) => {
    const next = new URLSearchParams(params)
    if (p <= 1) next.delete('page')
    else next.set('page', String(p))
    const qs = next.toString()
    return qs ? `?${qs}` : '.'
  }

  /**
   * 乐观移除。这里「在途 = 该行要走」**三个 intent 全都成立**：
   * api 的 /moderation/reports 只列 `status = 'open'`，而删楼并结案、已处理、
   * 驳回三个动作都把 status 推离 open。唯一的例外是 delete_post 在删楼那步
   * 就失败、没走到 resolve——那条会以失败结算，卡片飞回来，正是该有的样子。
   */
  const pendingIds = pendingIdsFrom(useFetchers(), FETCHER_PREFIX)
  const visible = withoutPending(items, pendingIds)

  /**
   * 盯梢集合是**并集不是当前在途集**。`fetcher.data` 恰好在它变回 idle 的
   * 那一帧才有，而那一帧它已经不在在途集里了——只渲染在途集的话，
   * PendingWatcher 会在拿到结果的同一次提交里卸载，effect 永远不触发。
   * 实测踩过这个坑：处理一条之后 LiveRegion 全程是空字符串。
   */
  const [watched, setWatched] = useState<string[]>([])
  const pendingKey = pendingIds.join(',')
  useEffect(() => {
    if (!pendingKey) return
    setWatched((w) => mergeWatched(w, pendingKey.split(',')))
  }, [pendingKey])

  /** 结算时 loaderData 多半已 revalidate 掉那一行，播报要的标题只能提前存 */
  const labels = useRef(new Map<string, string>())
  for (const r of items) labels.current.set(r.id, targetOf(r).label)

  const [announce, setAnnounce] = useState('')
  const onSettled = useCallback((id: string, code?: string) => {
    setAnnounce(
      code
        ? m.dash_announce_failed({ reason: errorMessage(code) })
        : m.dash_announce_done({ title: labels.current.get(id) ?? '' }),
    )
  }, [])

  /** 红线 8：卡片连同被点的按钮一起卸载，焦点掉回 <body>，读屏用户零回执 */
  const watchers = (
    <>
      {watched.map((id) => (
        <PendingWatcher key={id} id={id} onSettled={onSettled} />
      ))}
      <LiveRegion>{announce}</LiveRegion>
    </>
  )

  if (items.length === 0) {
    return (
      <>
        {watchers}
        <div className="py-20 text-center">
          <p className="font-heading text-lg">{m.dash_empty_reports()}</p>
        </div>
      </>
    )
  }

  return (
    <>
      {watchers}
      {/* relative：popLayout 的 PopChild 用 offsetTop/offsetLeft 定位退场元素 */}
      <div className="relative mt-6 grid gap-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((r) => {
            const t = targetOf(r)
            return (
              <RemovableRow key={r.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          URGENT.includes(r.reason)
                            ? 'destructive'
                            : 'secondary'
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
                        <Badge variant="outline">
                          {m.dash_target_deleted()}
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatAbsolute(r.createdAt)}
                      </span>
                    </div>
                    <CardTitle className="mt-2 text-base">
                      {t.href ? (
                        <Link
                          to={t.href}
                          viewTransition
                          className="hover:underline"
                        >
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
              </RemovableRow>
            )
          })}
        </AnimatePresence>
      </div>
      {pages > 1 && (
        <Pagination className="mt-6">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                to={pageHref(page - 1)}
                disabled={page === 1}
              />
            </PaginationItem>
            {pageWindow(page, pages).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink to={pageHref(p)} isActive={p === page}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                to={pageHref(page + 1)}
                disabled={page === pages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </>
  )
}
