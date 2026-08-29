import { createClient } from '@gensokyo/api-client'

/**
 * SSR 侧的 api 客户端。
 *
 * loader/action 跑在服务端，浏览器的 cookie 不会自动带上，
 * 必须从进来的 request 手动转发——否则登录用户在 SSR 阶段全是匿名的。
 */
export function apiFor(request: Request) {
  return createClient(process.env.API_URL ?? 'http://localhost:3001', {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })
}

/** 浏览器侧：同源相对路径，走 Vite/Caddy 代理 */
export const browserApi = () =>
  createClient(
    typeof window === 'undefined'
      ? 'http://localhost:3001'
      : window.location.origin,
  )
