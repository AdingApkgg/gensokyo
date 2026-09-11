import { describe, expect, test } from 'bun:test'
import { alternates, canonicalPath, robotsTxt, sitemapXml } from './seo'

const ORIGIN = 'https://th.example'

describe('canonicalPath', () => {
  /** 分页是不同的内容，各自成一个规范网址；否则第 2 页永远不进索引 */
  test('保留 page 与 floor', () => {
    expect(canonicalPath('/kourindou', '?page=3')).toBe('/kourindou?page=3')
    expect(canonicalPath('/shrine/t/abc', '?floor=21')).toBe(
      '/shrine/t/abc?floor=21',
    )
  })

  /**
   * 筛选出来的视图不单独进索引：一个 kind × license × 6 个标签的组合空间
   * 会把 110 条资源膨胀成上千个近重复页面，全部指回裸列表页才是对的。
   */
  test('丢掉筛选与追踪参数', () => {
    expect(canonicalPath('/kourindou', '?kind=game&tag=th06')).toBe(
      '/kourindou',
    )
    expect(canonicalPath('/kourindou', '?utm_source=x&page=2')).toBe(
      '/kourindou?page=2',
    )
  })

  test('参数顺序归一化，免得同一页出两个规范网址', () => {
    expect(canonicalPath('/x', '?floor=2&page=1')).toBe('/x?page=1&floor=2')
  })

  test('没有参数时不留下问号', () => {
    expect(canonicalPath('/kourindou', '')).toBe('/kourindou')
    expect(canonicalPath('/kourindou', '?utm_source=x')).toBe('/kourindou')
  })
})

describe('alternates', () => {
  test('三语各一条，外加 x-default 指向无前缀的基准语', () => {
    const r = alternates('/kourindou/abc', ORIGIN, 'zh')
    expect(r.alternates).toEqual([
      { hrefLang: 'zh-Hans', href: 'https://th.example/kourindou/abc' },
      { hrefLang: 'ja', href: 'https://th.example/ja/kourindou/abc' },
      { hrefLang: 'en', href: 'https://th.example/en/kourindou/abc' },
      { hrefLang: 'x-default', href: 'https://th.example/kourindou/abc' },
    ])
  })

  /** 规范网址指向**当前语言自己**，不是基准语——否则日文站永远不进索引 */
  test('canonical 跟着当前语言走', () => {
    expect(alternates('/ja/kourindou/abc', ORIGIN, 'ja').canonical).toBe(
      'https://th.example/ja/kourindou/abc',
    )
    expect(alternates('/ja/kourindou/abc', ORIGIN, 'zh').canonical).toBe(
      'https://th.example/kourindou/abc',
    )
  })

  test('带前缀的路径先剥掉前缀再逐语言重建', () => {
    const r = alternates('/en/shrine', ORIGIN, 'en')
    expect(r.alternates.map((a) => a.href)).toEqual([
      'https://th.example/shrine',
      'https://th.example/ja/shrine',
      'https://th.example/en/shrine',
      'https://th.example/shrine',
    ])
  })

  /**
   * 首页是全站唯一一个带尾斜杠的本地化结果（`/ja/`）。**照抄 Paraglide 的
   * 输出、不做归一化**：site-header 的站名链接用的就是 `localizeHref('/')`，
   * 归一化成 `/ja` 会让规范网址和站内每一个指向首页的链接对不上，爬虫要为
   * 同一个页面抓两次。
   */
  test('首页照抄 Paraglide 的尾斜杠', () => {
    const r = alternates('/', ORIGIN, 'zh')
    expect(r.canonical).toBe('https://th.example/')
    expect(r.alternates[1]?.href).toBe('https://th.example/ja/')
  })

  test('origin 末尾的斜杠不会变成双斜杠', () => {
    expect(alternates('/shrine', 'https://th.example/', 'zh').canonical).toBe(
      'https://th.example/shrine',
    )
  })
})

describe('robotsTxt', () => {
  test('指向 sitemap 的绝对地址', () => {
    expect(robotsTxt(ORIGIN)).toContain(
      'Sitemap: https://th.example/sitemap.xml',
    )
  })

  /**
   * /api 必须挡住：下载走 `/api/.../download` 并且**每次都记一次下载数**，
   * 放爬虫进去等于让下载量变成爬虫访问量。
   */
  test('挡住 /api', () => {
    expect(robotsTxt(ORIGIN)).toContain('Disallow: /api')
  })

  /** 后台与通知三语各挡一遍：robots 的路径是前缀匹配，/ja/dash 不被 /dash 覆盖 */
  test('后台三语都挡', () => {
    const txt = robotsTxt(ORIGIN)
    expect(txt).toContain('Disallow: /dash')
    expect(txt).toContain('Disallow: /ja/dash')
    expect(txt).toContain('Disallow: /en/dash')
  })
})

describe('sitemapXml', () => {
  const xml = sitemapXml(ORIGIN, [
    { path: '/', lastmod: null },
    { path: '/kourindou/abc', lastmod: new Date('2026-03-04T05:06:07Z') },
  ])

  test('一个 url 条目 = 一个页面，三语放在 xhtml:link 里', () => {
    expect(xml).toContain('<loc>https://th.example/kourindou/abc</loc>')
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="ja" href="https://th.example/ja/kourindou/abc"/>',
    )
    expect(xml).toContain('hreflang="x-default"')
    // 三语 + x-default，两个条目
    expect(xml.split('<url>').length - 1).toBe(2)
  })

  test('声明了 xhtml 命名空间，否则 alternate 会被整个忽略', () => {
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
  })

  test('lastmod 是 ISO 日期，没有就不输出这个标签', () => {
    expect(xml).toContain('<lastmod>2026-03-04</lastmod>')
    expect(xml.split('<lastmod>').length - 1).toBe(1)
  })

  test('转义 XML 元字符——slug 进的是 URL，& 会让整份文档无法解析', () => {
    const x = sitemapXml(ORIGIN, [{ path: '/kourindou/a&b', lastmod: null }])
    expect(x).toContain('/kourindou/a&amp;b')
    expect(x).not.toContain('/kourindou/a&b<')
  })
})
