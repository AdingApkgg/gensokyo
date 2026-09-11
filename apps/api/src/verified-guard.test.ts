import { afterAll, describe, expect, test } from 'bun:test'
import { app } from './app'
import { cleanupTracked, trackUser } from './testing'

const password = 'hakurei-reimu-514'
let cookie = ''

afterAll(cleanupTracked)

async function unverifiedSession() {
  if (cookie) return cookie
  const email = `guard-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: '未验证的人' }),
  })
  trackUser(((await res.json()) as { user?: { id: string } }).user?.id)
  cookie = res.headers.get('set-cookie') ?? ''
  return cookie
}

/** 代表性写端点：每个模块至少一条，覆盖五种 HTTP 方法 */
const WRITE_ENDPOINTS: Array<[string, string, unknown]> = [
  [
    'POST',
    '/api/shrine/topics',
    { board: 'chat', title: '标题', body: '正文' },
  ],
  ['DELETE', '/api/shrine/topics/00000000-0000-4000-8000-000000000000', null],
  [
    'POST',
    '/api/kourindou/resources',
    { titleOriginal: 'x', titleOriginalLocale: 'ja' },
  ],
  [
    'PATCH',
    '/api/kourindou/resources/00000000-0000-4000-8000-000000000000',
    {},
  ],
  ['PUT', '/api/kourindou/resources/some-slug/favorite', null],
  [
    'POST',
    '/api/reports',
    { subjectKind: 'post', subjectId: 'x', reason: 'spam' },
  ],
  ['POST', '/api/uploads/image', null],
]

describe('未验证账号不能写', () => {
  for (const [method, path, body] of WRITE_ENDPOINTS) {
    test(`${method} ${path} → 403 email_unverified`, async () => {
      const res = await app.request(path, {
        method,
        headers: {
          cookie: await unverifiedSession(),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      expect(res.status).toBe(403)
      const json = (await res.json()) as { error?: { code?: string } }
      expect(json.error?.code).toBe('email_unverified')
    })
  }
})

describe('未验证账号仍能做账号内务', () => {
  test('GET /api/me → 200', async () => {
    const res = await app.request('/api/me', {
      headers: { cookie: await unverifiedSession() },
    })
    expect(res.status).toBe(200)
  })

  test('GET /api/notifications → 200', async () => {
    const res = await app.request('/api/notifications', {
      headers: { cookie: await unverifiedSession() },
    })
    expect(res.status).toBe(200)
  })

  test('POST /api/notifications/read → 不是 403', async () => {
    const res = await app.request('/api/notifications/read', {
      method: 'POST',
      headers: {
        cookie: await unverifiedSession(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ all: true }),
    })
    expect(res.status).not.toBe(403)
  })

  test('PUT /api/me/handle → 不是 403（认领 handle 不要求验证）', async () => {
    const res = await app.request('/api/me/handle', {
      method: 'PUT',
      headers: {
        cookie: await unverifiedSession(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ handle: `g${Date.now()}`.slice(0, 20) }),
    })
    expect(res.status).not.toBe(403)
  })
})

describe('未登录仍然是 401 而不是 403', () => {
  test('顺序不能反：401 要先于 403', async () => {
    // requireVerified 里 actor 为 null 先返回 401，否则未登录用户会看到
    // 「邮箱未验证」这种毫无意义的提示
    const res = await app.request('/api/shrine/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: 'chat', title: 't', body: 'b' }),
    })
    expect(res.status).toBe(401)
  })
})
