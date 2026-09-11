/**
 * 站点对外的绝对基址。
 *
 * canonical、hreflang、sitemap、robots 里的每一个网址都必须是绝对的——
 * 相对网址在这四处**一律被忽略**，不报错，只是不生效。
 *
 * 优先读 `SITE_URL`，因为这是唯一一处「站点对外叫什么」的权威：反向代理
 * 后面 `request.url` 的 host 取自 Host 头，配错一次就会让整站的规范网址
 * 指向内网地址，而那不会有任何症状，只会没有收录。回落到请求 origin 是
 * 为了让本地开发与预览环境不必配置。
 */
export function siteOrigin(request: Request): string {
  const configured = process.env.SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return new URL(request.url).origin
}
