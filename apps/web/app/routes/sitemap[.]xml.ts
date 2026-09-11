import { BOARD_SLUGS } from '@gensokyo/shared'
import { apiFor } from '~/lib/api'
import { siteOrigin } from '~/lib/origin'
import { type SitemapEntry, sitemapXml } from '~/lib/seo'
import type { Route } from './+types/sitemap[.]xml'

/**
 * sitemap.xml。**不在 `:locale?` 前缀里**——它是全站唯一一份清单，
 * 三语互链写在每个条目的 `<xhtml:link>` 里，不是三份各自的 sitemap。
 *
 * 里面只放匿名访客打得开的页面：后台、通知、登录注册、还没做的三个模块
 * 都不在。stub 页（chronicle / spellcard / music）进了也只是给搜索引擎
 * 三个「施工中」，那是薄内容。
 */
export async function loader({ request }: Route.LoaderArgs) {
  const origin = siteOrigin(request)
  const api = apiFor(request)

  const entries: SitemapEntry[] = [
    { path: '/', lastmod: null },
    { path: '/kourindou', lastmod: null },
    { path: '/shrine', lastmod: null },
    ...BOARD_SLUGS.map((b) => ({ path: `/shrine/b/${b}`, lastmod: null })),
  ]

  /**
   * 拿不到数据时**照样发静态部分**，不是 500：一份少了资源条目的 sitemap
   * 仍然有用，而一个 500 会让搜索引擎在退避期内连静态页也不再来取。
   */
  try {
    const res = await api.api.sitemap.$get()
    if (res.ok) {
      const body = await res.json()
      for (const r of body.resources) {
        entries.push({ path: `/kourindou/${r.slug}`, lastmod: r.updatedAt })
      }
      for (const t of body.topics) {
        entries.push({ path: `/shrine/t/${t.id}`, lastmod: t.lastPostAt })
      }
    }
  } catch {
    // 同上：静态部分照发
  }

  return new Response(sitemapXml(origin, entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // 爬虫一天来不了几次，一小时的缓存足够挡住把整表扫一遍的重复请求
      'cache-control': 'public, max-age=3600',
    },
  })
}
