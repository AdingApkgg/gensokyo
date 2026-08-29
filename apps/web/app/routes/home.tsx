import { createClient } from '@gensokyo/api-client'
import type { Route } from './+types/home'

export function meta(_: Route.MetaArgs) {
  return [{ title: '幻想乡 · Gensokyo' }]
}

export async function loader() {
  const client = createClient(process.env.API_URL ?? 'http://localhost:3001')
  const res = await client.api.health.$get()
  return { health: await res.json() }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold">幻想乡 · Gensokyo</h1>
        <p className="mt-2 text-sm opacity-70">
          api: {loaderData.health.status}
        </p>
      </div>
    </main>
  )
}
