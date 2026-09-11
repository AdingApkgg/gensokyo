import { Button } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

/**
 * 登录页与注册页共用的「分隔线（或）+ Google 按钮」整块。两页各渲染一个
 * `<GoogleButton next={...} />` 就够——门控（要不要显示）是调用方条件渲染
 * 的事：登录页看 googleEnabled，注册页还要叠一层 registrationOpen。组件
 * 本身不需要知道 registrationOpen 存在，props 只留 next，不然抽出来反而要
 * 传更多参数。
 *
 * 图标内联而不是装图标包——根集有预算（见 CLAUDE.md），为一个 4 色小图标
 * 引一整个包不划算。
 *
 * callbackURL 统一指 /verify：那一页自己判断「邮箱验证 + handle 认领」两段
 * 是否都已完成、完成就立刻跳走。**不依赖 newUserCallbackURL**，少一个
 * 待确认的 API 面。
 */
export function GoogleButton({ next }: { next: string | null }) {
  const callbackURL = next
    ? `${localizeHref('/verify')}?next=${encodeURIComponent(next)}`
    : localizeHref('/verify')

  return (
    <>
      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-foreground/10" />
        <span className="text-xs text-muted-foreground">{m.auth_or()}</span>
        <span className="h-px flex-1 bg-foreground/10" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() =>
          authClient.signIn.social({ provider: 'google', callbackURL })
        }
      >
        <svg
          viewBox="0 0 18 18"
          aria-hidden="true"
          className="size-4"
          focusable="false"
        >
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
          />
        </svg>
        {m.auth_continue_google()}
      </Button>
    </>
  )
}
