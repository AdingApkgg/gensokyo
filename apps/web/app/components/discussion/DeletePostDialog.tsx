import { REPORT_REASON } from '@gensokyo/shared'
import { useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { errorMessage } from '~/lib/api-error'
import { reportReasonLabel } from '~/lib/display'
import { m } from '~/paraglide/messages'

/**
 * 删楼确认。作者删自己的不需要理由；staff 删他人的必须选一个——
 * 理由同时是审计类别、申诉依据、以及记不记违规的判据。
 * 用 AlertDialog 不用 Dialog：这是破坏性动作。
 */
export function DeletePostDialog({
  action,
  postId,
  own,
}: {
  action: string
  postId: string
  own: boolean
}) {
  const fetcher = useFetcher<{ ok: boolean; code?: string }>()
  const [reason, setReason] = useState<string>('')
  const [open, setOpen] = useState(false)
  const busy = fetcher.state !== 'idle'
  const failed = fetcher.state === 'idle' && fetcher.data && !fetcher.data.ok

  // 成功才关；失败留在对话框里把原因说出来——静默关掉看起来和「删成功了」一样
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.ok) setOpen(false)
  }, [fetcher.state, fetcher.data])

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-destructive">
          {m.shrine_delete()}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.shrine_delete_confirm_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.shrine_delete_confirm_desc()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {own ? (
          <p className="text-sm text-muted-foreground">
            {m.shrine_delete_own_hint()}
          </p>
        ) : (
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger aria-label={m.shrine_delete_reason()}>
              <SelectValue placeholder={m.shrine_delete_reason()} />
            </SelectTrigger>
            <SelectContent>
              {REPORT_REASON.map((r) => (
                <SelectItem key={r} value={r}>
                  {reportReasonLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(fetcher.data?.code)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{m.shrine_cancel()}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || (!own && !reason)}
            onClick={(e) => {
              // 阻止 Radix 的自动关闭：关不关由结果决定
              e.preventDefault()
              fetcher.submit(
                { intent: 'delete', postId, ...(reason ? { reason } : {}) },
                { method: 'post', action },
              )
            }}
          >
            {m.shrine_delete()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
