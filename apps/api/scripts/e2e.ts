/**
 * M3 端到端验收：走一遍香霖堂的完整闭环并逐环断言。
 *
 *   bun run e2e
 *
 * 这不是单元测试的替代品——它验证的是各部分**串起来**能不能用：
 * 注册 → 投稿 → 进队列 → 审核通过 → 列表可见 → 下载计数 → 评分 → 评论
 * → 举报 → 处理，外加两条安全底线（未发布不可下载、越权拿别人的 fileId 也不行）。
 */
import { db, schema } from '@gensokyo/db'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const stamp = Date.now()
const signUp = async (name: string) => {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `e2e-${stamp}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'hakurei-reimu-514',
      name,
    }),
  })
  const body = (await res.json()) as { user?: { id: string } }
  return {
    cookie: res.headers.get('set-cookie') ?? '',
    id: body.user?.id as string,
  }
}
type Session = Awaited<ReturnType<typeof signUp>>

const send = (s: Session | null, method: string, body?: unknown) => ({
  method,
  headers: {
    'content-type': 'application/json',
    ...(s ? { cookie: s.cookie } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

async function main() {
  // --- 账号 ---
  const author = await signUp('E2E 投稿者')
  const reader = await signUp('E2E 读者')
  const staff = await signUp('E2E 审核员')
  await app.request('/api/me', { headers: { cookie: staff.cookie } })
  await db
    .update(schema.userProfile)
    .set({ role: 'moderator' })
    .where(eq(schema.userProfile.userId, staff.id))
  check('注册三个账号并提权审核员', true)

  // --- 投稿 ---
  const created = await app.request(
    '/api/kourindou/resources',
    send(author, 'POST', {
      titleOriginal: '東方E2Eテスト',
      titleOriginalLocale: 'ja',
      title: { zh: '东方端到端测试' },
      kind: 'music',
      license: 'unspecified',
      licenseNote: '未与社团确认',
      tagIds: ['th06'],
    }),
  )
  const { resource } = (await created.json()) as {
    resource: { id: string; slug: string }
  }
  check('创建资源', created.status === 201)

  const ver = await app.request(
    `/api/kourindou/resources/${resource.id}/versions`,
    send(author, 'POST', {
      label: 'v1',
      files: [
        {
          label: '网盘',
          url: 'https://pan.example.com/s/e2e',
          mirrorKind: 'netdisk',
          extractCode: 'e2e1',
        },
      ],
    }),
  )
  const { files } = (await ver.json()) as { files: { id: string }[] }
  const fileId = files[0]?.id as string
  check('挂上版本与分发链接', ver.status === 201)

  // --- 安全底线：未发布不可下载 ---
  const earlyDl = await app.request(
    `/api/kourindou/resources/${resource.slug}/files/${fileId}/download`,
    { headers: { cookie: author.cookie }, redirect: 'manual' },
  )
  check('未发布资源下载不到（连作者本人也不行）', earlyDl.status === 404)

  // --- 投递 → 队列 ---
  const submitted = await app.request(
    `/api/kourindou/resources/${resource.id}/submit`,
    send(author, 'POST'),
  )
  const sb = (await submitted.json()) as { status: string }
  check(
    '新账号投稿进入审核队列',
    sb.status === 'pending',
    `status=${sb.status}`,
  )

  const queue = await app.request('/api/moderation/queue?pageSize=100', {
    headers: { cookie: staff.cookie },
  })
  const qb = (await queue.json()) as { items: { id: string }[] }
  check(
    '资源出现在审核队列里',
    qb.items.some((i) => i.id === resource.id),
  )

  const outsider = await app.request('/api/moderation/queue', {
    headers: { cookie: reader.cookie },
  })
  check('普通用户看不到队列', outsider.status === 403)

  /**
   * 审核通过只能走 /review。
   *
   * 从 /status 直接把 pending 改 published 会绕开信任梯度：不递增
   * approvedResourceCount、审计写成 status_change 而非 review。
   * 这一条断言的是那扇门关上了——而下面那条断言的是**正门还开着**，
   * 两条必须一起看：只关门不验正门的话，改错了会让审核通过全线 409。
   */
  const bypass = await app.request(
    `/api/kourindou/resources/${resource.id}/status`,
    send(staff, 'POST', { to: 'published' }),
  )
  check('staff 也不能从 /status 绕开审核', bypass.status === 409)

  // --- 审核通过 ---
  const review = await app.request(
    `/api/moderation/resources/${resource.id}/review`,
    send(staff, 'POST', { decision: 'approve', note: 'E2E' }),
  )
  check('审核通过', review.status === 200)

  const [profile] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, author.id))
  check(
    '投稿者的信任进度 +1',
    profile?.approvedResourceCount === 1,
    `count=${profile?.approvedResourceCount}`,
  )

  // --- 公开可见 ---
  const list = await app.request('/api/kourindou/resources?pageSize=100')
  const lb = (await list.json()) as { items: { id: string }[] }
  check(
    '发布后出现在公开列表',
    lb.items.some((i) => i.id === resource.id),
  )

  const anon = await app.request(`/api/kourindou/resources/${resource.slug}`)
  check('匿名可看详情', anon.status === 200)

  // --- 下载 ---
  const dl = await app.request(
    `/api/kourindou/resources/${resource.slug}/files/${fileId}/download`,
    { headers: { cookie: reader.cookie }, redirect: 'manual' },
  )
  const [afterDl] = await db
    .select({ n: schema.resource.downloadCount })
    .from(schema.resource)
    .where(eq(schema.resource.id, resource.id))
  check('下载 302 到外链', dl.status === 302)
  check('下载计数 +1', afterDl?.n === 1, `count=${afterDl?.n}`)

  const crossDl = await app.request(
    `/api/kourindou/resources/${resource.slug}/files/00000000-0000-4000-8000-000000000000/download`,
    { redirect: 'manual' },
  )
  check('用不属于该资源的 fileId 下载不到', crossDl.status === 404)

  // --- 互动 ---
  const rate = await app.request(
    `/api/kourindou/resources/${resource.slug}/rating`,
    send(reader, 'PUT', { score: 4 }),
  )
  const selfRate = await app.request(
    `/api/kourindou/resources/${resource.slug}/rating`,
    send(author, 'PUT', { score: 5 }),
  )
  check('读者可评分', rate.status === 200)
  check('作者不能给自己评分', selfRate.status === 403)

  // 楼层走神社：资源页只给 topicId，读写都在 /api/shrine
  const detail = await app.request(`/api/kourindou/resources/${resource.slug}`)
  const { topicId } = (await detail.json()) as { topicId: string | null }
  check('资源详情给出讨论主题 id', typeof topicId === 'string')

  const post = await app.request(
    `/api/shrine/topics/${topicId}/posts`,
    send(reader, 'POST', { bodyMd: 'E2E 评论' }),
  )
  const pb = (await post.json()) as { floor: number }
  check('发表评论并拿到楼层号', post.status === 201 && pb.floor === 1)

  // 同一条楼层从神社读得到，且投影一致（同一份数据两个视图）
  const viaShrine = await app.request(`/api/shrine/topics/${topicId}/posts`)
  const shrineBody = (await viaShrine.json()) as {
    posts: { floor: number; bodyMd: string }[]
    total: number
  }
  check(
    '资源评论与论坛帖走同一段 service',
    viaShrine.status === 200 &&
      shrineBody.posts.some((p) => p.floor === 1 && p.bodyMd === 'E2E 评论') &&
      shrineBody.total === 1,
  )

  // --- 举报闭环 ---
  const report = await app.request(
    '/api/kourindou/reports',
    send(reader, 'POST', {
      targetKind: 'resource',
      targetId: resource.id,
      reason: 'copyright',
      detail: 'E2E 版权举报',
    }),
  )
  const rb = (await report.json()) as { id: string }
  check('提交举报', report.status === 201)

  const resolve = await app.request(
    `/api/moderation/reports/${rb.id}/resolve`,
    send(staff, 'POST', { status: 'resolved', note: 'E2E 已处理' }),
  )
  check('审核员处理举报', resolve.status === 200)

  // --- 自助下架 ---
  const takedown = await app.request(
    `/api/kourindou/resources/${resource.id}/status`,
    send(author, 'POST', { to: 'delisted', reason: 'E2E 自助下架' }),
  )
  check('作者可自助下架', takedown.status === 200)

  const afterDown = await app.request('/api/kourindou/resources?pageSize=100')
  const adb = (await afterDown.json()) as { items: { id: string }[] }
  check('下架后从公开列表消失', !adb.items.some((i) => i.id === resource.id))

  const republish = await app.request(
    `/api/kourindou/resources/${resource.id}/status`,
    send(author, 'POST', { to: 'published' }),
  )
  check('作者不能自己重新上架', republish.status === 409)

  // --- 审计留痕 ---
  const logs = await db
    .select()
    .from(schema.moderationLog)
    .where(eq(schema.moderationLog.subjectId, resource.id))
  check(
    '状态流转与审核都留了痕',
    logs.some((l) => l.action === 'review') &&
      logs.some((l) => l.action === 'status_change'),
    `${logs.length} 条`,
  )

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

await main()
