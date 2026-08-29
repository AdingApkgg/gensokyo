import { Construction } from 'lucide-react'
import { useLocation } from 'react-router'
import { m } from '~/paraglide/messages'
import { deLocalizeHref } from '~/paraglide/runtime'

const names: Record<string, () => string> = {
  '/kourindou': () => m.nav_kourindou(),
  '/shrine': () => m.nav_shrine(),
  '/chronicle': () => m.nav_chronicle(),
  '/spellcard': () => m.nav_spellcard(),
  '/music': () => m.nav_music(),
}

export function meta() {
  return [{ title: `${m.wip_title()} · ${m.site_name()}` }]
}

export default function ModuleStub() {
  const { pathname } = useLocation()
  const name = names[deLocalizeHref(pathname)]?.() ?? m.wip_title()

  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <div className="text-center">
        <Construction className="mx-auto size-10 text-muted-foreground" />
        <h1 className="mt-4 text-3xl font-bold">{name}</h1>
        <p className="mt-2 text-muted-foreground">{m.wip_desc()}</p>
      </div>
    </main>
  )
}
