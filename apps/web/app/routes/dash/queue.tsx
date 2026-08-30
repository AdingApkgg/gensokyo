import { REJECT_REASON, type RejectReason } from '@gensokyo/shared'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { apiFor } from '~/lib/api'
import {
  displayTitle,
  kindLabel,
  licenseLabel,
  licenseVariant,
} from '~/lib/display'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/queue'

export function meta() {
  return [{ title: `${m.dash_queue()} · ${m.dash()}` }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const res = await apiFor(request).api.moderation.queue.$get({
    query: { pageSize: '50' },
  })
  const body = await res.json()
  if ('error' in body) return { items: [], total: 0 }
  return body
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const id = String(form.get('id'))
  const decision = form.get('decision') === 'approve' ? 'approve' : 'reject'
  const rejectReason = form.get('rejectReason')

  if (decision === 'reject' && !rejectReason) {
    return { ok: false as const }
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
  return { ok: res.ok }
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

function ReviewActions({ id }: { id: string }) {
  const fetcher = useFetcher<typeof action>()
  const [reason, setReason] = useState<RejectReason | ''>('')
  const [note, setNote] = useState('')
  const busy = fetcher.state !== 'idle'
  const missingReason = fetcher.data?.ok === false

  return (
    <div className="grid gap-3 border-t pt-3">
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

      {reason && STRIKING.includes(reason) && (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {m.dash_strike_warning()}
        </p>
      )}
      {missingReason && (
        <p className="text-xs text-destructive">{m.dash_reject_required()}</p>
      )}

      <div className="flex gap-2">
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
          disabled={busy}
          onClick={() =>
            fetcher.submit(
              { id, decision: 'reject', rejectReason: reason, note },
              { method: 'post' },
            )
          }
        >
          {m.dash_reject()}
        </Button>
      </div>
    </div>
  )
}

export default function ReviewQueue({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData

  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="font-heading text-lg">{m.dash_empty_queue()}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {m.dash_empty_queue_hint()}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-4">
      {items.map((r) => (
        <Card key={r.id}>
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
                className="hover:underline"
              >
                {displayTitle(r)}
              </Link>
            </CardTitle>
            {r.licenseNote && (
              <p className="text-sm text-muted-foreground">{r.licenseNote}</p>
            )}
          </CardHeader>
          <CardContent>
            <ReviewActions id={r.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
