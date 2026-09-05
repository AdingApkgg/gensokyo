import { Menu } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

type Item = { path: string; label: () => string }

/**
 * 移动端导航抽屉。
 *
 * 此前 <768px 的用户看不到五个模块入口中的任何一个——site-header 的主导航是
 * `hidden md:flex`，而全站没有任何 md:hidden 的替代入口。
 *
 * 用 radix-ui 的 Dialog 而不是装 vaul/sheet：Dialog 已经在仓库里，
 * 焦点陷阱、Esc 关闭、aria-modal、滚动锁定它全都做了，缺的只是从侧面滑进来。
 */
export function MobileNav({ items }: { items: readonly Item[] }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  // 导航后自动关闭：Radix 不知道路由变了
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname 是刻意的重触发条件，不是遗漏
  useEffect(() => setOpen(false), [pathname])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={m.nav_menu()}
        >
          <Menu />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          // Radix 已把 aria-labelledby 接到下面的 Title，Content 上再给
          // aria-label 按 ARIA 规范会被忽略，是死重量；显式传 undefined 的
          // aria-describedby 消掉 Radix 在 dev 下「缺少 Description」的常驻警告
          aria-describedby={undefined}
          className="fixed inset-y-0 start-0 z-50 flex w-64 max-w-[80vw] flex-col gap-1 bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
        >
          <DialogPrimitive.Title className="mb-2 font-heading text-lg font-bold">
            {m.site_name()}
          </DialogPrimitive.Title>
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={localizeHref(item.path)}
              viewTransition
              prefetch="intent"
              // 点击已经在的那一项时 pathname 不变，上面那条 pathname effect
              // 不会触发，抽屉会留在屏幕上——两条关闭路径并存，互不干扰
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted ${
                  isActive
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground'
                }`
              }
            >
              {item.label()}
            </NavLink>
          ))}
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="sm" className="mt-auto">
              {m.nav_menu_close()}
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
