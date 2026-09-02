import { HANDLE_RE } from '@gensokyo/shared'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { browserApi } from '~/lib/api'
import { authClient } from '~/lib/auth-client'
import { safeNext } from '~/lib/links'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

export function meta() {
  return [{ title: `${m.auth_register()} · ${m.site_name()}` }]
}

type HandleError = 'taken' | 'invalid' | null

export default function Register() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState(false)
  const [handleError, setHandleError] = useState<HandleError>(null)
  const [pending, setPending] = useState(false)
  /**
   * signUp 成功后置 true：此后再提交**只**认领 handle，不重跑 signUp——
   * 同邮箱再注册必然失败，而那会把这一次的认领机会烧掉。
   */
  const [registered, setRegistered] = useState(false)
  const next = safeNext(params.get('next'))
  const home = next ?? localizeHref('/')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(false)
    setHandleError(null)
    const form = new FormData(e.currentTarget)
    const handle = String(form.get('handle') ?? '')
      .trim()
      .toLowerCase()

    // 先在客户端挡一次形状，别为一个打错的用户名注册一个账号
    if (handle && !HANDLE_RE.test(handle)) {
      setPending(false)
      return setHandleError('invalid')
    }

    if (!registered) {
      const { error: err } = await authClient.signUp.email({
        name: String(form.get('name')),
        email: String(form.get('email')),
        password: String(form.get('password')),
      })
      if (err) {
        setPending(false)
        return setError(true)
      }
      setRegistered(true)
    }

    /**
     * 注册走客户端 authClient，API 看不到注册——handle 由 sessionMiddleware
     * 惰性派生，这里在注册成功后立刻认领用户自选的值。
     * **只有这一次机会**：派生 handle 一旦暴露（发过帖、被 @ 过）就不能再换。
     * 认领失败不阻断注册：账号已经建好了，用派生名也能用。
     */
    if (handle) {
      const res = await browserApi().api.me.handle.$put({ json: { handle } })
      if (!res.ok) {
        setPending(false)
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string }
        } | null
        setHandleError(
          body?.error?.code === 'duplicate_slug' ? 'taken' : 'invalid',
        )
        // 账号已建：给用户看清楚是用户名没拿到，再决定去哪
        return
      }
    }
    setPending(false)
    navigate(home)
  }

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{m.auth_register()}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{m.auth_name()}</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={32}
                disabled={registered}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="handle">{m.auth_handle()}</Label>
              <Input
                id="handle"
                name="handle"
                maxLength={20}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={handleError ? true : undefined}
                aria-describedby="handle-hint"
              />
              <p id="handle-hint" className="text-xs text-muted-foreground">
                {m.auth_handle_hint()}
              </p>
              {handleError && (
                <p role="alert" className="text-sm text-destructive">
                  {handleError === 'taken'
                    ? m.auth_handle_taken()
                    : m.auth_handle_invalid()}
                </p>
              )}
              {registered && (
                <Link
                  to={home}
                  className="text-xs underline underline-offset-4"
                >
                  {m.auth_handle_skip()}
                </Link>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">{m.auth_email()}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                disabled={registered}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{m.auth_password()}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                disabled={registered}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">
                {m.auth_error_generic()}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {m.auth_register()}
            </Button>
            <Link
              to={
                next
                  ? `${localizeHref('/login')}?next=${encodeURIComponent(next)}`
                  : localizeHref('/login')
              }
              className="text-center text-sm text-muted-foreground hover:text-foreground"
            >
              {m.auth_have_account()}
            </Link>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
