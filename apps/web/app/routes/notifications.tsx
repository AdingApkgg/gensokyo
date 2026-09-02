import type { NotificationView } from '@gensokyo/shared'
import { Link, redirect, useFetcher } from 'react-router'
import { Button } from '~/components/ui/button'
import { apiFor } from '~/lib/api'
import { displayTitle, reportReasonLabel } from '~/lib/display'
import { formatAbsolute, formatRelative } from '~/lib/time'
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
  return { ok: res.ok }
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
  const { items, failed } = loaderData
  const fetcher = useFetcher<typeof action>()
  const unread = items.filter((n) => !n.read)
  const newest = items[0]

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="flex items-center gap-4">
        <h1 className="font-heading text-2xl font-bold">{m.notif_title()}</h1>
        {unread.length > 0 && newest && (
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
        <ol className="mt-6 divide-y border-y">
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
                  <time
                    dateTime={n.createdAt}
                    title={formatAbsolute(n.createdAt)}
                    suppressHydrationWarning
                    className="ml-auto text-xs text-muted-foreground"
                  >
                    {formatRelative(n.createdAt)}
                  </time>
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
    </main>
  )
}
