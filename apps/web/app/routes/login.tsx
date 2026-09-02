import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { authClient } from '~/lib/auth-client'
import { safeNext } from '~/lib/links'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

export function meta() {
  return [{ title: `${m.auth_login()} · ${m.site_name()}` }]
}

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  // ?next= 只接受站内相对路径——开放重定向就是 P0-4 的登录页版本
  const next = safeNext(params.get('next'))

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(false)
    const form = new FormData(e.currentTarget)
    const { error: err } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setPending(false)
    if (err) return setError(true)
    navigate(next ?? localizeHref('/'))
  }

  const registerHref = next
    ? `${localizeHref('/register')}?next=${encodeURIComponent(next)}`
    : localizeHref('/register')

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{m.auth_login()}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">{m.auth_email()}</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{m.auth_password()}</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            {error && (
              <p className="text-sm text-destructive">
                {m.auth_error_generic()}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {m.auth_login()}
            </Button>
            <Link
              to={registerHref}
              className="text-center text-sm text-muted-foreground hover:text-foreground"
            >
              {m.auth_no_account()}
            </Link>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
