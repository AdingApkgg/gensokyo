import type { Config } from '@react-router/dev/config'

/**
 * 反代之后 action 会被 CSRF 保护挡下，必须显式放行公开域名。
 *
 * React Router 8 的 throwIfPotentialCSRFAttack 比较 `origin` 头与
 * `request.url` 的 origin。隧道/反代后面这两者**协议不同**：
 * 浏览器发的是 `https://th.saop.cc`，而 Caddy → web 走明文，
 * 服务端重建出的是 `http://th.saop.cc`——origin 不等，所有 action 一律 400
 * （表现是页面弹「Oops! An unexpected error occurred.」，
 *  而 loader 的 GET 全部正常，所以只有写操作会坏）。
 *
 * 域名从构建参数来，不写死：本地开发同源，不需要放行任何东西。
 */
const allowed = (process.env.ALLOWED_ACTION_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export default {
  ssr: true,
  ...(allowed.length ? { allowedActionOrigins: allowed } : {}),
} satisfies Config
