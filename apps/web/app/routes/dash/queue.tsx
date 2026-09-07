import { REJECT_REASON, type RejectReason } from '@gensokyo/shared'
import { AlertTriangle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useFetchers, useSearchParams } from 'react-router'
import { AlertLine } from '~/components/alert-line'
import { LiveRegion } from '~/components/live-region'
import { RemovableRow } from '~/components/removable-row'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
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
import { apiErrorCode, errorMessage } from '~/lib/api-error'
import {
  mergeWatched,
  pendingIdsFrom,
  withoutPending,
} from '~/lib/dash-pending'
import {
  displayTitle,
  kindLabel,
  licenseLabel,
  licenseVariant,
} from '~/lib/display'
import { pageWindow } from '~/lib/paging'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/queue'

export function meta() {
  return [{ title: `${m.dash_queue()} · ${m.dash()}` }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1
  const res = await apiFor(request).api.moderation.queue.$get({
    query: { page: String(page), pageSize: '50' },
  })
  const body = await res.json()
  // 失败分支也要给全形状：少了 page/pageSize，loaderData 会是联合类型，
  // 组件里读 loaderData.page 直接是 TS 错误
  if ('error' in body) return { items: [], page: 1, pageSize: 50, total: 0 }
  return body
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const id = String(form.get('id'))
  const decision = form.get('decision') === 'approve' ? 'approve' : 'reject'
  const rejectReason = form.get('rejectReason')

  // 客户端本该拦住（驳回按钮 `disabled={busy || !reason}`），这里是兜底。
  //
  // 这个 code **不能**叫 `validation_failed`：API 自己也会发这个码（note 超过
  // 1000 字就是），撞名之后连「通过」时备注写长了都会显示成「请填写驳回理由」。
  if (decision === 'reject' && !rejectReason) {
    return { ok: false as const, code: 'reject_reason_required' as const }
  }

  const res = await apiFor(request).api.moderation.resources[
    ':id'
  ].review.$post({
    param: { id },
    json: {
      decision,
      ...(decision === 'reject'
        ? { rejectReason: rejectReason as RejectReason }
        : {}),
      note: String(form.get('note') ?? '') || undefined,
    },
  })
  const code = await apiErrorCode(res)
  return code ? { ok: false as const, code } : { ok: true as const }
}

const reasonLabel = (r: RejectReason) =>
  ({
    copyright: m.reject_copyright(),
    illegal: m.reject_illegal(),
    low_quality: m.reject_low_quality(),
    duplicate: m.reject_duplicate(),
    other: m.reject_other(),
  })[r]

/** 版权与违法会记违规并清零信任，UI 上要提前说清 */
const STRIKING: RejectReason[] = ['copyright', 'illegal']

/**
 * `reject_reason_required` 是本路由 action 自造的码，不在 errorMessage 的表里。
 * 卡片内联提示与列表层播报必须用同一份判断，否则同一次失败会有两种说法。
 */
const failLabel = (code: string) =>
  code === 'reject_reason_required'
    ? m.dash_reject_required()
    : errorMessage(code)

/**
 * 替一张**已经飞出去**的卡片守着它的 fetcher，结算时把结果交回列表层。
 *
 * 为什么不能写在卡片里：卡片正是因为 `fetcher.state !== 'idle'` 才被移出
 * `visible` 的，它在 submitting 那一帧就卸载了；而 `data` 要到 `idle` 才有——
 * 两个时刻不重叠，写在卡片里的 effect 永远不会触发。
 *
 * 它挂在 `AnimatePresence` **之外**，不参与退场也不进 layout 测量。
 * 它持有同一个 key，所以那个 fetcher 始终有活着的订阅者，
 * RR 不会把它排进 queueFetcherForDeletion，`data` 也就不会被清掉——
 * 卡片飞回来时还能读到真实错误码。
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

/** 列表层靠这个前缀认出「哪一行在途」，两个 dash 页面不共用（action 返回形状不同） */
const FETCHER_PREFIX = 'review:'

function ReviewActions({ id }: { id: string }) {
  const fetcher = useFetcher<typeof action>({ key: `${FETCHER_PREFIX}${id}` })
  const [reason, setReason] = useState<RejectReason | ''>('')
  const [note, setNote] = useState('')
  const busy = fetcher.state !== 'idle'
  const failCode = fetcher.data?.ok === false ? fetcher.data.code : undefined

  return (
    // relative：AlertLine 的 popLayout 用 offsetParent 定位退场元素（红线 9）
    <div className="relative grid gap-3 border-t pt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={reason || undefined}
          onValueChange={(v) => setReason(v as RejectReason)}
        >
          <SelectTrigger aria-label={m.dash_reject_reason()}>
            <SelectValue placeholder={m.dash_reject_reason()} />
          </SelectTrigger>
          <SelectContent>
            {REJECT_REASON.map((r) => (
              <SelectItem key={r} value={r}>
                {reasonLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={m.dash_note()}
          aria-label={m.dash_note()}
        />
      </div>

      <AlertLine
        show={!!reason && STRIKING.includes(reason)}
        className="flex items-start gap-2 text-xs text-destructive"
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        {m.dash_strike_warning()}
      </AlertLine>
      <AlertLine show={!!failCode} className="text-xs text-destructive">
        {failCode ? failLabel(failCode) : null}
      </AlertLine>

      {/*
        本任务八处落点里**只有 queue 这两处在按钮之前**，所以只有这一行
        需要 layout 去吸收上方的高度变化；reports 与 users 的错误行都在
        按钮之后，那里加 layout 是纯空操作。
        position 不是 both：卡片挂着 backdrop-filter，both 会做 scale 校正。
      */}
      <motion.div layout="position" className="flex gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            fetcher.submit(
              { id, decision: 'approve', note },
              { method: 'post' },
            )
          }
        >
          {m.dash_approve()}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || !reason}
          onClick={() =>
            fetcher.submit(
              { id, decision: 'reject', rejectReason: reason, note },
              { method: 'post' },
            )
          }
        >
          {m.dash_reject()}
        </Button>
      </motion.div>
    </div>
  )
}

export default function ReviewQueue({ loaderData }: Route.ComponentProps) {
  const { items, total, page, pageSize } = loaderData
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const [params] = useSearchParams()

  /**
   * 乐观移除。在途的那一行**当帧**就从列表里去掉，动画与网络往返重叠。
   * 不乐观的话是 action 一趟 → revalidate → 卡片才消失，动画串在网络之后，
   * 每条 +280ms；乐观之后增量是 0ms。
   *
   * RR8 的 fetcher persistence 是前提：在途 fetcher 在组件卸载后仍留在
   * state.fetchers 里直到结算，所以这个集合不会闪断。
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

  /**
   * 标题快照。结算时 loaderData 多半已经 revalidate 掉那一行了，
   * 播报文案要的标题那时从 items 里取不到，只能提前存下来。
   */
  const titles = useRef(new Map<string, string>())
  for (const r of items) titles.current.set(r.id, displayTitle(r))

  const [announce, setAnnounce] = useState('')
  const onSettled = useCallback((id: string, code?: string) => {
    setAnnounce(
      code
        ? m.dash_announce_failed({ reason: failLabel(code) })
        : m.dash_announce_done({ title: titles.current.get(id) ?? '' }),
    )
  }, [])

  /**
   * 红线 8：popLayout 把卡片移除后焦点掉回 <body>，读屏用户点一次「通过」
   * 只会听到一片安静。审核员一次会话要处理几十条。
   */
  const watchers = (
    <>
      {watched.map((id) => (
        <PendingWatcher key={id} id={id} onSettled={onSettled} />
      ))}
      <LiveRegion>{announce}</LiveRegion>
    </>
  )
  /** 照抄 kourindou/list.tsx：第 1 页不写 ?page=1，翻页保住现有 query */
  const pageHref = (p: number) => {
    const next = new URLSearchParams(params)
    if (p <= 1) next.delete('page')
    else next.set('page', String(p))
    const qs = next.toString()
    return qs ? `?${qs}` : '.'
  }

  if (items.length === 0) {
    return (
      <>
        {watchers}
        <div className="py-20 text-center">
          <p className="font-heading text-lg">{m.dash_empty_queue()}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {m.dash_empty_queue_hint()}
          </p>
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
          {visible.map((r) => (
            <RemovableRow key={r.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                    <Badge variant={licenseVariant(r.license)}>
                      {licenseLabel(r.license)}
                    </Badge>
                    {/* 低信任的排在前面，这里把依据直接摆出来 */}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {m.dash_uploader()}: {r.uploaderName ?? '—'} ·{' '}
                      {r.approvedResourceCount
                        ? m.dash_trust_n({ n: r.approvedResourceCount })
                        : m.dash_trust_new()}
                      {r.strikeCount
                        ? ` · ${m.dash_strikes({ n: r.strikeCount })}`
                        : ''}
                    </span>
                  </div>
                  <CardTitle className="mt-2 leading-snug">
                    <Link
                      to={localizeHref(`/kourindou/${r.slug}`)}
                      viewTransition
                      className="hover:underline"
                    >
                      {displayTitle(r)}
                    </Link>
                  </CardTitle>
                  {r.licenseNote && (
                    <p className="text-sm text-muted-foreground">
                      {r.licenseNote}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  <ReviewActions id={r.id} />
                </CardContent>
              </Card>
            </RemovableRow>
          ))}
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
