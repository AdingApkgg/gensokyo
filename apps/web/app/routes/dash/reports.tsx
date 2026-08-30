import type { ReportReason } from '@gensokyo/shared'
import { useFetcher } from 'react-router'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { apiFor } from '~/lib/api'
import { m } from '~/paraglide/messages'
import type { Route } from './+types/reports'

export function meta() {
  return [{ title: `${m.dash_reports()} · ${m.dash()}` }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const res = await apiFor(request).api.moderation.reports.$get({
    query: { pageSize: '50' },
  })
  const body = await res.json()
  if ('error' in body) return { items: [] }
  return body
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const res = await apiFor(request).api.moderation.reports[':id'].resolve.$post(
    {
      param: { id: String(form.get('id')) },
      json: {
        status: form.get('status') === 'rejected' ? 'rejected' : 'resolved',
      },
    },
  )
  return { ok: res.ok }
}

const reasonLabel = (r: ReportReason) =>
  ({
    copyright: m.report_reason_copyright(),
    illegal: m.report_reason_illegal(),
    broken_link: m.report_reason_broken_link(),
    wrong_info: m.report_reason_wrong_info(),
    other: m.report_reason_other(),
  })[r]

/** 版权与违法类举报排在最前——它们是下架通道的入口 */
const URGENT: ReportReason[] = ['copyright', 'illegal']

function Actions({ id }: { id: string }) {
  const fetcher = useFetcher<typeof action>()
  const busy = fetcher.state !== 'idle'
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          fetcher.submit({ id, status: 'resolved' }, { method: 'post' })
        }
      >
        {m.dash_report_resolve()}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          fetcher.submit({ id, status: 'rejected' }, { method: 'post' })
        }
      >
        {m.dash_report_dismiss()}
      </Button>
    </div>
  )
}

export default function Reports({ loaderData }: Route.ComponentProps) {
  const items = [...loaderData.items].sort((a, b) => {
    const ua = URGENT.includes(a.reason) ? 0 : 1
    const ub = URGENT.includes(b.reason) ? 0 : 1
    return ua - ub
  })

  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="font-heading text-lg">{m.dash_empty_reports()}</p>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-4">
      {items.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  URGENT.includes(r.reason) ? 'destructive' : 'secondary'
                }
              >
                {reasonLabel(r.reason)}
              </Badge>
              <Badge variant="outline">{r.targetKind}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString()}
              </span>
            </div>
            <CardTitle className="mt-2 font-mono text-sm break-all">
              {r.targetId}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {r.detail && (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {r.detail}
              </p>
            )}
            <Actions id={r.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
