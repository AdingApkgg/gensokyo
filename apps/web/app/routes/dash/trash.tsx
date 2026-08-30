import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { redirect, useFetcher } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { apiFor } from '~/lib/api'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/trash'

export function meta() {
  return [{ title: `${m.admin_trash()} · ${m.dash()}` }]
}

async function requireAdmin(request: Request) {
  const res = await apiFor(request).api.me.$get()
  const body = await res.json()
  const user = 'user' in body ? body.user : null
  if (user?.role !== 'admin') throw redirect(localizeHref('/dash'))
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const res = await apiFor(request).api.admin.resources.deleted.$get()
  const body = await res.json()
  return { items: 'error' in body ? [] : body.items }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const id = String(form.get('id'))
  const api = apiFor(request)

  if (form.get('intent') === 'restore') {
    const res = await api.api.admin.resources[':id'].restore.$post({
      param: { id },
    })
    return { ok: res.ok, reason: null }
  }

  const reason = String(form.get('reason') ?? '').trim()
  if (!reason) return { ok: false as const, reason: 'missing_reason' as const }

  const res = await api.api.admin.resources[':id'].$delete({
    param: { id },
    json: { mode: 'purge', reason },
  })
  return { ok: res.ok, reason: null }
}

function TrashActions({ id }: { id: string }) {
  const fetcher = useFetcher<typeof action>()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const busy = fetcher.state !== 'idle'
  const missing = fetcher.data?.reason === 'missing_reason'

  if (!confirming) {
    return (
      <div className="flex gap-2 border-t pt-3">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            fetcher.submit({ id, intent: 'restore' }, { method: 'post' })
          }
        >
          {m.admin_restore()}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          {m.admin_purge()}
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <p className="flex items-start gap-2 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        {m.admin_purge_warning()}
      </p>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={m.admin_reason()}
        aria-label={m.admin_reason()}
      />
      {missing && (
        <p className="text-xs text-destructive">{m.admin_reason_required()}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() =>
            fetcher.submit({ id, intent: 'purge', reason }, { method: 'post' })
          }
        >
          {m.admin_purge()}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          {m.admin_cancel()}
        </Button>
      </div>
    </div>
  )
}

export default function AdminTrash({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData

  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="font-heading text-lg">{m.admin_trash_empty()}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {m.admin_trash_hint()}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-4">
      <p className="text-xs text-muted-foreground">{m.admin_trash_hint()}</p>
      {items.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle className="leading-snug">{r.titleOriginal}</CardTitle>
            <p className="font-mono text-xs break-all text-muted-foreground">
              {r.slug}
            </p>
            {r.deletedAt && (
              <p className="text-xs text-muted-foreground">
                {m.admin_deleted_at()}: {new Date(r.deletedAt).toLocaleString()}
              </p>
            )}
          </CardHeader>
          <CardContent>
            <TrashActions id={r.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
