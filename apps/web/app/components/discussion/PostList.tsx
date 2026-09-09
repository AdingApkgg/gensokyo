import type { PostView } from '@gensokyo/shared'
import { lazy, Suspense, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router'
import { RelativeTime } from '~/components/relative-time'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import { DeletePostDialog } from './DeletePostDialog'
import { Markdown } from './Markdown'
import { PostForm } from './PostForm'
import { ReportDialog } from './ReportDialog'

/** 含 motion，只在被编辑的那一楼挂载；hover「编辑」时预取，让第一次翻纸也有动画 */
const FloorFlip = lazy(() => import('./FloorFlip'))
const preloadFlip = () => void import('./FloorFlip')

export type DiscussionUser = {
  id: string
  role: 'user' | 'moderator' | 'admin'
} | null

type Props = {
  posts: PostView[]
  user: DiscussionUser
  /** 路由自己的 action 路径；组件不知道自己挂在哪个页面 */
  action: string
  /** 版块主题的 1 楼是主题正文，用「楼主」标识 */
  openingIsTopic: boolean
  onQuote: (p: PostView) => void
}

const isStaff = (u: DiscussionUser) =>
  u?.role === 'moderator' || u?.role === 'admin'

export function PostList({
  posts,
  user,
  action,
  openingIsTopic,
  onQuote,
}: Props) {
  return (
    <ol id="floors" className="ink-divide scroll-mt-20 border-y">
      {posts.map((p) => (
        <PostItem
          key={p.id}
          post={p}
          user={user}
          action={action}
          isOpening={openingIsTopic && p.floor === 1}
          onQuote={onQuote}
        />
      ))}
    </ol>
  )
}

function PostItem({
  post: p,
  user,
  action,
  isOpening,
  onQuote,
}: {
  post: PostView
  user: DiscussionUser
  action: string
  isOpening: boolean
  onQuote: (p: PostView) => void
}) {
  const [editing, setEditing] = useState(false)
  /**
   * 翻纸的挂载门控：AnimatePresence 必须**先**带着「正文」那一面挂上，
   * 再切到「编辑」，正文才有退场可播。flushSync 把第一步单独提交——
   * 两个 setState 批在同一次提交里的话，AnimatePresence 挂上时初始子节点
   * 已经是编辑框，initial={false} 让它什么也不播。
   * 编辑结束同理：先标记 flipping 再收起 editing，让编辑框有退场；退场播完
   * （onSettled）才卸掉 FloorFlip，这一楼回到纯 <li>。
   */
  const [flipping, setFlipping] = useState(false)
  const startEdit = () => {
    flushSync(() => setFlipping(true))
    setEditing(true)
  }
  const stopEdit = () => {
    setFlipping(true)
    setEditing(false)
  }
  const own = user !== null && p.author?.id === user.id
  // 「已编辑」必须带 !deleted：软删走 UPDATE，会 bump updatedAt
  const edited = !p.deleted && p.updatedAt > p.createdAt

  return (
    <li id={`p${p.floor}`} className="scroll-mt-20 py-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {p.author ? (
          <Link
            to={localizeHref(`/u/${p.author.handle}`)}
            viewTransition
            className="font-medium hover:underline"
          >
            {p.author.name}
          </Link>
        ) : (
          <span className="font-medium text-muted-foreground">
            {m.anonymous()}
          </span>
        )}
        {isOpening && (
          <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">
            {m.shrine_opening()}
          </span>
        )}
        <a
          href={`#p${p.floor}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          #{p.floor}
        </a>
        <RelativeTime
          iso={p.createdAt}
          className="text-xs text-muted-foreground"
        />
        {edited && (
          <span className="text-xs text-muted-foreground">
            {m.shrine_edited()}
          </span>
        )}
      </div>

      {p.quoted && (
        <blockquote className="mt-2 border-l-2 pl-3 text-sm text-muted-foreground">
          <a href={`#p${p.quoted.floor}`} className="hover:underline">
            #{p.quoted.floor}
          </a>{' '}
          {p.quoted.author?.name ?? m.anonymous()}：
          {p.quoted.deleted ? (
            <span className="italic">{m.shrine_quoted_deleted()}</span>
          ) : (
            <span className="whitespace-pre-wrap">{p.quoted.excerpt}</span>
          )}
        </blockquote>
      )}

      {p.deleted ? (
        <p className="mt-2 text-sm text-muted-foreground italic">
          {m.shrine_deleted_post()}
        </p>
      ) : editing || flipping ? (
        <Suspense
          fallback={
            <div className="mt-2">
              <Markdown lang={p.locale}>{p.bodyMd}</Markdown>
            </div>
          }
        >
          <FloorFlip
            editing={editing}
            onSettled={() => setFlipping(false)}
            view={<Markdown lang={p.locale}>{p.bodyMd}</Markdown>}
            edit={
              <PostForm
                action={action}
                intent="edit"
                postId={p.id}
                initial={p.bodyMd}
                onDone={stopEdit}
                onCancel={stopEdit}
              />
            }
          />
        </Suspense>
      ) : (
        <div className="mt-2">
          <Markdown lang={p.locale}>{p.bodyMd}</Markdown>
        </div>
      )}

      {!p.deleted && !editing && user && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="xs" onClick={() => onQuote(p)}>
            {m.shrine_quote()}
          </Button>
          {own && (
            <Button
              variant="ghost"
              size="xs"
              onPointerEnter={preloadFlip}
              onFocus={preloadFlip}
              onClick={startEdit}
            >
              {m.shrine_edit()}
            </Button>
          )}
          {(own || isStaff(user)) && (
            <DeletePostDialog action={action} postId={p.id} own={own} />
          )}
          {!own && (
            <ReportDialog action={action} targetKind="post" targetId={p.id} />
          )}
        </div>
      )}
    </li>
  )
}
