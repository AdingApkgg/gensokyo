import { REPORT_REASON } from '@gensokyo/shared'
import { useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import { errorMessage } from '~/lib/api-error'
import { reportReasonLabel } from '~/lib/display'
import { m } from '~/paraglide/messages'

/**
 * 举报。资源与楼层共用——api 侧 /api/reports 本来就是两个模块共用的。
 * `detail_report` 这个 message key 从 M3 起就定义了但全仓无引用：
 * API 齐全、UI 从来没做，而**版权举报是生死线那一条**。
 */
export function ReportDialog({
  action,
  targetKind,
  targetId,
  variant = 'ghost',
}: {
  action: string
  targetKind: 'resource' | 'post'
  targetId: string
  variant?: 'ghost' | 'outline'
}) {
  const fetcher = useFetcher<{ ok: boolean; code?: string }>()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('')
  const [detail, setDetail] = useState('')
  const busy = fetcher.state !== 'idle'
  const done = fetcher.state === 'idle' && fetcher.data?.ok

  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setOpen(false), 1200)
    return () => clearTimeout(t)
  }, [done])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="xs">
          {m.detail_report()}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.shrine_report_title()}</DialogTitle>
          <DialogDescription>{m.shrine_report_desc()}</DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="text-sm">{m.shrine_reported()}</p>
        ) : (
          <div className="grid gap-3">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label={m.shrine_report_reason()}>
                <SelectValue placeholder={m.shrine_report_reason()} />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASON.map((r) => (
                  <SelectItem key={r} value={r}>
                    {reportReasonLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={m.shrine_report_detail()}
            />
            {fetcher.data && !fetcher.data.ok && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(fetcher.data.code)}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {!done && (
            <Button
              disabled={busy || !reason}
              onClick={() =>
                fetcher.submit(
                  { intent: 'report', targetKind, targetId, reason, detail },
                  { method: 'post', action },
                )
              }
            >
              {m.shrine_report_submit()}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
