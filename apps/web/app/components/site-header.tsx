import { Bell, UserRound } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, NavLink, useNavigation, useRevalidator } from 'react-router'
import { LangSwitcher } from '~/components/lang-switcher'
import { MobileNav } from '~/components/mobile-nav'
import { PendingBar } from '~/components/pending-bar'
import { ThemeToggle } from '~/components/theme-toggle'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

export type SessionUser = {
  id: string
  name: string
  email: string
  handle: string
  role: 'user' | 'moderator' | 'admin'
  approvedResourceCount: number
  strikeCount: number
  /** 未读通知数，服务端 100 截断 */
  unread: number
}

export const NAV_ITEMS = [
  { path: '/kourindou', label: () => m.nav_kourindou() },
  { path: '/shrine', label: () => m.nav_shrine() },
  { path: '/chronicle', label: () => m.nav_chronicle() },
  { path: '/spellcard', label: () => m.nav_spellcard() },
  { path: '/music', label: () => m.nav_music() },
]

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const revalidator = useRevalidator()
  const header = useRef<HTMLElement>(null)
  const navigation = useNavigation()

  /**
   * 下滚收起、上滚露出。手写——本组件在 root 树里，不许引 motion（A2）。
   *
   * 强制露出的三种情况：接近页顶（< 56px）；导航在途（pending 墨线挂在下缘，
   * 藏起来就看不见了；且 ScrollRestoration 在这之后才滚，深链落点按 header 可见算）；
   * hashchange（同上，页内锚点跳转）。焦点在 header 内时不收（键盘用户正在用它）。
   *
   * passive + rAF 节流 + 只在值变化时写 dataset：它是每页每次滚动都跑的回调。
   * 减弱动效：整个功能不启用——56px 的条瞬间出没是位移类刺激，换来的只是 56px 空间。
   */
  useEffect(() => {
    const el = header.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let last = window.scrollY
    let ticking = false
    const set = (hidden: boolean) => {
      const next = hidden ? 'true' : 'false'
      if (el.dataset.hidden !== next) el.dataset.hidden = next
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const y = window.scrollY
        const dy = y - last
        last = y
        if (y < 56 || dy < -4) set(false)
        else if (dy > 4 && !el.matches(':focus-within')) set(true)
      })
    }
    const show = () => set(false)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('hashchange', show)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('hashchange', show)
    }
  }, [])
  useEffect(() => {
    if (navigation.state !== 'idle')
      header.current?.setAttribute('data-hidden', 'false')
  }, [navigation.state])

  async function logout() {
    /**
     * 动态 import：`SiteHeader` 在 root.tsx 里，是所有路由的父级——顶层 import
     * 会把 better-auth 客户端（10.7 KB gz）钉进每一个匿名访客的首屏包，
     * 而匿名访客按定义永远不会登出。
     * login/register 有自己的路由 chunk，不受这里影响。
     *
     * try/catch 不是形式主义：动态 import 引入了一个顶层 import 没有的失败模式——
     * 部署之后老页面还开着、chunk 哈希已变，这里会 404。
     * **不 rethrow**：从 async 的 onClick 里抛出去是 unhandled rejection，React 接不住，
     * 症状和不写 catch 一样是「点了没反应」。
     * **finally 里仍然 revalidate**：登出失败时它会如实显示「仍处于登录态」，
     * 那正是真实状态——诚实的 UI 好过假装成功。
     */
    try {
      const { authClient } = await import('~/lib/auth-client')
      await authClient.signOut()
    } catch (err) {
      console.error('signOut failed', err)
    } finally {
      revalidator.revalidate()
    }
  }

  return (
    <header
      ref={header}
      className="site-header sticky top-0 z-40 border-b bg-background/85 backdrop-blur"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:gap-6">
        <MobileNav items={NAV_ITEMS} />
        <Link
          to={localizeHref('/')}
          viewTransition
          className="font-heading text-lg font-bold tracking-wide"
        >
          {m.site_name()}
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={localizeHref(item.path)}
              viewTransition
              prefetch="intent"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted ${
                  isActive
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
                }`
              }
            >
              {item.label()}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <LangSwitcher />
          <ThemeToggle />
          {user && (
            <Button variant="ghost" size="icon" asChild>
              <Link
                to={localizeHref('/notifications')}
                viewTransition
                aria-label={
                  user.unread > 0
                    ? m.notif_unread_n({
                        n: user.unread >= 100 ? '99+' : String(user.unread),
                      })
                    : m.nav_notifications()
                }
                className="relative"
              >
                <Bell />
                <span
                  className={`absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground transition-[opacity,scale] ${
                    user.unread > 0
                      ? 'opacity-100 scale-100'
                      : 'scale-75 opacity-0'
                  }`}
                  aria-hidden={user.unread === 0}
                >
                  {user.unread >= 100 ? '99+' : user.unread}
                </span>
              </Link>
            </Button>
          )}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={user.name}>
                  <UserRound />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {user.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={localizeHref(`/u/${user.handle}`)} viewTransition>
                    {m.nav_profile()}
                  </Link>
                </DropdownMenuItem>
                {(user.role === 'moderator' || user.role === 'admin') && (
                  <DropdownMenuItem asChild>
                    <Link to={localizeHref('/dash')} viewTransition>
                      {m.dash()}
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={logout}>
                  {m.auth_logout()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2 pl-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to={localizeHref('/login')} viewTransition>
                  {m.auth_login()}
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link to={localizeHref('/register')} viewTransition>
                  {m.auth_register()}
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>
      <PendingBar />
    </header>
  )
}
