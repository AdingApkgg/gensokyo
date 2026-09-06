import type { PostView } from '@gensokyo/shared'
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '~/components/ui/pagination'
import { replyTarget } from '~/lib/discussion-nav'
import { pageWindow } from '~/lib/paging'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import { PostForm } from './PostForm'
import { type DiscussionUser, PostList } from './PostList'

export type DiscussionPage = {
  posts: PostView[]
  from: number
  pageSize: number
  total: number
}

type Props = {
  topicId: string
  page: DiscussionPage
  user: DiscussionUser
  /** 路由自己的 action 路径 */
  action: string
  /** 当前页面的 pathname（分页链接要保住它） */
  pathname: string
  openingIsTopic: boolean
  /** 未登录时的登录链接要带 next */
  loginNext: string
}

/**
 * 讨论区五件套：楼层列表 + 楼层分页 + 回复框 + 引用 + 各种对话框。
 *
 * 只收 `action` 路径字符串，不知道自己挂在资源页还是主题页——两个页面共用
 * 同一份 PostView 类型与同一个 discussionAction()，这是「同一份数据、同一组路由」
 * 在前端的另一半。
 *
 * 分页按**楼层区间**不按 page：`?floor=137#p137` 的深链要稳定，page 会随
 * 「前面有几层被删」漂移。服务端把 from 吸附到页边界并回显。
 */
export function Discussion({
  topicId,
  page,
  user,
  action,
  pathname,
  openingIsTopic,
  loginNext,
}: Props) {
  const [parent, setParent] = useState<PostView | null>(null)
  // 传给 PostForm 的回调必须稳定：它进了那边 effect 的依赖
  const clearParent = useCallback(() => setParent(null), [])

  const navigate = useNavigate()

  /**
   * 发帖成功后把用户带到他刚发的那一楼。
   *
   * 不做这件事的话，主题超过 50 层（POSTS_PAGE_SIZE）之后新楼根本不在当前
   * 楼层窗口里——revalidate 回来的列表看不到它，观感等同于发失败。
   */
  const onPosted = useCallback(
    (floor: number) => {
      const target = replyTarget(floor, page.from, page.pageSize)
      if (target.kind === 'navigate') {
        navigate(`${pathname}?floor=${target.from}#p${floor}`)
        return
      }
      // 已在本页：等 revalidate 把新楼渲染出来再滚过去
      requestAnimationFrame(() => {
        document.getElementById(`p${floor}`)?.scrollIntoView({
          block: 'center',
          behavior: prefersReduced() ? 'auto' : 'smooth',
        })
      })
    },
    [navigate, pathname, page.from, page.pageSize],
  )

  /**
   * 引用只设 parentId，**不往正文里塞任何文本**。引用块由服务端按 parentId
   * 现查（摘要不快照，一次软删就能让它从所有引用处消失）；往正文里注入
   * `> #2 …` 会和那个引用块显示两遍。
   */
  const onQuote = useCallback((p: PostView) => {
    setParent(p)
    document
      .getElementById('reply-form')
      ?.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth' })
  }, [])

  const pages = Math.max(1, Math.ceil(page.total / page.pageSize))
  const current = Math.floor((page.from - 1) / page.pageSize) + 1
  const hrefFor = (p: number) => {
    /**
     * 带 hash：ScrollRestoration 先处理 hash 再看 preventScrollReset，
     * 没有它翻页后视口停在原地，新一页的第一楼在上方 50 层之外。
     *
     * hash 指向列表容器 `#floors` 而不是首楼 `#p{from}`：后者会让 `:target`
     * 的落点墨洇在**每一次翻页**给当页第一楼闪一下，而那一楼什么也没发生。
     * 墨洇只该服务「有人特意指向这一楼」——引用锚点与楼层自链接。
     */
    const from = (p - 1) * page.pageSize + 1
    return `${pathname}?floor=${from}#floors`
  }

  return (
    <div className="grid gap-6">
      {page.posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {m.detail_no_comments()}
        </p>
      ) : (
        <PostList
          posts={page.posts}
          user={user}
          action={action}
          openingIsTopic={openingIsTopic}
          onQuote={onQuote}
        />
      )}

      {pages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                to={hrefFor(Math.max(1, current - 1))}
                disabled={current === 1}
              />
            </PaginationItem>
            {pageWindow(current, pages).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink to={hrefFor(p)} isActive={p === current}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                to={hrefFor(Math.min(pages, current + 1))}
                disabled={current === pages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <div id="reply-form" className="scroll-mt-20">
        {user ? (
          <PostForm
            action={action}
            intent="comment"
            topicId={topicId}
            parentId={parent?.id ?? null}
            onClearParent={clearParent}
            onPosted={onPosted}
            draftKey={`shrine:draft:topic:${topicId}`}
            compact
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            <Link
              to={`${localizeHref('/login')}?next=${encodeURIComponent(loginNext)}`}
              viewTransition
              className="underline underline-offset-4"
            >
              {m.shrine_login_to_post()}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}

/** MotionConfig 管不到原生滚动 API，reduced-motion 要自己判 */
function prefersReduced() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
