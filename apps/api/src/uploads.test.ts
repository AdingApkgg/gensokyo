import { afterAll, describe, expect, test } from 'bun:test'
import { app } from './app'
import { cleanupTracked, trackUser } from './test-support'

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
  trackUser(body.user?.id)
  return res.headers.get('set-cookie') ?? ''
}

afterAll(cleanupTracked)

const form = (bytes: Uint8Array, type: string, name = 'cover.png') => {
  const fd = new FormData()
  fd.append('file', new File([bytes as BlobPart], name, { type }))
  fd.append('purpose', 'cover')
  return fd
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
    const cookie = await signUp()
    const res = await app.request('/api/uploads/image', {
      method: 'POST',
      headers: { cookie },
      body: form(PNG, 'image/png'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string; size: number }
    expect(body.size).toBe(PNG.byteLength)
    expect(body.url).toMatch(/\/cover\/[0-9a-f-]+\.png$/)

    // 桶是匿名可读的，URL 应当真的能取到
    const fetched = await fetch(body.url)
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get('content-type')).toBe('image/png')
  })

  test('伪造 Content-Type 被文件头识破', async () => {
    const cookie = await signUp()
    const evil = new TextEncoder().encode('<?php system($_GET[0]); ?>')
    const res = await app.request('/api/uploads/image', {
      method: 'POST',
      headers: { cookie },
      body: form(evil, 'image/png', 'shell.png'),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: { code: 'validation_failed', fields: ['file'] },
    })
  })

  test('不支持的类型被拒', async () => {
    const cookie = await signUp()
    const res = await app.request('/api/uploads/image', {
      method: 'POST',
      headers: { cookie },
      body: form(PNG, 'application/zip', 'game.zip'),
    })
    expect(res.status).toBe(400)
  })

  test('超过 5MB 被拒', async () => {
    const cookie = await signUp()
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(PNG.subarray(0, 8))
    const res = await app.request('/api/uploads/image', {
      method: 'POST',
      headers: { cookie },
      body: form(big, 'image/png', 'huge.png'),
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: { code: 'file_too_large' } })
  })
})
