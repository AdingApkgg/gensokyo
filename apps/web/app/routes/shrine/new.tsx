import { BOARD_SLUGS, isBoardSlug } from '@gensokyo/shared'
import { useEffect, useState } from 'react'
import { Form, redirect, useNavigation } from 'react-router'
import { Markdown } from '~/components/discussion/Markdown'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import { apiFor } from '~/lib/api'
import { apiErrorCode, errorMessage } from '~/lib/api-error'
import { boardLabel } from '~/lib/display'
import { m } from '~/paraglide/messages'
import { getLocale, localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/new'

export function meta() {
  return [{ title: `${m.shrine_new_topic()} · ${m.nav_shrine()}` }]
}

/** 未登录 → /login?next=，登录后回到这里且保住 ?board= */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const res = await apiFor(request).api.me.$get()
  const body = await res.json()
  if (!('user' in body) || !body.user) {
    const next = `${localizeHref('/shrine/new')}${url.search}`
    throw redirect(`${localizeHref('/login')}?next=${encodeURIComponent(next)}`)
  }
  const board = url.searchParams.get('board')
  return { board: board && isBoardSlug(board) ? board : null }
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const boardSlug = String(form.get('boardSlug') ?? '')
  const title = String(form.get('title') ?? '').trim()
  const bodyMd = String(form.get('bodyMd') ?? '').trim()
  const localeRaw = String(form.get('locale') ?? '')
  const locale = (['zh', 'ja', 'en'] as const).find((l) => l === localeRaw)
  if (!isBoardSlug(boardSlug) || !title || !bodyMd) {
    return { ok: false as const, code: 'validation_failed', title, bodyMd }
  }
  const res = await apiFor(request).api.shrine.topics.$post({
    json: { boardSlug, title, bodyMd, ...(locale ? { locale } : {}) },
  })
  const code = await apiErrorCode(res)
  if (code) return { ok: false as const, code, title, bodyMd }
  const { id } = (await res.json()) as { id: string }
  throw redirect(localizeHref(`/shrine/t/${id}`))
}

const DRAFT_KEY = 'shrine:draft:new'

export default function NewTopic({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const nav = useNavigation()
  const [board, setBoard] = useState<string>(loaderData.board ?? '')
  const [title, setTitle] = useState(actionData?.title ?? '')
  const [body, setBody] = useState(actionData?.bodyMd ?? '')
  const [preview, setPreview] = useState(false)
  const [restored, setRestored] = useState(false)

  // 草稿恢复：只在客户端；action 回填过的不覆盖
  useEffect(() => {
    if (actionData) return
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (!saved) return
      const d = JSON.parse(saved) as {
        title?: string
        bodyMd?: string
        board?: string
      }
      if (d.title || d.bodyMd) {
        setTitle(d.title ?? '')
        setBody(d.bodyMd ?? '')
        if (!loaderData.board && d.board) setBoard(d.board)
        setRestored(true)
      }
    } catch {}
  }, [actionData, loaderData.board])

  // 依赖里带 actionData：提交时草稿已清，action 失败回来要把它存回去
  // biome-ignore lint/correctness/useExhaustiveDependencies: actionData 是刻意的重触发条件，不是遗漏
  useEffect(() => {
    try {
      if (title.trim() || body.trim()) {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ title, bodyMd: body, board }),
        )
      } else localStorage.removeItem(DRAFT_KEY)
    } catch {}
  }, [title, body, board, actionData])

  const submitting = nav.state === 'submitting'

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold">
        {m.shrine_new_topic()}
      </h1>
      <Form
        method="post"
        className="mt-6 grid gap-4"
        // 提交即清草稿：成功会 redirect、组件卸载，没有别的时机能清；失败由上面的 effect 存回
        onSubmit={() => {
          try {
            localStorage.removeItem(DRAFT_KEY)
          } catch {}
        }}
      >
        <input type="hidden" name="locale" value={getLocale()} />
        <div className="grid gap-2">
          <Label htmlFor="board">{m.shrine_board_label()}</Label>
          <Select
            value={board}
            onValueChange={setBoard}
            name="boardSlug"
            required
          >
            <SelectTrigger id="board" className="w-full sm:w-64">
              <SelectValue placeholder={m.shrine_board_label()} />
            </SelectTrigger>
            <SelectContent>
              {BOARD_SLUGS.map((b) => (
                <SelectItem key={b} value={b}>
                  {boardLabel(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="title">{m.shrine_title_placeholder()}</Label>
          <Input
            id="title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="body">{m.shrine_body_placeholder()}</Label>
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
          {preview ? (
            <div className="min-h-40 rounded-lg border px-3 py-2">
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
              id="body"
              name="bodyMd"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              required
              maxLength={20000}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {m.shrine_markdown_hint()}
          </p>
        </div>
        {restored && (
          <p className="text-xs text-muted-foreground">
            {m.shrine_draft_restored()}
          </p>
        )}
        {actionData && !actionData.ok && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(actionData.code)}
          </p>
        )}
        <Button
          type="submit"
          className="justify-self-end"
          disabled={submitting || !board || !title.trim() || !body.trim()}
        >
          {m.shrine_submit()}
        </Button>
      </Form>
    </main>
  )
}
