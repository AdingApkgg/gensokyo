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

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!'
  let details = 'An unexpected error occurred.'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error'
    details =
      error.status === 404
        ? 'The requested page could not be found.'
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
