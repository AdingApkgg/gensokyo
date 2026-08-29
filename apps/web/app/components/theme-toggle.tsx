import { Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { m } from '~/paraglide/messages'

export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {}
    setDark(next)
  }, [])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={m.theme_toggle()}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
