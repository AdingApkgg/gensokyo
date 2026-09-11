import { Link } from 'react-router'
import { errorMessage } from '~/lib/api-error'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

/**
 * 错误码的可读文案，**外加一个出路（如果这个码有出路的话）**。
 *
 * 为什么不止是 `errorMessage()`：`email_unverified` 之前渲染成一句纯文本
 * 「请先验证邮箱后再发布内容。」——没有任何可点的东西。而 `/verify` 全站只从
 * 注册页与 Google 按钮链出去，于是「注册 → 关掉标签页 → 第二天回来发帖」
 * 的人被挡住之后无路可走：站内找不到那一页。拒绝必须自带出路，否则它只是
 * 在陈述一个事实。
 *
 * 只对「用户能自己解决」的码加链接。`forbidden` / `not_found` 之类没有出路，
 * 加个链接只是把人送去一个同样走不通的地方。
 *
 * 不用 motion、不用 `AlertLine`：它渲染在匿名可读路由的可达集里（资源页、
 * 主题页），那里静态图零 motion。
 */
export function ErrorText({ code }: { code: string | undefined }) {
  if (code === 'email_unverified')
    return (
      <>
        {errorMessage(code)}{' '}
        <Link
          to={localizeHref('/verify')}
          viewTransition
          className="underline underline-offset-4"
        >
          {m.auth_verify_cta()}
        </Link>
      </>
    )
  return <>{errorMessage(code)}</>
}
