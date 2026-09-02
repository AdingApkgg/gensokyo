import { classifyLink } from '@gensokyo/shared'

/**
 * 站内 / 站外链接判定（P0-4）。
 *
 * 与 api 侧外链禁令用**同一个** `classifyLink()`：判定方式是「解析出来的
 * origin 是不是我们的」，不是「以 / 开头」。`href.startsWith('/')` 会被
 * `/\evil.com` 绕过——WHATWG 对 special scheme 把 `\` 等同 `/`，`evil.com`
 * 成了 host；CommonMark 里 `\e` 不是转义序列，sanitize 看不到冒号判为相对路径
 * 放行。产物是一个不触发任何浏览器警告的钓鱼链接。第二个变体 `/<TAB>/evil.com`。
 *
 * web 侧不知道自己的绝对 origin（SSR 无 window），所以只把**相对路径**当站内；
 * 写成绝对地址的本站链接会被当成站外多加一个 rel——判错方向的代价是一个站内
 * 链接被误加 nofollow，比放过一次钓鱼便宜。
 */
export const isInternalHref = (href: string) =>
  classifyLink(href, []).kind === 'internal'

/** 站外链接一律带这四个 rel + 新窗口 */
export const externalLinkProps = {
  rel: 'nofollow ugc noreferrer noopener',
  target: '_blank',
} as const

// biome-ignore lint/suspicious/noControlCharactersInRegex: 剥控制字符正是本意
const CTRL = /[\u0000-\u0020\u007f]/g

/**
 * `?next=` 只接受站内相对路径。同一条判定——开放重定向就是 P0-4 的登录页版本。
 * 返回 null 表示不可信，调用方回落到首页。
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null
  const clean = next.replace(CTRL, '')
  if (
    !clean.startsWith('/') ||
    clean.startsWith('//') ||
    clean.startsWith('/\\')
  )
    return null
  return isInternalHref(clean) ? clean : null
}
