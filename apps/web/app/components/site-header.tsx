import { UserRound } from 'lucide-react'
import { Link, NavLink, useRevalidator } from 'react-router'
import { LangSwitcher } from '~/components/lang-switcher'
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
import { authClient } from '~/lib/auth-client'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: 'user' | 'moderator' | 'admin'
  approvedResourceCount: number
  strikeCount: number
}

const nav = [
  { path: '/kourindou', label: () => m.nav_kourindou() },
  { path: '/shrine', label: () => m.nav_shrine() },
  { path: '/chronicle', label: () => m.nav_chronicle() },
  { path: '/spellcard', label: () => m.nav_spellcard() },
  { path: '/music', label: () => m.nav_music() },
]

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const revalidator = useRevalidator()

  async function logout() {
    await authClient.signOut()
    revalidator.revalidate()
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link
          to={localizeHref('/')}
          className="font-heading text-lg font-bold tracking-wide"
        >
          {m.site_name()}
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <NavLink
              key={item.path}
              to={localizeHref(item.path)}
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
    </header>
  )
}
