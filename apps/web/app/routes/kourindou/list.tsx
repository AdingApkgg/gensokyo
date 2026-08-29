import { LICENSE_STATUS, RESOURCE_KIND, RESOURCE_SORT } from '@gensokyo/shared'
import { Download, Star } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Badge } from '~/components/ui/badge'
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
        setParams(next, { preventScrollReset: true })
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

export default function KourindouList({ loaderData }: Route.ComponentProps) {
  const { items, total, failed } = loaderData

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header>
        <h1 className="font-heading text-3xl font-bold">
          {m.kourindou_title()}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.kourindou_tagline()}
        </p>
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
        <ul className="mt-4 divide-y border-y" data-density="compact">
          {items.map((r) => {
            const avg = averageRating(r.ratingSum, r.ratingCount)
            return (
              <li key={r.id}>
                <Link
                  to={localizeHref(`/kourindou/${r.slug}`)}
                  className="flex items-center gap-4 py-3 transition-colors hover:bg-muted/50"
                >
                  {r.coverUrl ? (
                    <img
                      src={r.coverUrl}
                      alt=""
                      loading="lazy"
                      className="size-14 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="size-14 shrink-0 rounded bg-muted" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{displayTitle(r)}</p>
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
          })}
        </ul>
      )}
    </main>
  )
}
