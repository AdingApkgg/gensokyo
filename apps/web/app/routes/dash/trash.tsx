import { AlertTriangle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { redirect, useFetcher } from 'react-router'
import { AlertLine } from '~/components/alert-line'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { apiFor } from '~/lib/api'
import { confirmStagger } from '~/lib/motion'
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

  /**
   * 全站唯一一处 `staggerChildren`，也是唯一一处**刻意让操作变慢**的地方。
   * 销毁是全 /dash 唯一不可逆的操作，三段递延把完成时间从 0ms 抬到约 420ms
   * （0.12 × 2 个间隔 + 最后一个 0.18 的时长），让手在按下之前多一次看清的机会。
   * 正当性不来自曝光量。
   *
   * **必须自己门控减弱动效**：`MotionConfig reducedMotion="user"` 只关
   * transform/positional 键，opacity 动画连同 stagger 算出来的 delay 照跑。
   * 不门控的话，开了减弱动效的人看到的仍是三段递延淡入——而此时它是页面上
   * 唯一在动的东西，还落在唯一不可逆的操作上，比不做还糟。
   */
  const { container: confirmVariants, item: itemVariants } = confirmStagger(
    !!useReducedMotion(),
  )

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
    // relative：AlertLine 的 popLayout 用 offsetParent 定位退场元素（红线 9）
    <motion.div
      variants={confirmVariants}
      initial="hidden"
      animate="show"
      className="relative grid gap-2 border-t pt-3"
    >
      <motion.p
        variants={itemVariants}
        role="alert"
        className="flex items-start gap-2 text-xs text-destructive"
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        {m.admin_purge_warning()}
      </motion.p>
      <motion.div variants={itemVariants}>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={m.admin_reason()}
          aria-label={m.admin_reason()}
        />
      </motion.div>
      {/*
        这一行不参与 stagger：它定义了自己的 initial/animate 对象，
        不继承父级的 variants 标签。它是提交失败之后才出现的，
        与「点开确认」那三拍不是同一件事。
      */}
      <AlertLine show={missing} className="text-xs text-destructive">
        {m.admin_reason_required()}
      </AlertLine>
      <motion.div variants={itemVariants} className="flex gap-2">
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
      </motion.div>
    </motion.div>
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
