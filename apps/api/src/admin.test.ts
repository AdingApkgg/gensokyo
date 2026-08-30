import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db, schema } from '@gensokyo/db'
import { eq, inArray } from 'drizzle-orm'
import { app } from './app'
import { invalidateConfig } from './site-config'

type Session = { cookie: string; id: string }

/**
 * 这个文件会造 admin 账号，跑完必须收走。
 * 测试打的是共享的开发库，不清理的话每跑一次就多两个站长，
 * 几十次之后 /dash/users 里全是它们，真人反而找不着。
 */
const created: string[] = []

async function signUp(name: string): Promise<Session> {
  const email = `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hakurei-reimu-514', name }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  const id = body.user?.id as string
  if (id) created.push(id)
  return { cookie: res.headers.get('set-cookie') ?? '', id }
}

afterAll(async () => {
  if (created.length === 0) return
  // user_profile 跟着级联删；moderation_log.actor_id 是 set null，
  // 所以审计记录本身活下来——这正是那条外键要的行为。
  await db.delete(schema.user).where(inArray(schema.user.id, created))
})

const send = (s: Session, method: string, body?: unknown) => ({
  method,
  headers: { cookie: s.cookie, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

async function setRole(s: Session, role: 'moderator' | 'admin') {
  await app.request('/api/me', { headers: { cookie: s.cookie } })
  await db
    .update(schema.userProfile)
    .set({ role })
    .where(eq(schema.userProfile.userId, s.id))
}

async function makeResource(owner: Session) {
  const res = await app.request(
    '/api/kourindou/resources',
    send(owner, 'POST', {
      titleOriginal: '東方管理テスト',
      titleOriginalLocale: 'ja',
      kind: 'tool',
      license: 'unspecified',
    }),
  )
  const { resource } = (await res.json()) as {
    resource: { id: string; slug: string }
  }
  return resource
}

let boss: Session
let mod: Session
let plain: Session

beforeAll(async () => {
  boss = await signUp('站长')
  mod = await signUp('审核员')
  plain = await signUp('普通用户')
  await setRole(boss, 'admin')
  await setRole(mod, 'moderator')
})

describe('权限分界：admin 独占', () => {
  test('普通用户访问 admin 路由 → 403', async () => {
    const res = await app.request('/api/admin/users', {
      headers: { cookie: plain.cookie },
    })
    expect(res.status).toBe(403)
  })

  test('审核员也进不去——这正是这条线的意义', async () => {
    const res = await app.request('/api/admin/users', {
      headers: { cookie: mod.cookie },
    })
    expect(res.status).toBe(403)
  })

  test('站长可以进', async () => {
    const res = await app.request('/api/admin/users', {
      headers: { cookie: boss.cookie },
    })
    expect(res.status).toBe(200)
  })
})

describe('找人', () => {
  test('不带 q 只列现任 staff，不吐全站邮箱', async () => {
    const res = await app.request('/api/admin/users', {
      headers: { cookie: boss.cookie },
    })
    const { items } = (await res.json()) as { items: { role: string }[] }
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((u) => u.role !== 'user')).toBe(true)
  })

  test('按邮箱能搜到还是普通用户的人——否则根本没法提权', async () => {
    const target = await signUp('待搜索')
    await app.request('/api/me', { headers: { cookie: target.cookie } })
    const [u] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, target.id))

    const res = await app.request(
      `/api/admin/users?q=${encodeURIComponent(u?.email ?? '')}`,
      { headers: { cookie: boss.cookie } },
    )
    const { items } = (await res.json()) as { items: { id: string }[] }
    expect(items.some((x) => x.id === target.id)).toBe(true)
  })

  test('按昵称模糊搜', async () => {
    const res = await app.request(
      '/api/admin/users?q=%E5%BE%85%E6%90%9C%E7%B4%A2',
      {
        headers: { cookie: boss.cookie },
      },
    )
    const { items } = (await res.json()) as { items: { name: string }[] }
    expect(items.some((x) => x.name === '待搜索')).toBe(true)
  })
})

describe('提权', () => {
  test('站长可以把人提成 moderator（用户 id 不是 uuid，别用 entityIdParam 卡它）', async () => {
    const target = await signUp('待提权')
    await app.request('/api/me', { headers: { cookie: target.cookie } })

    const res = await app.request(
      `/api/admin/users/${target.id}/role`,
      send(boss, 'PATCH', { role: 'moderator', reason: '协助审核' }),
    )
    expect(res.status).toBe(200)

    const [p] = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, target.id))
    expect(p?.role).toBe('moderator')

    // 提权动作要留痕
    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, target.id))
    expect(logs.some((l) => l.action === 'role_change')).toBe(true)
  })

  test('站长可以收回权限', async () => {
    const target = await signUp('待降权')
    await setRole(target, 'moderator')
    const res = await app.request(
      `/api/admin/users/${target.id}/role`,
      send(boss, 'PATCH', { role: 'user', reason: '不再协助' }),
    )
    expect(res.status).toBe(200)
  })

  test('HTTP 上动不了另一个 admin', async () => {
    const other = await signUp('另一位站长')
    await setRole(other, 'admin')
    const res = await app.request(
      `/api/admin/users/${other.id}/role`,
      send(boss, 'PATCH', { role: 'user', reason: '内讧' }),
    )
    expect(res.status).toBe(403)
  })

  test('HTTP 无法授予 admin——schema 层就没有这个选项', async () => {
    const target = await signUp('想当站长的')
    const res = await app.request(
      `/api/admin/users/${target.id}/role`,
      send(boss, 'PATCH', { role: 'admin', reason: '试图提权' }),
    )
    expect(res.status).toBe(400)
  })

  test('站长不能降权自己——否则可能把所有人锁在门外', async () => {
    const res = await app.request(
      `/api/admin/users/${boss.id}/role`,
      send(boss, 'PATCH', { role: 'user', reason: '自毁' }),
    )
    expect(res.status).toBe(403)
  })
})

describe('删除', () => {
  test('软删后从列表消失，可恢复', async () => {
    const r = await makeResource(plain)
    const del = await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'soft', reason: '暂时下线' }),
    )
    expect(del.status).toBe(200)

    const gone = await app.request(`/api/kourindou/resources/${r.slug}`, {
      headers: { cookie: plain.cookie },
    })
    expect(gone.status).toBe(404)

    const restore = await app.request(
      `/api/admin/resources/${r.id}/restore`,
      send(boss, 'POST'),
    )
    expect(restore.status).toBe(200)

    const back = await app.request(`/api/kourindou/resources/${r.slug}`, {
      headers: { cookie: plain.cookie },
    })
    expect(back.status).toBe(200)
  })

  test('软删记 soft_delete，不跟例行上下架混在一起', async () => {
    const r = await makeResource(plain)
    await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'soft', reason: '收到下架请求' }),
    )

    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, r.id))
    const entry = logs.find((l) => l.action === 'soft_delete')
    expect(entry?.reason).toBe('收到下架请求')
    // 查「站长撤下过什么」时不该翻出普通的状态流转
    expect(logs.some((l) => l.action === 'status_change')).toBe(false)
  })

  test('硬删移除行，但审计记录活下来', async () => {
    const r = await makeResource(plain)
    const del = await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'purge', reason: '权利人要求彻底删除' }),
    )
    expect(del.status).toBe(200)

    const rows = await db
      .select()
      .from(schema.resource)
      .where(eq(schema.resource.id, r.id))
    expect(rows).toHaveLength(0)

    // subjectId 是 text 不是外键，正是为了让记录在对象消失后仍然存在
    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectId, r.id))
    const purge = logs.find((l) => l.action === 'hard_delete')
    expect(purge?.reason).toBe('权利人要求彻底删除')
    expect(purge?.actorId).toBe(boss.id)
  })

  test('硬删必须给理由', async () => {
    const r = await makeResource(plain)
    const res = await app.request(
      `/api/admin/resources/${r.id}`,
      send(boss, 'DELETE', { mode: 'purge' }),
    )
    expect(res.status).toBe(400)
  })

  test('审核员删不了', async () => {
    const r = await makeResource(plain)
    const res = await app.request(
      `/api/admin/resources/${r.id}`,
      send(mod, 'DELETE', { mode: 'purge', reason: '越权尝试' }),
    )
    expect(res.status).toBe(403)
  })
})

describe('站点配置', () => {
  test('站长可读写，改动会留痕', async () => {
    const res = await app.request(
      '/api/admin/config',
      send(boss, 'PATCH', {
        takedownEmail: 'dmca@example.com',
        registrationOpen: true,
      }),
    )
    expect(res.status).toBe(200)

    const read = await app.request('/api/admin/config', {
      headers: { cookie: boss.cookie },
    })
    const body = (await read.json()) as { config: Record<string, unknown> }
    expect(body.config.takedownEmail).toBe('dmca@example.com')

    const logs = await db
      .select()
      .from(schema.moderationLog)
      .where(eq(schema.moderationLog.subjectKind, 'site'))
    expect(logs.length).toBeGreaterThan(0)
  })

  test('未知键被拒——配置表不是任意写入口', async () => {
    const res = await app.request(
      '/api/admin/config',
      send(boss, 'PATCH', { evilKey: 'pwn' }),
    )
    expect(res.status).toBe(400)
  })

  test('公开配置只暴露白名单键，且无需登录', async () => {
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { config: Record<string, unknown> }
    expect(body.config.takedownEmail).toBe('dmca@example.com')
    expect('autoPublishThreshold' in body.config).toBe(false)
  })

  test('改门槛真的影响即发即审，不是摆设', async () => {
    const author = await signUp('门槛测试')
    await app.request('/api/me', { headers: { cookie: author.cookie } })
    await db
      .update(schema.userProfile)
      .set({ approvedResourceCount: 1 })
      .where(eq(schema.userProfile.userId, author.id))

    // 默认门槛 3，通过 1 个 → 进队列
    await app.request(
      '/api/admin/config',
      send(boss, 'PATCH', { autoPublishThreshold: 3 }),
    )
    invalidateConfig()
    const a = await makeResource(author)
    const r1 = await app.request(
      `/api/kourindou/resources/${a.id}/submit`,
      send(author, 'POST'),
    )
    expect(((await r1.json()) as { status: string }).status).toBe('pending')

    // 门槛降到 1 → 同一个账号直接发布
    await app.request(
      '/api/admin/config',
      send(boss, 'PATCH', { autoPublishThreshold: 1 }),
    )
    invalidateConfig()
    const b = await makeResource(author)
    const r2 = await app.request(
      `/api/kourindou/resources/${b.id}/submit`,
      send(author, 'POST'),
    )
    expect(((await r2.json()) as { status: string }).status).toBe('published')

    // 复原，免得影响其他测试
    await app.request(
      '/api/admin/config',
      send(boss, 'PATCH', { autoPublishThreshold: 3 }),
    )
    invalidateConfig()
  })
})
