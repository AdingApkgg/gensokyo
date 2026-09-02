import { Pin } from 'lucide-react'
import { Link } from 'react-router'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '~/components/ui/pagination'
import type { apiFor } from '~/lib/api'
import { boardLabel, displayTitle } from '~/lib/display'
import { formatAbsolute, formatRelative } from '~/lib/time'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

/**
 * 从 hc 推导，不手写：api 改投影时这里跟着变；`as` 断言会把漂移静默吞掉。
 * 成功体是联合类型里不带 error 的那一支。
 */
type TopicsGet = ReturnType<typeof apiFor>['api']['shrine']['topics']['$get']
// 不引 hono/client（web 不直接依赖 hono）：从 $get → Response → json() 一路推
type TopicsBody = Awaited<ReturnType<Awaited<ReturnType<TopicsGet>>['json']>>
export type TopicListData = Exclude<TopicsBody, { error: unknown }>

/** 最新流与版块页共用的一行。资源主题带封面与「来自香霖堂」徽章，视觉权重与版块主题区分 */
export function TopicList({
  list,
  failed,
  pathname,
}: {
  list: TopicListData | null
  failed: boolean
  pathname: string
}) {
  // 失败态与空态是两个分支：api 挂了不能长得像「还没有人发帖」
  if (failed || !list) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{m.shrine_load_failed()}</AlertDescription>
      </Alert>
    )
  }
  if (list.items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {m.shrine_no_topics()}
      </p>
    )
  }
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize))

  return (
    <>
      <ol className="divide-y border-y">
        {list.items.map((t) => (
          <li key={t.id} className="flex gap-3 py-3">
            {t.resource?.coverUrl ? (
              <img
                src={t.resource.coverUrl}
                alt=""
                className="size-12 shrink-0 rounded object-cover"
                loading="lazy"
              />
            ) : (
              <div className="size-12 shrink-0 rounded bg-muted" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {t.pinned && (
                  <Pin
                    className="size-3.5 text-primary"
                    aria-label={m.shrine_pinned()}
                  />
                )}
                <Link
                  to={
                    t.resource
                      ? `${localizeHref(`/kourindou/${t.resource.slug}`)}#discussion`
                      : localizeHref(`/shrine/t/${t.id}`)
                  }
                  className="font-medium hover:underline"
                >
                  {t.resource ? displayTitle(t.resource) : t.title}
                </Link>
                {t.resource ? (
                  <Badge variant="secondary">{m.shrine_from_kourindou()}</Badge>
                ) : t.boardSlug ? (
                  <Badge variant="outline">{boardLabel(t.boardSlug)}</Badge>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                {t.author && <span>{t.author.name}</span>}
                <span>{m.shrine_replies_n({ n: t.replyCount })}</span>
                <time
                  dateTime={t.lastPostAt}
                  title={formatAbsolute(t.lastPostAt)}
                  suppressHydrationWarning
                >
                  {formatRelative(t.lastPostAt)}
                </time>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {pages > 1 && (
        <Pagination className="mt-4">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                to={`${pathname}?page=${list.page - 1}`}
                disabled={list.page <= 1}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-sm text-muted-foreground">
                {list.page} / {pages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                to={`${pathname}?page=${list.page + 1}`}
                disabled={list.page >= pages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </>
  )
}
