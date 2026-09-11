import { HANDLE_RE } from '@gensokyo/shared'
import { useEffect, useState } from 'react'
import { redirect, useNavigate, useSearchParams } from 'react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { apiFor, browserApi } from '~/lib/api'
import { authClient } from '~/lib/auth-client'
import { safeNext } from '~/lib/links'
import { verifyStep } from '~/lib/verify-step'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/verify'

export function meta() {
  return [{ title: `${m.auth_verify_title()} · ${m.site_name()}` }]
}

/**
 * 注册后的补全页。它同时服务两类人——邮箱密码注册的走「验证码 → 认领 handle」
 * 两段，Google 注册的邮箱天生已验证、只剩认领那一段。
 *
 * 写操作被 403 挡住时，前端也把人引到这里。
 */
export async function loader({ request }: Route.LoaderArgs) {
  // SSR 取会话要手动转发 cookie
  const res = await apiFor(request).api.me.$get()
  const body = (await res.json()) as {
    user: {
      email: string
      emailVerified: boolean
      handleSetAt: string | null
    } | null
  }
  const step = verifyStep(body.user)
  if (step === 'anonymous') throw redirect(localizeHref('/login'))
  return { step, email: body.user?.email ?? '' }
}

export default function Verify({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next')) ?? localizeHref('/')
  const [step, setStep] = useState(loaderData.step)
  const [error, setError] = useState<
    'code' | 'handle-taken' | 'handle-bad' | null
  >(null)
  const [pending, setPending] = useState(false)

  // 两段都完成就别停在这一页
  useEffect(() => {
    if (step === 'done') navigate(next)
  }, [step, next, navigate])

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const otp = String(new FormData(e.currentTarget).get('otp') ?? '').trim()
    const { error: err } = await authClient.emailOtp.verifyEmail({
      email: loaderData.email,
      otp,
    })
    setPending(false)
    if (err) return setError('code')
    // 验证完接着认领 handle；已认领过的会被下一次 loader 判成 done
    setStep('handle')
  }

  async function onResend() {
    setPending(true)
    setError(null)
    await authClient.emailOtp.sendVerificationOtp({
      email: loaderData.email,
      type: 'email-verification',
    })
    setPending(false)
  }

  async function onClaim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const handle = String(new FormData(e.currentTarget).get('handle') ?? '')
      .trim()
      .toLowerCase()
    if (!handle) {
      setPending(false)
      return navigate(next)
    }
    if (!HANDLE_RE.test(handle)) {
      setPending(false)
      return setError('handle-bad')
    }
    const res = await browserApi().api.me.handle.$put({ json: { handle } })
    setPending(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string }
      } | null
      return setError(
        body?.error?.code === 'duplicate_slug' ? 'handle-taken' : 'handle-bad',
      )
    }
    navigate(next)
  }

  return (
    <main className="grid min-h-[70vh] place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            {step === 'handle' ? m.auth_claim_title() : m.auth_verify_title()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'otp' && (
            <form onSubmit={onVerify} className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {m.auth_verify_sent()}
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
                  aria-invalid={error === 'code' ? true : undefined}
                />
              </div>
              {error === 'code' && (
                <p role="alert" className="text-sm text-destructive">
                  {m.auth_verify_bad_code()}
                </p>
              )}
              <Button type="submit" disabled={pending}>
                {m.auth_verify_submit()}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onResend}
                disabled={pending}
              >
                {m.auth_verify_resend()}
              </Button>
            </form>
          )}

          {step === 'handle' && (
            <form onSubmit={onClaim} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="handle">{m.auth_handle()}</Label>
                <Input
                  id="handle"
                  name="handle"
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={error?.startsWith('handle') ? true : undefined}
                  aria-describedby="handle-hint"
                />
                <p id="handle-hint" className="text-xs text-muted-foreground">
                  {m.auth_handle_hint()}
                </p>
                {error === 'handle-taken' && (
                  <p role="alert" className="text-sm text-destructive">
                    {m.auth_handle_taken()}
                  </p>
                )}
                {error === 'handle-bad' && (
                  <p role="alert" className="text-sm text-destructive">
                    {m.auth_handle_invalid()}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={pending}>
                {m.auth_verify_submit()}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate(next)}
                disabled={pending}
              >
                {m.auth_handle_skip()}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
