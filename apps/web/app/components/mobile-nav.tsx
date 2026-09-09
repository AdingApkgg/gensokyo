import { Menu } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
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

  /**
   * 边缘划走关闭：手指从抽屉上向左拖，抽屉跟着手走；松手时拖过 35% 宽度或
   * 甩动够快就关，否则弹回。手写 Pointer Events——本组件在 root 树里，不许引 motion。
   *
   * 只认触摸与笔（鼠标有 Esc、遮罩与关闭按钮）；先分辨轴向，竖向的交给滚动
   * （Content 上的 touch-pan-y 让浏览器只接管竖向）。
   *
   * 关闭时先把抽屉送到 -100%，transitionend 再 setOpen(false)：Radix 的退场
   * 动画会从当前 transform（已是 -100%）开始，不会先跳回 0 再滑出。
   * 减弱动效：瞬时到位，不做过渡。
   */
  const content = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    x: number
    y: number
    t: number
    axis: 'x' | 'y' | null
  } | null>(null)
  const swiped = useRef(false)
  useEffect(() => {
    if (open) swiped.current = false
  }, [open])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    gesture.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, axis: null }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const el = content.current
    if (!g || !el) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (g.axis === 'x') el.setPointerCapture(e.pointerId)
    }
    if (g.axis !== 'x') return
    el.style.transition = 'none'
    el.style.transform = `translateX(${Math.min(0, dx)}px)`
  }
  const settle = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) => {
    const g = gesture.current
    const el = content.current
    gesture.current = null
    if (!g || !el || g.axis !== 'x') return
    const dx = e.clientX - g.x
    const velocity = dx / Math.max(1, e.timeStamp - g.t) // px/ms，负 = 向左
    const close = !cancelled && (dx < -el.offsetWidth * 0.35 || velocity < -0.5)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    el.style.transition = reduce
      ? 'none'
      : 'transform var(--transition-duration-washi-sm) var(--ease-washi)'
    if (!close) {
      el.style.transform = ''
      return
    }
    swiped.current = true
    el.style.transform = 'translateX(-100%)'
    if (reduce) {
      setOpen(false)
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setOpen(false)
    }
    el.addEventListener('transitionend', finish, { once: true })
    // transitionend 被打断时不触发；兜底一次，与 washi-sm 同量级
    setTimeout(finish, 250)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) =>
    settle(e, false)
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) =>
    settle(e, true)
  /** 划走之后紧跟的 click（落在某个 NavLink 上）不是导航意图 */
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!swiped.current) return
    swiped.current = false
    e.preventDefault()
    e.stopPropagation()
  }

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
          ref={content}
          // Radix 已把 aria-labelledby 接到下面的 Title，Content 上再给
          // aria-label 按 ARIA 规范会被忽略，是死重量；显式传 undefined 的
          // aria-describedby 消掉 Radix 在 dev 下「缺少 Description」的常驻警告
          aria-describedby={undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={onClickCapture}
          className="fixed inset-y-0 start-0 z-50 flex w-64 max-w-[80vw] touch-pan-y flex-col gap-1 bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
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
