import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { apiFor } from '~/lib/api'
import { authClient } from '~/lib/auth-client'
import { safeNext } from '~/lib/links'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/register'

export function meta() {
  return [{ title: `${m.auth_register()} · ${m.site_name()}` }]
}

/**
 * 注册是否开放由服务端的 before 钩子强制（`apps/api/src/auth.ts`），
 * 这里读同一份公开配置只是为了**提前说**，别让人填完表单才知道进不来。
 * 读不到配置时按开放处理：真正的门在服务端，页面不该因为一次网络抖动
 * 把能注册的人挡在外面。
 */
export async function loader({ request }: Route.LoaderArgs) {
  try {
    const res = await apiFor(request).api.config.$get()
    const body = (await res.json()) as {
      config?: { registrationOpen?: unknown }
    }
    return { registrationOpen: body.config?.registrationOpen !== false }
  } catch {
    return { registrationOpen: true }
  }
}

export default function Register({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState<false | 'generic' | 'closed'>(false)
  const [pending, setPending] = useState(false)
  const next = safeNext(params.get('next'))

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(false)
    const form = new FormData(e.currentTarget)
    const { error: err } = await authClient.signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    if (err) {
      setPending(false)
      const closed =
        (err as { code?: string }).code === 'REGISTRATION_CLOSED' ||
        (err as { status?: number }).status === 403
      return setError(closed ? 'closed' : 'generic')
    }
    setPending(false)
    // handle 认领挪到 /verify——那里同时服务邮箱密码与 Google 两类注册用户
    navigate(
      next
        ? `${localizeHref('/verify')}?next=${encodeURIComponent(next)}`
        : localizeHref('/verify'),
    )
  }

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{m.auth_register()}</CardTitle>
        </CardHeader>
        <CardContent>
          {!loaderData.registrationOpen || error === 'closed' ? (
            <div className="grid gap-4">
              <Alert>
                <AlertDescription>
                  {m.auth_registration_closed()}
                </AlertDescription>
              </Alert>
              <Link
                to={
                  next
                    ? `${localizeHref('/login')}?next=${encodeURIComponent(next)}`
                    : localizeHref('/login')
                }
                viewTransition
                className="text-center text-sm underline underline-offset-4"
              >
                {m.auth_have_account()}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">{m.auth_name()}</Label>
                <Input id="name" name="name" required maxLength={32} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">{m.auth_email()}</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{m.auth_password()}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                />
              </div>
              {error === 'generic' && (
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
                viewTransition
                className="text-center text-sm text-muted-foreground hover:text-foreground"
              >
                {m.auth_have_account()}
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
