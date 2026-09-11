import {
  baseLocale,
  deLocalizeHref,
  locales,
  localizeHref,
} from '~/paraglide/runtime'

/**
 * 多语站的搜索引擎契约：canonical / hreflang / sitemap / robots。
 *
 * 三语同一份内容分布在三个网址上（zh 无前缀、ja 与 en 带前缀）。不声明
 * 它们互为译本，搜索引擎只会当成三个近重复页面，挑一个收录、丢掉另外两个
 * ——「面向全球」的日文与英文界面就等于不存在。
 *
 * 这里的函数都是纯的，各自有单测：它们的输出不会有人逐个去看，错了也不会
 * 报错，只会在几个月后表现为「日文站没有流量」。
 */

/**
 * BCP 47 标签。`<html lang>` 与 hreflang **共用这一份**。
 *
 * zh 用 `zh-Hans` 而不是 `zh-CN`：我们声明的是「简体中文写成的内容」，
 * 不是「给中国大陆用户看的内容」——港台读者同样读得懂。
 */
export const BCP47: Record<string, string> = {
  zh: 'zh-Hans',
  ja: 'ja',
  en: 'en',
}

/**
 * 进入规范网址的查询参数白名单。
 *
 * `page` / `floor` 指向**不同的内容**，各自是一个页面；筛选参数不是——
 * kind × license × 六个标签的组合空间会把一百来条资源膨胀成上千个近重复
 * 页面，全部指回裸列表页才对。白名单而不是黑名单：将来新增的追踪参数
 * 会自动落在外面，而新增的分页参数漏掉了只是少收录一页，不会污染索引。
 */
const CANONICAL_PARAMS = ['page', 'floor'] as const

/** 规范路径：剥掉不进索引的查询参数，并把保留的那些排成固定顺序 */
export function canonicalPath(pathname: string, search: string): string {
  const from = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const k of CANONICAL_PARAMS) {
    const v = from.get(k)
    if (v !== null) kept.set(k, v)
  }
  const q = kept.toString()
  return q ? `${pathname}?${q}` : pathname
}

export type Alternates = {
  canonical: string
  alternates: { hrefLang: string; href: string }[]
}

/**
 * 一个路径 → 规范网址 + 三语互链。
 *
 * `canonical` 指向**当前语言自己**，不是基准语：指回中文版等于告诉搜索
 * 引擎「日文页不必收录」，那正好抹掉这三语里战略上最重要的一份。
 */
export function alternates(
  pathAndSearch: string,
  origin: string,
  currentLocale: string,
): Alternates {
  const base = origin.replace(/\/+$/, '')
  // 先剥前缀再逐语言重建，路径本身带不带前缀都得到同一组结果
  const bare = deLocalizeHref(pathAndSearch)
  const abs = (l: string) =>
    base + localizeHref(bare, { locale: l as (typeof locales)[number] })
  return {
    canonical: abs(currentLocale),
    alternates: [
      ...locales.map((l) => ({ hrefLang: BCP47[l] ?? l, href: abs(l) })),
      // x-default 给「语言未知」的访客，指无前缀的基准语
      { hrefLang: 'x-default', href: abs(baseLocale) },
    ],
  }
}

/** 三语前缀：`''`（基准语无前缀）+ `/ja` + `/en` */
const prefixes = () => locales.map((l) => (l === baseLocale ? '' : `/${l}`))

/**
 * robots.txt。
 *
 * `/api` 必须挡住：下载走 `/api/kourindou/.../download`，**那个端点每次都
 * 记一次下载数**，放爬虫进去等于让下载量变成爬虫访问量。
 *
 * 后台与通知逐语言各挡一遍——robots 的路径是前缀匹配，`Disallow: /dash`
 * 盖不住 `/ja/dash`。
 */
export function robotsTxt(origin: string): string {
  const base = origin.replace(/\/+$/, '')
  const perLocale = ['/dash', '/notifications', '/login', '/register', '/ui']
  const lines = [
    'User-agent: *',
    'Disallow: /api',
    ...prefixes().flatMap((p) =>
      perLocale.map((path) => `Disallow: ${p}${path}`),
    ),
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ]
  return lines.join('\n')
}

export type SitemapEntry = {
  /** 不带语言前缀的路径，如 `/kourindou/abc` */
  path: string
  lastmod: Date | string | null
}

const xmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c] ?? c,
  )

/**
 * sitemap.xml。
 *
 * **一个页面一条 `<url>`**，三语放进它的 `<xhtml:link>` 里，而不是三条
 * 各自独立的 `<url>`。后者会让同一份内容以三个条目进索引，正是 hreflang
 * 要消除的那种重复。
 *
 * `xmlns:xhtml` 不声明的话，所有 alternate 会被静默忽略——文档照常解析，
 * 只是互链一条都不生效。
 */
export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const base = origin.replace(/\/+$/, '')
  const urls = entries.map((e) => {
    const { canonical, alternates: alts } = alternates(e.path, base, baseLocale)
    const links = alts
      .map(
        (a) =>
          `    <xhtml:link rel="alternate" hreflang="${a.hrefLang}" href="${xmlEscape(a.href)}"/>`,
      )
      .join('\n')
    const lastmod = e.lastmod
      ? `\n    <lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>`
      : ''
    return `  <url>\n    <loc>${xmlEscape(canonical)}</loc>${lastmod}\n${links}\n  </url>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
