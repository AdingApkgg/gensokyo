import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { authClient } from '~/lib/auth-client'
import { forgotStep } from '~/lib/forgot-step'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'

export function meta() {
  return [{ title: `${m.auth_forgot_title()} · ${m.site_name()}` }]
}

export default function Forgot() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ requested: false, reset: false })
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const step = forgotStep(state)

  async function onRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setFailed(false)
    const value = String(
      new FormData(e.currentTarget).get('email') ?? '',
    ).trim()
    // 不看返回值：后端对不存在的邮箱也回成功，这是刻意的枚举防护，
    // 前端跟着一视同仁才不会把它漏掉
    await authClient.emailOtp.requestPasswordReset({ email: value })
    setEmail(value)
    setState({ requested: true, reset: false })
    setPending(false)
  }

  async function onReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setFailed(false)
    const form = new FormData(e.currentTarget)
    const { error } = await authClient.emailOtp.resetPassword({
      email,
      otp: String(form.get('otp') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    })
    setPending(false)
    if (error) return setFailed(true)
    setState({ requested: true, reset: true })
  }

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{m.auth_forgot_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'email' && (
            <form onSubmit={onRequest} className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {m.auth_forgot_lead()}
              </p>
              <div className="grid gap-2">
                <Label htmlFor="email">{m.auth_email()}</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <Button type="submit" disabled={pending}>
                {m.auth_forgot_submit()}
              </Button>
            </form>
          )}

          {step === 'reset' && (
            <form onSubmit={onReset} className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {m.auth_forgot_sent()}
              </p>
              <div className="grid gap-2">
                <Label htmlFor="otp">{m.auth_verify_code()}</Label>
                <Input
                  id="otp"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{m.auth_forgot_new_password()}</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {failed && (
                <p role="alert" className="text-sm text-destructive">
                  {m.auth_forgot_failed()}
                </p>
              )}
              <Button type="submit" disabled={pending}>
                {m.auth_forgot_submit()}
              </Button>
            </form>
          )}

          {step === 'done' && (
            <div className="grid gap-4">
              <p className="text-sm">{m.auth_forgot_done()}</p>
              <Button
                type="button"
                onClick={() => navigate(localizeHref('/login'))}
              >
                {m.auth_login()}
              </Button>
            </div>
          )}

          <Link
            to={localizeHref('/login')}
            viewTransition
            className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {m.auth_have_account()}
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
