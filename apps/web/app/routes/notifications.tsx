import type { NotificationView } from '@gensokyo/shared'
import { Link, redirect, useFetcher, useSearchParams } from 'react-router'
import { LiveRegion } from '~/components/live-region'
import { RelativeTime } from '~/components/relative-time'
import { Button } from '~/components/ui/button'
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
import { displayTitle, reportReasonLabel } from '~/lib/display'
import { pageWindow } from '~/lib/paging'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/notifications'

export function meta() {
  return [{ title: `${m.notif_title()} · ${m.site_name()}` }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const page = Number(url.searchParams.get('page') ?? '1') || 1
  const api = apiFor(request)
  const res = await api.api.notifications.$get({
    query: { page: String(page), pageSize: '50' },
  })
  if (res.status === 401) {
    const next = localizeHref('/notifications')
    throw redirect(`${localizeHref('/login')}?next=${encodeURIComponent(next)}`)
  }
  const body = await res.json()
  if ('error' in body)
    return {
      items: [] as NotificationView[],
      page,
      pageSize: 50,
      total: 0,
      failed: true,
    }
  return { ...body, failed: false }
}

/** ids 或 upTo 二选一；「全部已读」走 upTo = 列表里最新一条的 id */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const api = apiFor(request)
  const upTo = String(form.get('upTo') ?? '')
  const id = String(form.get('id') ?? '')
  const res = await api.api.notifications.read.$post({
    json: upTo ? { upTo } : { ids: [id] },
  })
  // API 已经算好了 marked，此前被丢掉——于是连一句「已标记 N 条」都印不出来
  //
  // 失败也要带原因：这条路径能发 401（会话过期）与 404（upTo 游标指向的通知
  // 已经不在了），而 `{ ok: false }` 会把两者一起吞掉——点了没反应、角标不变、
  // 一个字都没有。/dash 的审核队列犯过一模一样的错。
  const code = await apiErrorCode(res)
  if (code) return { ok: false as const, code }
  const { marked } = (await res.json()) as { marked: number }
  return { ok: true as const, marked }
}

const rejectLabel = (r: unknown) =>
  ({
    copyright: m.reject_copyright(),
    illegal: m.reject_illegal(),
    low_quality: m.reject_low_quality(),
    duplicate: m.reject_duplicate(),
    other: m.reject_other(),
  })[String(r) as 'copyright'] ?? null

/** 每种 kind 一句话 + 一个链接；subject 不可见时只剩那句话 */
function describe(n: NotificationView): {
  text: string
  href: string | null
  sub: string | null
} {
  const who = n.actor?.name ?? m.notif_someone()
  const floor = n.floor ? `?floor=${n.floor}#p${n.floor}` : ''
  let href: string | null = null
  let sub: string | null = null
  if (n.subject?.kind === 'topic') {
    href = n.topicId
      ? `${localizeHref(`/shrine/t/${n.topicId}`)}${floor}`
      : null
    sub = n.subject.title
  } else if (n.subject?.kind === 'resource') {
    href = `${localizeHref(`/kourindou/${n.subject.resource.slug}`)}${n.topicId ? `${floor || '#discussion'}` : ''}`
    sub = displayTitle(n.subject.resource)
  } else if (n.subject?.kind === 'removed') {
    sub = m.notif_removed()
  }

  switch (n.kind) {
    case 'reply':
      return { text: m.notif_reply({ name: who }), href, sub }
    case 'mention':
      return { text: m.notif_mention({ name: who }), href, sub }
    case 'review_approved':
      return { text: m.notif_review_approved(), href, sub }
    case 'review_rejected': {
      const r = rejectLabel(n.payload?.rejectReason)
      return {
        text: m.notif_review_rejected(),
        href,
        sub:
          [sub, r ? m.notif_reason({ reason: r }) : null]
            .filter(Boolean)
            .join(' · ') || null,
      }
    }
    case 'resource_delisted':
      return { text: m.notif_resource_delisted(), href, sub }
    case 'resource_deleted':
      return {
        text: m.notif_resource_deleted({
          title: String(n.payload?.title ?? ''),
        }),
        href: null,
        sub: null,
      }
    case 'post_deleted': {
      const reason = n.payload?.reason
      const label =
        typeof reason === 'string' ? reportReasonLabel(reason as 'spam') : null
      return {
        text: m.notif_post_deleted(),
        href,
        sub:
          [sub, label ? m.notif_reason({ reason: label }) : null]
            .filter(Boolean)
            .join(' · ') || null,
      }
    }
  }
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { items, failed, page, pageSize, total } = loaderData
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
  const fetcher = useFetcher<typeof action>()
  const settled = fetcher.state === 'idle' ? fetcher.data : undefined
  const marked = settled?.ok ? settled.marked : null
  const failCode = settled?.ok === false ? settled.code : undefined
  const unread = items.filter((n) => !n.read)
  const newest = items[0]

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <LiveRegion>
        {marked !== null ? m.notif_marked_n({ n: marked }) : null}
      </LiveRegion>
      {/* 失败要看得见也听得见。`role="alert"` 自带播报，所以它不进 LiveRegion——
          同一句话播两遍比不播更糟。 */}
      {failCode && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {errorMessage(failCode)}
        </p>
      )}
      <header className="flex items-center gap-4">
        <h1 className="font-heading text-2xl font-bold">{m.notif_title()}</h1>
        {/*
         * 按钮限死在第 1 页：API 对 upTo 的语义是「标记该游标**及更旧**的
         * 全部未读」，而只有第 1 页的 items[0]（newest）才是全局最新一条——
         * 第 2 页的 items[0] 只是「第 2 页里最新」，比第 1 页的任何一条都旧。
         * 分页控件成为常规入口之前 ?page=2 只能手打 URL、没人走到；
         * 一旦能点到，在第 2 页点「全部已读」会静默漏掉第 1 页的未读，
         * 而 LiveRegion 还会照常播报一句看起来成功的「已标记 N 条」。
         * 要让它在任意页可用，得先给 api 的 markReadSchema 加「全部」语义。
         */}
        {page === 1 && unread.length > 0 && newest && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={fetcher.state !== 'idle'}
            onClick={() =>
              fetcher.submit({ upTo: newest.id }, { method: 'post' })
            }
          >
            {m.notif_mark_all()}
          </Button>
        )}
      </header>

      {failed ? (
        <p className="mt-8 text-sm text-destructive">
          {m.shrine_load_failed()}
        </p>
      ) : items.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-heading text-lg">{m.notif_empty()}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {m.notif_empty_hint()}
          </p>
        </div>
      ) : (
        <ol className="mt-6 ink-divide border-y">
          {items.map((n) => {
            const d = describe(n)
            const inner = (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {!n.read && (
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-primary"
                    />
                  )}
                  <span
                    className={n.read ? 'text-muted-foreground' : 'font-medium'}
                  >
                    {d.text}
                  </span>
                  <RelativeTime
                    iso={n.createdAt}
                    className="ml-auto text-xs text-muted-foreground"
                  />
                </div>
                {d.sub && (
                  <p className="mt-1 text-sm text-muted-foreground">{d.sub}</p>
                )}
              </>
            )
            return (
              <li key={n.id} className="py-3">
                {d.href ? (
                  <Link
                    to={d.href}
                    viewTransition
                    className="block"
                    // 点进去就算读过：不等用户回来手动点
                    onClick={() => {
                      if (!n.read)
                        fetcher.submit({ id: n.id }, { method: 'post' })
                    }}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div>{inner}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {!failed && pages > 1 && (
        <Pagination className="mt-8">
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
    </main>
  )
}
