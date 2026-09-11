import { LOCALE_HEADER } from '@gensokyo/shared'
import { createAuthClient } from 'better-auth/react'
import { getLocale } from '~/paraglide/runtime'

// SSR 期间没有 origin，相对路径会被拒；浏览器端才拼出同源绝对地址
export const authClient = createAuthClient({
  baseURL:
    typeof window === 'undefined'
      ? 'http://localhost/api/auth'
      : `${window.location.origin}/api/auth`,
  fetchOptions: {
    /**
     * 把界面语言带给 api——验证码邮件要按它选语言。
     * api 读不到这个头时会回落 Paraglide 的 locale cookie，再回落 zh；
     * **两边都不读 `Accept-Language`**（那是浏览器语言，不是站内选的语言）。
     */
    headers: { [LOCALE_HEADER]: getLocale() },
  },
})
