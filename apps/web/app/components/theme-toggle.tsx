import { Moon, Sun } from 'lucide-react'
import { useCallback } from 'react'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages'

/**
 * 主题开关。**刻意不持有当前主题的 state**——
 * root.tsx 的 themeInit 内联脚本在首帧前就把 `dark` 类打在 <html> 上了，
 * 所以两个图标都渲染、用 CSS 的 dark: 变体决定谁可见，服务端与客户端
 * 输出逐字节相同。旧实现用状态与副作用读 DOM：SSR 恒出月亮，
 * 深色用户每次刷新都看到月亮闪成太阳。
 */
export function ThemeToggle() {
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {}
  }, [])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={m.theme_toggle()}
    >
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </Button>
  )
}
