import type { UserRole } from '@gensokyo/shared'
import { useState } from 'react'
import { Form, redirect, useFetcher, useSearchParams } from 'react-router'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { apiFor } from '~/lib/api'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/users'

export function meta() {
  return [{ title: `${m.admin_users()} · ${m.dash()}` }]
}

/**
 * 提权页。布局的守卫放审核员进来，这里必须自己再挡一次——
 * 审核员看得到 /dash，但看不得这一页。真正的闸门仍在服务端。
 */
async function requireAdmin(request: Request) {
  const res = await apiFor(request).api.me.$get()
  const body = await res.json()
  const user = 'user' in body ? body.user : null
  if (user?.role !== 'admin') throw redirect(localizeHref('/dash'))
  return user
}

export async function loader({ request }: Route.LoaderArgs) {
  const me = await requireAdmin(request)
  const q = new URL(request.url).searchParams.get('q')?.trim()

  const res = await apiFor(request).api.admin.users.$get({
    query: q ? { q } : {},
  })
  const body = await res.json()
  return { items: 'error' in body ? [] : body.items, q: q ?? '', meId: me.id }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const reason = String(form.get('reason') ?? '').trim()
  if (!reason) return { ok: false as const, reason: 'missing_reason' as const }
  const api = apiFor(request)
  const id = String(form.get('id'))

  if (form.get('intent') === 'reset_strikes') {
    const res = await api.api.admin.users[':id'].strikes.reset.$post({
      param: { id },
      json: { reason },
    })
    return res.ok
      ? { ok: true as const, reason: null, intent: 'reset_strikes' as const }
      : {
          ok: false as const,
          reason: 'api_failed' as const,
          intent: 'reset_strikes' as const,
        }
  }

  const res = await api.api.admin.users[':id'].role.$patch({
    param: { id },
    json: {
      role: form.get('role') === 'moderator' ? 'moderator' : 'user',
      reason,
    },
  })
  return res.ok
    ? { ok: true as const, reason: null, intent: 'role' as const }
    : {
        ok: false as const,
        reason: 'api_failed' as const,
        intent: 'role' as const,
      }
}

const roleLabel = (r: UserRole) =>
  ({
    user: m.admin_role_user(),
    moderator: m.admin_role_moderator(),
    admin: m.admin_role_admin(),
  })[r]

const roleVariant = (r: UserRole) =>
  r === 'admin' ? 'default' : r === 'moderator' ? 'secondary' : 'outline'

function RoleActions({ id, role }: { id: string; role: UserRole }) {
  const fetcher = useFetcher<typeof action>()
  const [reason, setReason] = useState('')
  const busy = fetcher.state !== 'idle'
  const missing = fetcher.data?.reason === 'missing_reason'

  const next: UserRole = role === 'moderator' ? 'user' : 'moderator'

  return (
    <div className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto]">
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={m.admin_reason()}
        aria-label={m.admin_reason()}
      />
      <Button
        size="sm"
        variant={next === 'user' ? 'outline' : 'default'}
        disabled={busy}
        onClick={() =>
          fetcher.submit({ id, role: next, reason }, { method: 'post' })
        }
      >
        {next === 'moderator' ? m.admin_promote() : m.admin_demote()}
      </Button>
      {missing && (
        <p className="text-xs text-destructive sm:col-span-2">
          {m.admin_reason_required()}
        </p>
      )}
      {fetcher.data?.reason === 'api_failed' && (
        <p className="text-xs text-destructive sm:col-span-2">
          {m.admin_config_failed()}
        </p>
      )}
    </div>
  )
}

/**
 * 清零违规。只在 strikeCount > 0 时渲染——它是 strikeCount 唯一的递减路径，
 * 没有它，一次误判就是永久的（strike 在门槛判断之前短路，调门槛救不回来）。
 */
function StrikeActions({ id, strikes }: { id: string; strikes: number }) {
  const fetcher = useFetcher<typeof action>()
  const [reason, setReason] = useState('')
  const busy = fetcher.state !== 'idle'
  const missing = fetcher.data?.reason === 'missing_reason'
  const done = fetcher.data?.ok && fetcher.data.intent === 'reset_strikes'

  if (strikes === 0 || done) {
    return done ? (
      <p className="border-t pt-3 text-xs text-muted-foreground">
        {m.admin_strikes_reset_done()}
      </p>
    ) : null
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        {m.admin_reset_strikes_hint()}
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={m.admin_reason()}
          aria-label={m.admin_reason()}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            fetcher.submit(
              { intent: 'reset_strikes', id, reason },
              { method: 'post' },
            )
          }
        >
          {m.admin_reset_strikes()}
        </Button>
      </div>
      {missing && (
        <p className="text-xs text-destructive">{m.admin_reason_required()}</p>
      )}
      {fetcher.data?.reason === 'api_failed' && (
        <p className="text-xs text-destructive">{m.admin_config_failed()}</p>
      )}
    </div>
  )
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { items, q, meId } = loaderData
  const [params] = useSearchParams()

  return (
    <div className="mt-6 grid gap-4">
      <Form method="get" className="flex gap-2">
        <Input
          name="q"
          defaultValue={params.get('q') ?? q}
          placeholder={m.admin_search_user()}
          aria-label={m.admin_search_user()}
        />
        <Button type="submit" variant="secondary">
          {m.admin_search()}
        </Button>
      </Form>

      {!q && (
        <p className="text-xs text-muted-foreground">
          {m.admin_staff_only_hint()}
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          {m.admin_no_result()}
        </p>
      ) : (
        items.map((u) => (
          <Card key={u.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={roleVariant(u.role)}>{roleLabel(u.role)}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {m.admin_trust_summary({
                    approved: u.approvedResourceCount,
                    strikes: u.strikeCount,
                  })}
                </span>
              </div>
              <CardTitle className="mt-2 leading-snug">{u.name}</CardTitle>
              <p className="font-mono text-xs break-all text-muted-foreground">
                {u.email}
              </p>
            </CardHeader>
            <CardContent>
              {u.id === meId ? (
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  {m.admin_self_hint()}
                </p>
              ) : u.role === 'admin' ? (
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  {m.admin_admin_immutable()}
                </p>
              ) : (
                <RoleActions id={u.id} role={u.role} />
              )}
              <StrikeActions id={u.id} strikes={u.strikeCount} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
