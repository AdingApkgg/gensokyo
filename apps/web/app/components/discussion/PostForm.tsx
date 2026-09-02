import { useEffect, useId, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { errorMessage } from '~/lib/api-error'
import { m } from '~/paraglide/messages'
import { getLocale } from '~/paraglide/runtime'
import { Markdown } from './Markdown'

type Props = {
  action: string
  intent: 'comment' | 'edit'
  /** 讨论区所属主题；资源页的 action 靠它知道往哪个主题发 */
  topicId?: string
  /** intent=comment 时要回复的楼层 */
  parentId?: string | null
  onClearParent?: () => void
  /** intent=edit */
  postId?: string
  initial?: string
  /** 草稿存 localStorage 的键；不给就不存（编辑不存草稿） */
  draftKey?: string
  onDone?: () => void
  onCancel?: () => void
  compact?: boolean
}

type Result = { ok: boolean; code?: string; draft?: string }

/**
 * 发帖 / 编辑框。textarea + Markdown 工具栏 + 预览 + 草稿 + 传图。
 *
 * **预览用的是与正文相同的 `<Markdown>`**：预览到的就是存的、就是别人看到的。
 * 这是选 Markdown 而不是富文本编辑器的直接收益——三者是同一份代码。
 *
 * 草稿只在浏览器里读写（useEffect + try/catch），跨天存活；帖子配图的
 * GC 宽限期 7 天正是为它留的。发送成功后清掉。
 */
export function PostForm({
  action,
  intent,
  topicId,
  parentId,
  onClearParent,
  postId,
  initial = '',
  draftKey,
  onDone,
  onCancel,
  compact,
}: Props) {
  const fetcher = useFetcher<Result>()
  const [body, setBody] = useState(initial)
  const [preview, setPreview] = useState(false)
  const [restored, setRestored] = useState(false)
  const [uploading, setUploading] = useState<'idle' | 'busy' | 'failed'>('idle')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileId = useId()
  const busy = fetcher.state !== 'idle'
  /**
   * 「只处理一次」的守卫。fetcher.data 在提交成功后会**一直**留着
   * `{ok:true}`，而 onClearParent 若是父组件里的内联箭头，每次
   * 渲染都是新引用——不加守卫，成功效应会在此后每一次渲染时重跑，把用户正在
   * 打的字清掉：第一次回复之后这个框就再也打不进字。浏览器实测抓出来的。
   */
  const handledResult = useRef<Result | undefined>(undefined)

  // 草稿恢复：只在客户端、只一次
  useEffect(() => {
    if (!draftKey) return
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved && !initial) {
        setBody(saved)
        setRestored(true)
      }
    } catch {}
  }, [draftKey, initial])

  // 草稿保存
  useEffect(() => {
    if (!draftKey) return
    try {
      if (body.trim()) localStorage.setItem(draftKey, body)
      else localStorage.removeItem(draftKey)
    } catch {}
  }, [draftKey, body])

  // 点了「引用」：把光标交给输入框
  useEffect(() => {
    if (parentId) ref.current?.focus()
  }, [parentId])

  // 成功：清草稿、通知父组件。**每个结果只处理一次**
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data?.ok) return
    if (fetcher.data === handledResult.current) return
    handledResult.current = fetcher.data
    setBody('')
    setPreview(false)
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey)
      } catch {}
    }
    onClearParent?.()
    onDone?.()
  }, [fetcher.state, fetcher.data, draftKey, onClearParent, onDone])

  function wrap(before: string, after = before, placeholder = '') {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const selected = body.slice(s, e) || placeholder
    setBody(body.slice(0, s) + before + selected + after + body.slice(e))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(
        s + before.length,
        s + before.length + selected.length,
      )
    })
  }

  async function upload(file: File) {
    setUploading('busy')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('purpose', 'post')
    try {
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error('upload failed')
      const { url } = (await res.json()) as { url: string }
      // 预览态下 textarea 没挂载，wrap() 会提前 return 把 URL 丢掉——直接追加到正文
      if (ref.current)
        wrap(
          '',
          `
![](${url})
`,
        )
      else
        setBody(
          (b) => `${b}
![](${url})
`,
        )
      setUploading('idle')
    } catch {
      setUploading('failed')
    }
  }

  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.code : undefined

  return (
    <fetcher.Form method="post" action={action} className="grid gap-2">
      <input type="hidden" name="intent" value={intent} />
      {/* 正文语言 = 当前站点语言：给 <div lang> 用，修日文帖被按中文字形渲染 */}
      <input type="hidden" name="locale" value={getLocale()} />
      {topicId && <input type="hidden" name="topicId" value={topicId} />}
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      {postId && <input type="hidden" name="postId" value={postId} />}

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => wrap('**', '**', m.shrine_tb_bold())}
        >
          B
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => wrap('`', '`', 'code')}
        >
          {'</>'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => wrap('> ', '', m.shrine_tb_quote())}
        >
          ❝
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => wrap('[', '](https://)', m.shrine_tb_link())}
        >
          🔗
        </Button>
        <label htmlFor={fileId} className="cursor-pointer">
          <span className="inline-flex h-6 items-center rounded-[min(var(--radius-md),10px)] px-2 text-xs hover:bg-muted">
            {uploading === 'busy'
              ? m.shrine_uploading()
              : m.shrine_insert_image()}
          </span>
          <input
            id={fileId}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
        </label>
        {uploading === 'failed' && (
          <span className="text-xs text-destructive">
            {m.shrine_upload_failed()}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant={preview ? 'ghost' : 'secondary'}
            size="xs"
            onClick={() => setPreview(false)}
          >
            {m.shrine_write()}
          </Button>
          <Button
            type="button"
            variant={preview ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setPreview(true)}
          >
            {m.shrine_preview()}
          </Button>
        </div>
      </div>

      {parentId && onClearParent && (
        <p className="text-xs text-muted-foreground">
          {m.shrine_replying_to()}{' '}
          <button type="button" className="underline" onClick={onClearParent}>
            {m.shrine_cancel()}
          </button>
        </p>
      )}

      {preview ? (
        <div className="min-h-24 rounded-lg border px-3 py-2">
          {body.trim() ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              {m.shrine_nothing_to_preview()}
            </p>
          )}
          <textarea name="bodyMd" value={body} readOnly hidden />
        </div>
      ) : (
        <Textarea
          ref={ref}
          name="bodyMd"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={compact ? 3 : 8}
          placeholder={m.shrine_body_placeholder()}
          required
          maxLength={20000}
          aria-invalid={error ? true : undefined}
        />
      )}

      {restored && (
        <p className="text-xs text-muted-foreground">
          {m.shrine_draft_restored()}
        </p>
      )}
      {intent === 'edit' && (
        <p className="text-xs text-muted-foreground">
          {m.shrine_edit_no_notify()}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {m.shrine_markdown_hint()}
        </span>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {m.shrine_cancel()}
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy || !body.trim()}>
            {intent === 'edit' ? m.shrine_save() : m.shrine_reply()}
          </Button>
        </div>
      </div>
    </fetcher.Form>
  )
}
