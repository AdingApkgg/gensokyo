import { createAuthClient } from 'better-auth/react'

// SSR 期间没有 origin，相对路径会被拒；浏览器端才拼出同源绝对地址
export const authClient = createAuthClient({
  baseURL:
    typeof window === 'undefined'
      ? 'http://localhost/api/auth'
      : `${window.location.origin}/api/auth`,
})
