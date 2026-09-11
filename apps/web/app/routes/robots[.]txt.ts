import { siteOrigin } from '~/lib/origin'
import { robotsTxt } from '~/lib/seo'
import type { Route } from './+types/robots[.]txt'

export function loader({ request }: Route.LoaderArgs) {
  return new Response(robotsTxt(siteOrigin(request)), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
