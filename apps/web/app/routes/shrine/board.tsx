import { isBoardSlug } from '@gensokyo/shared'
import { data, Link } from 'react-router'
import { BoardNav } from '~/components/board-nav'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb'
import { Button } from '~/components/ui/button'
import { apiFor } from '~/lib/api'
import { boardDescription, boardLabel } from '~/lib/display'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/board'
import { TopicList } from './topic-list'

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData
    ? boardLabel(loaderData.board)
    : m.shrine_board_not_found()
  return [{ title: `${name} · ${m.nav_shrine()}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const board = params.board
  // 先用闭合的常量挡一道；不认识的 slug 是 404，不是去打一次 api
  if (!isBoardSlug(board)) throw data(null, { status: 404 })
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1
  try {
    const res = await apiFor(request).api.shrine.topics.$get({
      query: { board, page: String(page), pageSize: '30' },
    })
    const body = await res.json()
    if ('error' in body) return { board, list: null, failed: true }
    return { board, list: body, failed: false }
  } catch {
    return { board, list: null, failed: true }
  }
}

export default function Board({ loaderData }: Route.ComponentProps) {
  const { board, list, failed } = loaderData
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={localizeHref('/shrine')}>{m.nav_shrine()}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{boardLabel(board)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <header className="mt-3 flex items-start gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            {boardLabel(board)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {boardDescription(board)}
          </p>
        </div>
        <Button size="sm" className="ml-auto shrink-0" asChild>
          <Link to={`${localizeHref('/shrine/new')}?board=${board}`}>
            {m.shrine_new_topic()}
          </Link>
        </Button>
      </header>
      <section className="mt-6">
        <TopicList
          list={list}
          failed={failed}
          pathname={localizeHref(`/shrine/b/${board}`)}
        />
      </section>
      <section className="mt-10">
        <h2 className="mb-3 font-heading text-lg font-semibold">
          {m.shrine_boards()}
        </h2>
        <BoardNav current={board} />
      </section>
    </main>
  )
}

export function ErrorBoundary() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold">
          {m.shrine_board_not_found()}
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
