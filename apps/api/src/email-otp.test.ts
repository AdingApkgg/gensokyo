import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'
import { app } from './app'
import { cleanupTracked, trackUser } from './testing'

const password = 'hakurei-reimu-514'

afterAll(cleanupTracked)

describe('注册后的邮箱验证码', () => {
  test('注册即发码；码是 6 位数字；库里存的不是明文', async () => {
    const logs: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })

    const email = `otp-${Date.now()}@example.com`
    try {
      const signUp = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: '博丽灵梦' }),
      })
      expect(signUp.status).toBe(200)
      trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    } finally {
      spy.mockRestore()
    }

    const mail = logs.find(
      (l) => l.includes('[mail:console]') && l.includes(email),
    )
    expect(mail).toBeDefined()
    const otp = mail?.match(/\b(\d{6})\b/)?.[1]
    expect(otp).toBeDefined()

    // ⚠️ storeOTP 默认是 'plain'——这条钉的就是它必须是 'hashed'
    const [row] = await db
      .select()
      .from(schema.verification)
      .where(
        eq(schema.verification.identifier, `email-verification-otp-${email}`),
      )
      .limit(1)
    expect(row).toBeDefined()
    expect(row?.value).not.toContain(otp as string)
  })

  test('未验证的账号能登录、能读 /me，且 /me 说它没验证', async () => {
    const email = `otp-login-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: '雾雨魔理沙' }),
    })
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    // 不开 requireEmailVerification：未验证也必须能登录
    expect(signIn.status).toBe(200)

    const cookie = signIn.headers.get('set-cookie') ?? ''
    const me = await app.request('/api/me', { headers: { cookie } })
    const body = (await me.json()) as {
      user: { emailVerified: boolean } | null
    }
    expect(body.user?.emailVerified).toBe(false)
  })

  test('输对验证码后 emailVerified 变成 true', async () => {
    const logs: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '))
    })
    const email = `otp-ok-${Date.now()}@example.com`
    let cookie = ''
    try {
      const signUp = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: '十六夜咲夜' }),
      })
      cookie = signUp.headers.get('set-cookie') ?? ''
      trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)
    } finally {
      spy.mockRestore()
    }
    const otp = logs
      .find((l) => l.includes(email))
      ?.match(/\b(\d{6})\b/)?.[1] as string

    const verify = await app.request('/api/auth/email-otp/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email, otp }),
    })
    expect(verify.status).toBe(200)

    const me = await app.request('/api/me', { headers: { cookie } })
    const body = (await me.json()) as {
      user: { emailVerified: boolean } | null
    }
    expect(body.user?.emailVerified).toBe(true)
  })

  test('输错验证码不改变 emailVerified', async () => {
    const email = `otp-bad-${Date.now()}@example.com`
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: '魂魄妖梦' }),
    })
    const cookie = signUp.headers.get('set-cookie') ?? ''
    trackUser(((await signUp.json()) as { user?: { id: string } }).user?.id)

    const verify = await app.request('/api/auth/email-otp/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email, otp: '000000' }),
    })
    expect(verify.status).toBeGreaterThanOrEqual(400)

    const me = await app.request('/api/me', { headers: { cookie } })
    const body = (await me.json()) as {
      user: { emailVerified: boolean } | null
    }
    expect(body.user?.emailVerified).toBe(false)
  })
})
