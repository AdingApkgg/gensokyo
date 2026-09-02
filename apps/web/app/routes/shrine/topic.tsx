import { entityIdSchema } from '@gensokyo/shared'
import { data, Link, redirect } from 'react-router'
import { Discussion } from '~/components/discussion/Discussion'
import { ReportDialog } from '~/components/discussion/ReportDialog'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb'
import { apiFor } from '~/lib/api'
import { discussionAction, floorParam } from '~/lib/discussion-action'
import { boardLabel } from '~/lib/display'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/topic'

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.topic.title ?? m.shrine_topic_not_found()} · ${m.nav_shrine()}`,
    },
  ]
}

/**
 * `/shrine/t/:id`。资源主题 → **301 到 /kourindou/:slug#discussion**，规范 URL 唯一。
 * 楼层进 `?floor=137#p137`；`?page=` 在这个页面不存在。
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  // 非 uuid 的 :id 是坏链不是故障：直接 404，别让 api 的 400 变成这里的 500
  if (!entityIdSchema.safeParse(params.id).success) {
    throw data(null, { status: 404 })
  }
  const api = apiFor(request)
  const head = await api.api.shrine.topics[':id'].$get({
    param: { id: params.id },
  })
  const first = await head.json()
  if ('error' in first) {
    throw data(null, { status: head.status >= 500 ? 500 : 404 })
  }
  if (first.topic.kind === 'resource' && first.topic.resourceSlug) {
    throw redirect(
      `${localizeHref(`/kourindou/${first.topic.resourceSlug}`)}#discussion`,
      301,
    )
  }
  // 主楼 id 从第一页拿：翻到第二页时 posts[0] 是 #51，举报对象不能跟着漂
  const openingPostId = first.posts[0]?.id ?? null

  const floor = floorParam(request.url)
  if (floor.from && Number(floor.from) > first.pageSize) {
    const res = await api.api.shrine.topics[':id'].posts.$get({
      param: { id: params.id },
      query: floor,
    })
    const more = await res.json()
    if (!('error' in more)) return { ...first, ...more, openingPostId }
  }
  return { ...first, openingPostId }
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData()
  return (
    (await discussionAction(request, form, params.id)) ?? {
      ok: false as const,
      intent: '',
      code: 'validation_failed',
    }
  )
}

export default function Topic({ loaderData, matches }: Route.ComponentProps) {
  const { topic } = loaderData
  const user = matches[0]?.loaderData?.user ?? null
  const board = topic.boardSlug
  const pathname = localizeHref(`/shrine/t/${topic.id}`)

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={localizeHref('/shrine')}>{m.nav_shrine()}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {board && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={localizeHref(`/shrine/b/${board}`)}>
                    {boardLabel(board)}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </>
          )}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="line-clamp-1">
              {topic.title}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <header className="mt-3 flex items-start gap-3">
        <h1 className="font-heading text-2xl font-bold">{topic.title}</h1>
      </header>
      <section className="mt-6">
        <Discussion
          topicId={topic.id}
          page={loaderData}
          user={user ? { id: user.id, role: user.role } : null}
          action={pathname}
          pathname={pathname}
          openingIsTopic
          loginNext={pathname}
        />
      </section>
      {user && topic.authorId !== user.id && loaderData.openingPostId && (
        <div className="mt-4">
          <ReportDialog
            action={pathname}
            targetKind="post"
            targetId={loaderData.openingPostId}
            variant="outline"
          />
        </div>
      )}
    </main>
  )
}

/** 本地化的 404/500：根 ErrorBoundary 是英文的，中文站上不该出现 */
export function ErrorBoundary() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold">
          {m.shrine_topic_not_found()}
        </h1>
        <Link
          to={localizeHref('/shrine')}
          className="mt-4 inline-block text-sm underline underline-offset-4"
        >
          {m.nav_shrine()}
        </Link>
      </div>
    </main>
  )
}
