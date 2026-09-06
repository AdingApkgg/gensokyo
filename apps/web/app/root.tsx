import { createClient } from '@gensokyo/api-client'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  type MiddlewareFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router'
import type { Route } from './+types/root'
import { SiteFooter } from './components/site-footer'
import { SiteHeader } from './components/site-header'
import { m } from './paraglide/messages'
import { getLocale } from './paraglide/runtime'
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

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={htmlLang[getLocale()] ?? 'zh-CN'} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 首帧前应用主题，防闪烁 */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
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
  const client = createClient(process.env.API_URL ?? 'http://localhost:3001', {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })
  try {
    const res = await client.api.me.$get()
    const { user } = await res.json()
    return { user }
  } catch {
    return { user: null }
  }
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
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
