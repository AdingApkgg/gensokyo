import { data, Link } from 'react-router'
import { Alert, AlertDescription } from '~/components/ui/alert'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '~/components/ui/pagination'
import { apiFor } from '~/lib/api'
import { boardLabel, displayTitle } from '~/lib/display'
import { formatAbsolute, formatRelative } from '~/lib/time'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/profile'

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.user.name ?? m.profile_not_found()
  return [{ title: `${name} · ${m.site_name()}` }]
}

/**
 * 个人主页。可见性闸门在 api（/shrine/users/:handle 用 visibleTopicWhere），
 * 这里只渲染——被下架资源的讨论、被删的楼层在数据里就不存在。
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1
  const res = await apiFor(request).api.shrine.users[':handle'].$get({
    param: { handle: params.handle },
    query: { page: String(page), pageSize: '30' },
  })
  const body = await res.json()
  if ('error' in body) {
    throw data(null, { status: res.status >= 500 ? 500 : 404 })
  }
  return body
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const { user, posts, page, pageSize, total } = loaderData
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const pathname = localizeHref(`/u/${user.handle}`)

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header>
        <h1 className="font-heading text-2xl font-bold">{user.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          @{user.handle} ·{' '}
          {m.profile_joined({ date: formatAbsolute(user.createdAt) })}
        </p>
      </header>

      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold">
          {m.profile_posts()}
        </h2>
        {posts.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {m.profile_no_posts()}
          </p>
        ) : (
          <ol className="divide-y border-y">
            {posts.map((p) => {
              const href = p.topic.resource
                ? `${localizeHref(`/kourindou/${p.topic.resource.slug}`)}?floor=${p.floor}#p${p.floor}`
                : `${localizeHref(`/shrine/t/${p.topic.id}`)}?floor=${p.floor}#p${p.floor}`
              const title = p.topic.resource
                ? displayTitle(p.topic.resource)
                : (p.topic.title ?? '')
              return (
                <li key={p.id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-muted-foreground">
                      {m.profile_in()}
                    </span>
                    <Link to={href} className="font-medium hover:underline">
                      {title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      #{p.floor}
                    </span>
                    {p.topic.boardSlug && (
                      <span className="text-xs text-muted-foreground">
                        {boardLabel(p.topic.boardSlug)}
                      </span>
                    )}
                    <time
                      dateTime={p.createdAt}
                      title={formatAbsolute(p.createdAt)}
                      suppressHydrationWarning
                      className="ml-auto text-xs text-muted-foreground"
                    >
                      {formatRelative(p.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">
                    {p.excerpt}
                  </p>
                </li>
              )
            })}
          </ol>
        )}
        {pages > 1 && (
          <Pagination className="mt-4">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  to={`${pathname}?page=${page - 1}`}
                  disabled={page <= 1}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-2 text-sm text-muted-foreground">
                  {page} / {pages}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  to={`${pathname}?page=${page + 1}`}
                  disabled={page >= pages}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </section>
    </main>
  )
}

export function ErrorBoundary() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <Alert className="max-w-md">
        <AlertDescription className="text-center text-base text-foreground">
          {m.profile_not_found()}
        </AlertDescription>
      </Alert>
    </main>
  )
}
