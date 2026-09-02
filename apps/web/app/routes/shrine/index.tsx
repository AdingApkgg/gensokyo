import { Link } from 'react-router'
import { BoardNav } from '~/components/board-nav'
import { Button } from '~/components/ui/button'
import { apiFor } from '~/lib/api'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/index'
import { TopicList } from './topic-list'

export function meta() {
  return [{ title: `${m.nav_shrine()} · ${m.site_name()}` }]
}

/**
 * 全站最新流：版块主题与资源主题混排，置顶进排序键。
 * 零回复的资源主题**进流**——这是「资源站供血」的唯一实现。
 */
export async function loader({ request }: Route.LoaderArgs) {
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1
  try {
    const res = await apiFor(request).api.shrine.topics.$get({
      query: { page: String(page), pageSize: '30' },
    })
    const body = await res.json()
    if ('error' in body) return { list: null, failed: true }
    return { list: body, failed: false }
  } catch {
    return { list: null, failed: true }
  }
}

export default function ShrineIndex({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="flex items-center gap-4">
        <h1 className="font-heading text-2xl font-bold">{m.nav_shrine()}</h1>
        <Button size="sm" className="ml-auto" asChild>
          <Link to={localizeHref('/shrine/new')}>{m.shrine_new_topic()}</Link>
        </Button>
      </header>
      <section className="mt-6">
        <BoardNav />
      </section>
      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold">
          {m.shrine_latest()}
        </h2>
        <TopicList
          list={loaderData.list}
          failed={loaderData.failed}
          pathname={localizeHref('/shrine')}
        />
      </section>
    </main>
  )
}
