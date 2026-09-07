import { motion } from 'motion/react'
import {
  NavLink,
  Outlet,
  redirect,
  useLocation,
  useNavigation,
} from 'react-router'
import { apiFor } from '~/lib/api'
import { SPRING_WASHI } from '~/lib/motion'
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
  const navigation = useNavigation()
  // 不能省：右边那个 location 若靠全局，SSR 时 Bun/Node 都没有它 → 五个 tab 全 500
  const location = useLocation()

  /**
   * 抢跑。`NavLink` 的 `isActive` 读的是**已提交**的 location，要等目标 tab 的
   * loader 返回才翻转——而每个 tab 的 loader 都要打 API，切一次有 150–400ms
   * 页面完全不动；T1 的 pending 墨线在 header 顶端，视线落在 tab 上的人看不见。
   * 用 pending location 让下划线在**点击那一刻**就走。审核员一天切 20–40 次。
   *
   * `useNavigation()` 是**全局**导航状态，不限于 dash 内部：从 /dash 点去
   * /kourindou 时它同样给出 pending location。所以只在目标仍在 dash 内时才抢跑，
   * 否则下划线会在离开 dash 的那一瞬间先跳到一个并不存在的 tab 上。
   */
  const dashRoot = localizeHref('/dash')
  const inDash = (p: string) => p === dashRoot || p.startsWith(`${dashRoot}/`)
  const pending = navigation.location?.pathname
  const activePath = pending && inDash(pending) ? pending : location.pathname

  /** 与 NavLink 的 `end` 同语义，但按 activePath（可能是 pending）算 */
  const isActiveTab = (t: Tab) => {
    const to = localizeHref(t.to)
    return t.end
      ? activePath === to
      : activePath === to || activePath.startsWith(`${to}/`)
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold">{m.dash()}</h1>
      <nav className="mt-4 flex flex-wrap gap-1 border-b">
        {visible.map((t) => {
          const active = isActiveTab(t)
          // 全站唯一**不带** viewTransition 的导航链接：原生 VT 会把整页截进
          // ::view-transition-*(root) 的快照，下面那条 layoutId 下划线的滑动
          // 会被一起压进快照里，一帧都看不见。
          // 下一次「viewTransition 补全扫描」请跳过这一处（CLAUDE.md 已记 32/33）。
          return (
            <NavLink
              key={t.to}
              to={localizeHref(t.to)}
              end={t.end}
              className={`relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-primary font-medium text-foreground sm:border-transparent'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label()}
              {t.count && loaderData.counts[t.count] > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-xs text-primary">
                  {loaderData.counts[t.count]}
                </span>
              )}
              {active && (
                <motion.span
                  layoutId="dash-tab-underline"
                  transition={SPRING_WASHI}
                  /**
                   * `-bottom-0.5`：绝对定位的包含块是父元素的 **padding box**，
                   * 不含那 2px 的 border 占位。-2px 才让这条 2px 的线落在
                   * border-box 底边上，与它替换掉的 `border-b-2` 位置重合。
                   *
                   * `hidden sm:block`：nav 是 flex-wrap，admin 有 5 个 tab，
                   * 窄屏折行后下划线会从上一行斜穿到下一行。窄屏退回上面那条
                   * 静态 `border-primary`（所以 active 态才写成 sm:border-transparent）。
                   */
                  className="absolute inset-x-0 -bottom-0.5 hidden h-0.5 bg-primary sm:block"
                />
              )}
            </NavLink>
          )
        })}
      </nav>
      <Outlet />
    </main>
  )
}
