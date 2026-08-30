import { useState } from 'react'
import { redirect, useFetcher } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { apiFor } from '~/lib/api'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/site'

export function meta() {
  return [{ title: `${m.admin_site()} · ${m.dash()}` }]
}

async function requireAdmin(request: Request) {
  const res = await apiFor(request).api.me.$get()
  const body = await res.json()
  const user = 'user' in body ? body.user : null
  if (user?.role !== 'admin') throw redirect(localizeHref('/dash'))
}

type Config = {
  registrationOpen?: boolean
  autoPublishThreshold?: number
  takedownEmail?: string
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const res = await apiFor(request).api.admin.config.$get()
  const body = await res.json()
  return { config: ('error' in body ? {} : body.config) as Config }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const form = await request.formData()

  /**
   * 只提交这次真的改了的键。全量提交会把没碰过的字段一起写库并留一条
   * 「修改了全部」的审计——审计日志得能看出到底动了什么。
   */
  const threshold = form.get('autoPublishThreshold')
  const email = String(form.get('takedownEmail') ?? '').trim()
  const json = {
    ...(form.has('registrationOpen')
      ? { registrationOpen: form.get('registrationOpen') === 'true' }
      : {}),
    ...(threshold !== null && String(threshold) !== ''
      ? { autoPublishThreshold: Number(threshold) }
      : {}),
    ...(email ? { takedownEmail: email } : {}),
  }
  if (Object.keys(json).length === 0) return { ok: false as const }

  const res = await apiFor(request).api.admin.config.$patch({ json })
  return { ok: res.ok }
}

function Row({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export default function AdminSite({ loaderData }: Route.ComponentProps) {
  const { config } = loaderData
  const fetcher = useFetcher<typeof action>()
  const busy = fetcher.state !== 'idle'

  const [open, setOpen] = useState(config.registrationOpen ?? true)
  const [threshold, setThreshold] = useState(
    String(config.autoPublishThreshold ?? ''),
  )
  const [email, setEmail] = useState(config.takedownEmail ?? '')

  const save = (patch: Record<string, string>) =>
    fetcher.submit(patch, { method: 'post' })

  return (
    <div className="mt-6 grid gap-4">
      <Row
        title={m.admin_registration_open()}
        hint={m.admin_registration_hint()}
      >
        <div className="flex items-center gap-3">
          <Switch
            id="registrationOpen"
            checked={open}
            disabled={busy}
            onCheckedChange={(v) => {
              setOpen(v)
              save({ registrationOpen: String(v) })
            }}
          />
          <Label htmlFor="registrationOpen">
            {open ? m.admin_registration_open() : m.admin_registration_closed()}
          </Label>
        </div>
      </Row>

      <Row
        title={m.admin_auto_publish_threshold()}
        hint={m.admin_auto_publish_hint()}
      >
        <div className="flex gap-2">
          <Input
            type="number"
            min={0}
            max={1000}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            aria-label={m.admin_auto_publish_threshold()}
          />
          <Button
            variant="secondary"
            disabled={busy || threshold === ''}
            onClick={() => save({ autoPublishThreshold: threshold })}
          >
            {m.admin_save()}
          </Button>
        </div>
      </Row>

      <Row title={m.admin_takedown_email()} hint={m.admin_takedown_hint()}>
        <div className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dmca@example.com"
            aria-label={m.admin_takedown_email()}
          />
          <Button
            variant="secondary"
            disabled={busy || !email.trim()}
            onClick={() => save({ takedownEmail: email })}
          >
            {m.admin_save()}
          </Button>
        </div>
      </Row>

      {fetcher.data && (
        <p
          className={`text-sm ${fetcher.data.ok ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          {fetcher.data.ok ? m.admin_config_saved() : m.admin_config_failed()}
        </p>
      )}
    </div>
  )
}
