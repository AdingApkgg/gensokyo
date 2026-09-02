import { afterAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { cleanupTracked, trackUser } from '@gensokyo/db/testing'
import { eq } from 'drizzle-orm'
import { app } from './app'
import {
  resetUploadWindow,
  UPLOAD_LIMIT,
  UPLOAD_LIMIT_IP,
} from './modules/uploads'
import { deleteObject } from './storage'

/** 最小的合法 PNG（1x1 透明像素） */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
])

async function signUp() {
  const email = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'hakurei-reimu-514',
      name: '上传者',
    }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  return {
    cookie: res.headers.get('set-cookie') ?? '',
    userId: trackUser(body.user?.id),
  }
}

/**
 * 上传的对象也要收走。测试打的是共享开发桶——不收的话每跑一次多几个
 * 对象，GC 的干跑统计里全是测试残留，看不出真实的悬空引用。
 */
const uploadedKeys: string[] = []
afterAll(async () => {
  // 对象清理失败不能连累账号清理——账号残留才是共享库上更贵的那种污染
  try {
    await Promise.allSettled(uploadedKeys.splice(0).map((k) => deleteObject(k)))
  } finally {
    await cleanupTracked()
  }
})

const form = (
  bytes: Uint8Array,
  type: string,
  name = 'cover.png',
  purpose = 'cover',
) => {
  const fd = new FormData()
  fd.append('file', new File([bytes as BlobPart], name, { type }))
  fd.append('purpose', purpose)
  return fd
}

async function upload(cookie: string, fd: FormData) {
  const res = await app.request('/api/uploads/image', {
    method: 'POST',
    headers: { cookie },
    body: fd,
  })
  if (res.ok) {
    const body = (await res.clone().json()) as { key?: string }
    if (body.key) uploadedKeys.push(body.key)
  }
  return res
}

describe('图片上传', () => {
  test('未登录被拒', async () => {
    const res = await app.request('/api/uploads/image', {
      method: 'POST',
      body: form(PNG, 'image/png'),
    })
    expect(res.status).toBe(401)
  })

  test('登录后能传 PNG，返回可访问的 URL', async () => {
    const { cookie } = await signUp()
    const res = await upload(cookie, form(PNG, 'image/png'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      url: string
      key: string
      size: number
    }
    expect(body.size).toBe(PNG.byteLength)
    expect(body.url).toMatch(/\/cover\/[0-9a-f-]{36}\.png$/)
    expect(body.key).toMatch(/^cover\/[0-9a-f-]{36}\.png$/)

    // 桶是匿名可读的，URL 应当真的能取到
    const fetched = await fetch(body.url)
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get('content-type')).toBe('image/png')
  })

  test('purpose=post 落到 post/ 前缀 —— T7 的帖子配图走这条', async () => {
    const { cookie } = await signUp()
    const res = await upload(cookie, form(PNG, 'image/png', 'shot.png', 'post'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { key: string }
    expect(body.key).toMatch(/^post\/[0-9a-f-]{36}\.png$/)
  })

  test('未知 purpose → 400，不再静默变成 cover', async () => {
    const { cookie } = await signUp()
    const res = await upload(cookie, form(PNG, 'image/png', 'x.png', 'banner'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: { code: 'validation_failed', fields: ['purpose'] },
    })
  })

  test('缺 purpose → 400', async () => {
    const { cookie } = await signUp()
    const fd = new FormData()
    fd.append(
      'file',
      new File([PNG as BlobPart], 'x.png', { type: 'image/png' }),
    )
    const res = await upload(cookie, fd)
    expect(res.status).toBe(400)
  })

  test('伪造 Content-Type 被文件头识破', async () => {
    const { cookie } = await signUp()
    const evil = new TextEncoder().encode('<?php system($_GET[0]); ?>')
    const res = await upload(cookie, form(evil, 'image/png', 'shell.png'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: { code: 'validation_failed', fields: ['file'] },
    })
  })

  test('不支持的类型被拒', async () => {
    const { cookie } = await signUp()
    const res = await upload(cookie, form(PNG, 'application/zip', 'game.zip'))
    expect(res.status).toBe(400)
  })

  test('超过 5MB 被拒', async () => {
    const { cookie } = await signUp()
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(PNG.subarray(0, 8))
    const res = await upload(cookie, form(big, 'image/png', 'huge.png'))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: { code: 'file_too_large' } })
  })
})

describe('上传限流（进程内）', () => {
  test(`窗口内第 ${UPLOAD_LIMIT.max + 1} 次 → 429 带 Retry-After；staff 不受限`, async () => {
    const { cookie, userId } = await signUp()
    resetUploadWindow(userId)
    for (let i = 0; i < UPLOAD_LIMIT.max; i++) {
      const res = await upload(cookie, form(PNG, 'image/png'))
      expect(res.status).toBe(200)
    }
    const over = await upload(cookie, form(PNG, 'image/png'))
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: { code: 'rate_limited' } })
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0)

    // 提成 moderator 后同一个人立刻能传——站长要能连传引导帖配图
    await db
      .update(schema.userProfile)
      .set({ role: 'moderator' })
      .where(eq(schema.userProfile.userId, userId))
    const asStaff = await upload(cookie, form(PNG, 'image/png'))
    expect(asStaff.status).toBe(200)
  })

  test('被拒的请求一律不占窗口 —— 参数错、文件头错、超限都不计', async () => {
    const { cookie, userId } = await signUp()
    resetUploadWindow(userId)
    const evil = new TextEncoder().encode('<?php system($_GET[0]); ?>')
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(PNG.subarray(0, 8))
    for (let i = 0; i < 5; i++) {
      await upload(cookie, form(PNG, 'image/png', 'x.png', 'banner')) // 400 purpose
      await upload(cookie, form(evil, 'image/png', 'shell.png')) // 400 文件头
      await upload(cookie, form(big, 'image/png', 'huge.png')) // 413
    }
    // 15 次被拒之后窗口应仍是空的：连传 max 次都得 200
    for (let i = 0; i < UPLOAD_LIMIT.max; i++) {
      const ok = await upload(cookie, form(PNG, 'image/png'))
      expect(ok.status).toBe(200)
    }
    const over = await upload(cookie, form(PNG, 'image/png'))
    expect(over.status).toBe(429)
  })

  test('超限的请求体在 parseBody 之前就按 content-length 拒掉', async () => {
    const { cookie } = await signUp()
    const res = await app.request('/api/uploads/image', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(6 * 1024 * 1024),
      },
      body: 'irrelevant',
    })
    expect(res.status).toBe(413)
  })

  test('带反代头时按 IP 也限；开发环境无反代头则只按账号', async () => {
    const { cookie, userId } = await signUp()
    resetUploadWindow()
    // 同一 IP、不同账号：用 header 伪造反代头把 IP 桶打满
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    // 直接操作限流器验证 IP 维度，别真传 100 张图
    const { checkUploadLimit, stampUpload } = await import('./modules/uploads')
    const fakeActor = (id: string) =>
      ({
        id,
        role: 'user',
        strikeCount: 0,
        approvedResourceCount: 0,
        createdAt: new Date(),
      }) as never
    for (let i = 0; i < UPLOAD_LIMIT_IP.max; i++)
      stampUpload(fakeActor(`ip-test-${i}`), ip)
    expect(checkUploadLimit(fakeActor('ip-test-new'), ip).ok).toBe(false)
    // 同一账号不带 IP 仍按账号判：窗口是空的
    expect(checkUploadLimit(fakeActor('ip-test-new'), null).ok).toBe(true)
    resetUploadWindow()
    void cookie
    void userId
  })
})
