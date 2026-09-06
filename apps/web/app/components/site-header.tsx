import { Bell, UserRound } from 'lucide-react'
import { Link, NavLink, useRevalidator } from 'react-router'
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

  async function logout() {
    /**
     * 动态 import：`SiteHeader` 在 root.tsx 里，是所有路由的父级——顶层 import
     * 会把 better-auth 客户端（10.7 KB gz）钉进每一个匿名访客的首屏包，
     * 而匿名访客按定义永远不会登出。
     * login/register 有自己的路由 chunk，不受这里影响。
     */
    const { authClient } = await import('~/lib/auth-client')
    await authClient.signOut()
    revalidator.revalidate()
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:gap-6">
        <MobileNav items={NAV_ITEMS} />
        <Link
          to={localizeHref('/')}
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
                {user.unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                    {user.unread >= 100 ? '99+' : user.unread}
                  </span>
                )}
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
                  <Link to={localizeHref(`/u/${user.handle}`)}>
                    {m.nav_profile()}
                  </Link>
                </DropdownMenuItem>
                {(user.role === 'moderator' || user.role === 'admin') && (
                  <DropdownMenuItem asChild>
                    <Link to={localizeHref('/dash')}>{m.dash()}</Link>
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
                <Link to={localizeHref('/login')}>{m.auth_login()}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to={localizeHref('/register')}>{m.auth_register()}</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
      <PendingBar />
    </header>
  )
}
