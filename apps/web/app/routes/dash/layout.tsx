import { NavLink, Outlet, redirect } from 'react-router'
import { apiFor } from '~/lib/api'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/layout'

/**
 * 角色守卫。api 那边每个审核端点都有 requireRole，这里只是别让不该看到的人
 * 白跑一趟——真正的闸门在服务端，不在这个 loader。
 */
/**
 * 待办计数是**查询不是事件**：staff 待办不发通知——收件人集合是「当前 staff」
 * 而通知是历史行，提权降权后旧未读指向错的人。每次进 dash 现数。
 */
export async function loader({ request }: Route.LoaderArgs) {
  const api = apiFor(request)
  const res = await api.api.me.$get()
  const body = await res.json()
  const user = 'user' in body ? body.user : null
  if (!user || (user.role !== 'moderator' && user.role !== 'admin')) {
    throw redirect(localizeHref('/'))
  }
  // 未登录/权限不够时 api 回错误信封，没有 total → 0
  const totalOf = async (r: { json(): Promise<unknown> }) => {
    const b = (await r.json()) as { total?: number }
    return typeof b.total === 'number' ? b.total : 0
  }
  const [queue, reports] = await Promise.all([
    api.api.moderation.queue.$get({ query: { pageSize: '1' } }).then(totalOf),
    api.api.moderation.reports.$get({ query: { pageSize: '1' } }).then(totalOf),
  ])
  return { user, counts: { queue, reports } }
}

type Tab = {
  to: string
  label: () => string
  end: boolean
  admin: boolean
  count?: 'queue' | 'reports'
}

const tabs: Tab[] = [
  {
    to: '/dash',
    label: () => m.dash_queue(),
    end: true,
    admin: false,
    count: 'queue',
  },
  {
    to: '/dash/reports',
    label: () => m.dash_reports(),
    end: false,
    admin: false,
    count: 'reports',
  },
  { to: '/dash/users', label: () => m.admin_users(), end: false, admin: true },
  { to: '/dash/trash', label: () => m.admin_trash(), end: false, admin: true },
  { to: '/dash/site', label: () => m.admin_site(), end: false, admin: true },
]

export default function DashLayout({ loaderData }: Route.ComponentProps) {
  const isAdmin = loaderData.user.role === 'admin'
  const visible = tabs.filter((t) => !t.admin || isAdmin)

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold">{m.dash()}</h1>
      <nav className="mt-4 flex flex-wrap gap-1 border-b">
        {visible.map((t) => (
          <NavLink
            key={t.to}
            to={localizeHref(t.to)}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`
            }
          >
            {t.label()}
            {t.count && loaderData.counts[t.count] > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-xs text-primary">
                {loaderData.counts[t.count]}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </main>
  )
}
