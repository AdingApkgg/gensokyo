import { Link } from 'react-router'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

export function meta() {
  return [{ title: `${m.site_name()} · Gensokyo` }]
}

const modules = [
  { path: '/kourindou', label: () => m.nav_kourindou() },
  { path: '/shrine', label: () => m.nav_shrine() },
  { path: '/chronicle', label: () => m.nav_chronicle() },
  { path: '/spellcard', label: () => m.nav_spellcard() },
  { path: '/music', label: () => m.nav_music() },
]

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4">
      <section className="py-20 text-center">
        <h1 className="text-5xl font-bold tracking-wide">{m.site_name()}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{m.home_tagline()}</p>
      </section>
      <section className="grid gap-4 pb-12 sm:grid-cols-2 lg:grid-cols-5">
        {modules.map((mod) => (
          <Link key={mod.path} to={localizeHref(mod.path)}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="font-heading">{mod.label()}</CardTitle>
                <CardDescription>{m.home_enter()} →</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>
    </main>
  )
}
