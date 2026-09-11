import { LICENSE_STATUS, RESOURCE_KIND, RESOURCE_SORT } from '@gensokyo/shared'
import { Download, Star } from 'lucide-react'
import { Link, useSearchParams, useViewTransitionState } from 'react-router'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '~/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { apiFor } from '~/lib/api'
import {
  averageRating,
  displayTitle,
  kindLabel,
  licenseLabel,
  licenseVariant,
} from '~/lib/display'
import { pageWindow } from '~/lib/paging'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/list'

export function meta() {
  return [{ title: `${m.kourindou_title()} · ${m.site_name()}` }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const query = Object.fromEntries(
    ['kind', 'license', 'sort', 'page']
      .map((k) => [k, url.searchParams.get(k)])
      .filter(([, v]) => v) as [string, string][],
  )

  const res = await apiFor(request).api.kourindou.resources.$get({ query })
  if (res.status !== 200) {
    return { items: [], total: 0, failed: true as const }
  }
  const body = await res.json()
  return { ...body, failed: false as const }
}

type ResourceItem = Awaited<ReturnType<typeof loader>>['items'][number]

/** 筛选器走 URL query：可分享、可后退、SSR 直出 */
function Filter({
  param,
  label,
  options,
}: {
  param: string
  label: string
  options: { value: string; label: string }[]
}) {
  const [params, setParams] = useSearchParams()
  const current = params.get(param) ?? '__all'

  return (
    <Select
      value={current}
      onValueChange={(v) => {
        const next = new URLSearchParams(params)
        if (v === '__all') next.delete(param)
        else next.set(param, v)
        next.delete('page')
        setParams(next, { preventScrollReset: true, viewTransition: true })
      }}
    >
      <SelectTrigger className="w-auto min-w-32" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{`${label}：${m.filter_all()}`}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ResourceRow({ r }: { r: ResourceItem }) {
  const avg = averageRating(r.ratingSum, r.ratingCount)
  const to = localizeHref(`/kourindou/${r.slug}`)
  const title = displayTitle(r)
  /**
   * 只给正在转场的那一行命名。同名元素在同一帧出现两个，整次 view transition
   * 会被浏览器静默放弃——所以绝不能给所有行都挂上。
   *
   * useViewTransitionState 对 currentLocation 与 nextLocation 都匹配，
   * 所以后退（详情 → 列表）会自动配对回同一行，不需要额外写。
   */
  const morphing = useViewTransitionState(to)
  return (
    <li>
      <Link
        to={to}
        viewTransition
        className="ink-row flex items-center gap-4 py-3 pl-3 transition-colors hover:bg-muted/50"
      >
        {r.coverUrl ? (
          <img
            src={r.coverUrl}
            alt=""
            loading="lazy"
            className="size-14 shrink-0 rounded object-cover"
            style={{
              viewTransitionName: morphing ? 'kourindou-cover' : undefined,
            }}
          />
        ) : (
          <div
            className="size-14 shrink-0 rounded bg-muted"
            style={{
              viewTransitionName: morphing ? 'kourindou-cover' : undefined,
            }}
          />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" lang={title.lang}>
            {title.text}
          </p>
          <p className="truncate text-muted-foreground">
            {r.circleNameRaw || m.anonymous()}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
          <Badge variant={licenseVariant(r.license)}>
            {licenseLabel(r.license)}
          </Badge>
        </div>

        <div className="hidden w-32 shrink-0 text-right text-muted-foreground sm:block">
          <span className="inline-flex items-center gap-1">
            <Star
              className={`size-3.5 ${avg ? 'fill-chart-2 text-chart-2' : ''}`}
            />
            {avg ?? m.no_rating()}
          </span>
          <span className="ml-3 inline-flex items-center gap-1">
            <Download className="size-3.5" />
            {r.downloadCount}
          </span>
        </div>
      </Link>
    </li>
  )
}

export default function KourindouList({ loaderData }: Route.ComponentProps) {
  const { items, total, failed } = loaderData
  // failed 分支下 loader 只返回 items/total/failed，这两个字段不存在
  const pageSize = 'pageSize' in loaderData ? loaderData.pageSize : 20
  const current = 'page' in loaderData ? loaderData.page : 1
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const [params] = useSearchParams()
  /** 翻页要保住 kind/license/sort：丢了筛选的翻页比没有翻页更让人困惑 */
  const pageHref = (p: number) => {
    const next = new URLSearchParams(params)
    if (p <= 1) next.delete('page')
    else next.set('page', String(p))
    const qs = next.toString()
    return qs ? `?${qs}` : '.'
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold">
            {m.kourindou_title()}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {m.kourindou_tagline()}
          </p>
        </div>
        {/*
          投稿的唯一站内入口。此前 /kourindou/upload 没有任何链接指向它，
          只能手输 URL。匿名也显示：投稿页的 loader 会带 ?next= 跳登录，
          登录后直接回来，比「先找登录再找投稿」少一步。
        */}
        <Button asChild>
          <Link to={localizeHref('/kourindou/upload')} viewTransition>
            {m.kourindou_upload_cta()}
          </Link>
        </Button>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Filter
          param="kind"
          label={m.filter_kind()}
          options={RESOURCE_KIND.map((k) => ({
            value: k,
            label: kindLabel(k),
          }))}
        />
        <Filter
          param="license"
          label={m.filter_license()}
          options={LICENSE_STATUS.map((l) => ({
            value: l,
            label: licenseLabel(l),
          }))}
        />
        <Filter
          param="sort"
          label={m.filter_sort()}
          options={RESOURCE_SORT.map((s) => ({
            value: s,
            label: {
              relevance: m.sort_relevance(),
              newest: m.sort_newest(),
              downloads: m.sort_downloads(),
              rating: m.sort_rating(),
            }[s],
          }))}
        />
        {!failed && (
          <span className="ml-auto text-sm text-muted-foreground">
            {m.list_count({ total })}
          </span>
        )}
      </div>

      {failed ? (
        <p className="mt-16 text-center text-destructive">{m.load_error()}</p>
      ) : items.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="font-heading text-lg">{m.list_empty()}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {m.list_empty_hint()}
          </p>
        </div>
      ) : (
        <ul className="mt-4 ink-divide border-y" data-density="compact">
          {items.map((r) => (
            <ResourceRow key={r.id} r={r} />
          ))}
        </ul>
      )}

      {!failed && pages > 1 && (
        <Pagination className="mt-8">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                to={pageHref(current - 1)}
                disabled={current === 1}
              />
            </PaginationItem>
            {pageWindow(current, pages).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink to={pageHref(p)} isActive={p === current}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                to={pageHref(current + 1)}
                disabled={current === pages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </main>
  )
}
