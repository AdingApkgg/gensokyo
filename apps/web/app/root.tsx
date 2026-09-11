import { createClient } from '@gensokyo/api-client'
import { MotionConfig } from 'motion/react'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  type MiddlewareFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from 'react-router'
import type { Route } from './+types/root'
import { SiteFooter } from './components/site-footer'
import { SiteHeader } from './components/site-header'
import { SPRING_WASHI } from './lib/motion'
import { siteOrigin } from './lib/origin'
import { alternates, canonicalPath } from './lib/seo'
import { m } from './paraglide/messages'
import { getLocale, locales } from './paraglide/runtime'
import { paraglideMiddleware } from './paraglide/server'
import './app.css'

export const middleware: MiddlewareFunction[] = [
  (ctx, next) => paraglideMiddleware(ctx.request, () => next()),
]

const htmlLang: Record<string, string> = {
  zh: 'zh-CN',
  ja: 'ja',
  en: 'en',
}

/** Open Graph 要的是下划线形式的 `语言_地区`，与 BCP 47 的写法不通用 */
const ogLocale: Record<string, string> = {
  zh: 'zh_CN',
  ja: 'ja_JP',
  en: 'en_US',
}

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300..700&family=Noto+Serif+SC:wght@500..800&family=Noto+Sans+JP:wght@300..700&family=Noto+Serif+JP:wght@500..800&display=swap',
  },
]

const themeInit = `(() => {
  try {
    const saved = localStorage.getItem('theme')
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    if (dark) document.documentElement.classList.add('dark')
  } catch {}
})()`

/**
 * canonical + 三语 hreflang + og:locale。
 *
 * **挂在 Layout 而不是各路由的 `meta`**：RR 的叶子 `meta` 会整体替换 root 的，
 * 而全站几乎每个路由都导出了自己的 `meta`——写在 root 的 meta 里等于不生效。
 * 逐个路由补则是十五处、且漏掉的表现是「什么都不发生」（与 `viewTransition`
 * 同一类无法门禁的漂移）。放这里只有一处。
 *
 * 拿不到 origin（root loader 失败、文档级错误页）时整块不渲染：一个指向
 * `undefined` 的 canonical 比没有 canonical 糟得多。
 */
function SeoLinks() {
  const data = useRouteLoaderData<typeof loader>('root')
  const location = useLocation()
  const origin = data?.origin
  if (!origin) return null

  const locale = getLocale()
  const { canonical, alternates: alts } = alternates(
    canonicalPath(location.pathname, location.search),
    origin,
    locale,
  )
  return (
    <>
      <link rel="canonical" href={canonical} />
      {alts.map((a) => (
        <link
          key={a.hrefLang}
          rel="alternate"
          hrefLang={a.hrefLang}
          href={a.href}
        />
      ))}
      <meta property="og:locale" content={ogLocale[locale] ?? 'zh_CN'} />
      {locales
        .filter((l) => l !== locale)
        .map((l) => (
          <meta
            key={l}
            property="og:locale:alternate"
            content={ogLocale[l] ?? l}
          />
        ))}
      <meta property="og:url" content={canonical} />
    </>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={htmlLang[getLocale()] ?? 'zh-CN'} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 首帧前应用主题，防闪烁 */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <SeoLinks />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export async function loader({ request }: Route.LoaderArgs) {
  /**
   * origin 从这里出去，因为 canonical/hreflang 要在**客户端导航之后**也
   * 正确——Layout 在浏览器里也会重新渲染，那时没有 request 可读。
   */
  const origin = siteOrigin(request)
  const client = createClient(process.env.API_URL ?? 'http://localhost:3001', {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })
  try {
    const res = await client.api.me.$get()
    const { user } = await res.json()
    return { user, origin }
  } catch {
    return { user: null, origin }
  }
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    /**
     * root 树里唯一允许的 motion 用法（见 A2）。两个 prop 都是承重的：
     *   reducedMotion —— 默认是 "never"，不写它 app.css 末尾那个不分层的兜底块
     *     管不到 motion 的任何一条
     *   transition —— 布局动画的兜底是 { duration: 0.45, ease: [0.4,0,0.1,1] }，
     *     不给就是 450ms 的外来缓动
     *
     * 将来加 CSP 时这里要同时给 nonce：AnimatePresence 的 popLayout 会往
     * document.head 注 <style>（PopChild 用它定位退场元素）。没有 nonce
     * 就是生产上弹层与退场动画静默失效——而症状离原因很远。
     */
    <MotionConfig reducedMotion="user" transition={SPRING_WASHI}>
      <div className="flex min-h-screen flex-col">
        {/*
          跳至正文：键盘用户此前必须逐个 Tab 过整条导航才能到内容。

          `focus:px-3 focus:py-2` 不是画蛇添足——Tailwind 的 `not-sr-only` 自带
          `padding: 0; margin: 0`（它要撤掉 `sr-only` 的 `margin: -1px`），而带
          `:focus` 的它特异性 0,2,0 压得过裸 `px-3` 的 0,1,0。不把内边距也提到
          同一级，聚焦后拿到的是一个字贴着描边的 56×20 挤扁盒子（实测过）。
        */}
        <a
          href="#main"
          className="sr-only rounded-md bg-background text-sm ring-1 ring-ring focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2"
        >
          {m.skip_to_content()}
        </a>
        <SiteHeader user={loaderData.user} />
        <div id="main" className="flex-1 scroll-mt-20">
          <Outlet />
        </div>
        <SiteFooter />
      </div>
    </MotionConfig>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // 文案走 Paraglide：中文站上不该出现英文的 Oops
  // 显式 string：Paraglide 的返回值是 LocalizedString 品牌类型，statusText 是裸 string
  let message: string = m.err_page_error_title()
  let details: string = m.err_page_error_desc()
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message =
      error.status === 404
        ? m.err_page_not_found_title()
        : m.err_page_error_title()
    details =
      error.status === 404
        ? m.err_page_not_found_desc()
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
