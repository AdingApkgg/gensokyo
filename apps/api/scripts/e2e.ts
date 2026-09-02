/**
 * M3 端到端验收：走一遍香霖堂的完整闭环并逐环断言。
 *
 *   bun run e2e
 *
 * 这不是单元测试的替代品——它验证的是各部分**串起来**能不能用：
 * 注册 → 投稿 → 进队列 → 审核通过 → 列表可见 → 下载计数 → 评分 → 评论
 * → 举报 → 处理，外加两条安全底线（未发布不可下载、越权拿别人的 fileId 也不行）。
 *
 * M4 博丽神社追加九项：楼层连续与并发不撞号、下架后的两道闸门（P0-5 / P0-1）、
 * purge 后通知仍在（P0-11）、@ 提及与上限、限流、帖子举报闭环（P0-7）、版主不能改他人正文。
 *
 * 结束时会清掉本次造的账号与内容；`E2E_KEEP=1` 可保留以便排查。
 */
import { db, schema } from '@gensokyo/db'
import { eq, inArray } from 'drizzle-orm'
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

  const handleOf = async (s: Session) => {
    const me = await app.request('/api/me', { headers: { cookie: s.cookie } })
    return ((await me.json()) as { user: { handle: string } }).user.handle
  }
  const readerHandle = await handleOf(reader)
  const prof0 = await app.request(`/api/shrine/users/${readerHandle}`)
  const pf0 = (await prof0.json()) as { posts: { topic: { id: string } }[] }
  check(
    '评论出现在参与者的 /u/:handle',
    prof0.status === 200 && pf0.posts.some((p) => p.topic.id === topicId),
  )

  // --- 举报闭环 ---
  const report = await app.request(
    '/api/reports',
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

  // --- 下架后的两道闸门（P0-5 / P0-1）---
  const hiddenTopic = await app.request(`/api/shrine/topics/${topicId}`)
  const hiddenPosts = await app.request(`/api/shrine/topics/${topicId}/posts`)
  check(
    '资源下架后讨论区从神社读路径消失（P0-5）',
    hiddenTopic.status === 404 && hiddenPosts.status === 404,
  )
  const prof1 = await app.request(`/api/shrine/users/${readerHandle}`)
  const pf1 = (await prof1.json()) as { posts: { topic: { id: string } }[] }
  check(
    '资源下架后参与者主页不再列出那些楼层（P0-1）',
    prof1.status === 200 && !pf1.posts.some((p) => p.topic.id === topicId),
  )

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

  // ================= 博丽神社 =================
  // --- 发主题 → 并发回帖：楼层连续不撞号 ---
  const title = `E2E 主题 ${stamp}`
  const topicRes = await app.request(
    '/api/shrine/topics',
    send(staff, 'POST', { boardSlug: 'meta', title, bodyMd: '主楼' }),
  )
  const tb = (await topicRes.json()) as { id: string }
  check('发版块主题', topicRes.status === 201)

  const posters = await Promise.all(
    [1, 2, 3, 4].map((i) => signUp(`E2E 并发 ${i}`)),
  )
  const concurrent = await Promise.all(
    posters.map((p, i) =>
      app.request(
        `/api/shrine/topics/${tb.id}/posts`,
        send(p, 'POST', { bodyMd: `并发回帖 ${i + 1}` }),
      ),
    ),
  )
  const floors = await Promise.all(
    concurrent.map(
      async (r) => (await r.json()) as { id: string; floor: number },
    ),
  )
  const floorNums = floors.map((f) => f.floor).sort((a, b) => a - b)
  check(
    '四人并发回帖全部成功，楼层号连续不重复',
    concurrent.every((r) => r.status === 201) &&
      floorNums.join(',') === '2,3,4,5',
    `floors=${floorNums.join(',')}`,
  )

  // --- @ 提及产生通知；提及超过 10 人被拒 ---
  const authorHandle = await handleOf(author)
  const mentioner = await signUp('E2E 提及者')
  const mention = await app.request(
    `/api/shrine/topics/${tb.id}/posts`,
    send(mentioner, 'POST', { bodyMd: `@${authorHandle} 你好` }),
  )
  const inbox = await app.request('/api/notifications', {
    headers: { cookie: author.cookie },
  })
  const ib = (await inbox.json()) as {
    items: { kind: string; topicId: string | null }[]
  }
  check(
    '@ 提及产生通知',
    mention.status === 201 &&
      ib.items.some((n) => n.kind === 'mention' && n.topicId === tb.id),
  )
  const spammer = await signUp('E2E 提及过多')
  const tooMany = await app.request(
    `/api/shrine/topics/${tb.id}/posts`,
    send(spammer, 'POST', {
      bodyMd: Array.from({ length: 11 }, (_, i) => `@e2euser${i}`).join(' '),
    }),
  )
  const tmb = (await tooMany.json()) as { error?: { code: string } }
  check(
    '提及超过 10 人被拒',
    tooMany.status === 400 && tmb.error?.code === 'mention_limit_exceeded',
    `status=${tooMany.status} code=${tmb.error?.code}`,
  )

  // --- 限流：冷却窗 + 新账号外链（小时配额在单测里）---
  const again = await app.request(
    `/api/shrine/topics/${tb.id}/posts`,
    send(mentioner, 'POST', { bodyMd: '冷却窗内第二帖' }),
  )
  check(
    '15 秒冷却窗内再发 → 429 带 Retry-After',
    again.status === 429 && !!again.headers.get('retry-after'),
    `status=${again.status}`,
  )
  const linker = await signUp('E2E 外链')
  const link = await app.request(
    `/api/shrine/topics/${tb.id}/posts`,
    send(linker, 'POST', { bodyMd: '看这个 https://example.org/x' }),
  )
  const lkb = (await link.json()) as { error?: { code: string } }
  check(
    '新账号发站外链接被拒',
    lkb.error?.code === 'link_not_allowed',
    `status=${link.status} code=${lkb.error?.code}`,
  )

  // --- 帖子举报闭环：队列里带标题+楼层 → 删楼 → 结案，全程不复制 uuid（P0-7）---
  const target = floors[0] as { id: string; floor: number }
  const victim = posters[0] as Session
  const reporter = posters[1] as Session
  const postReport = await app.request(
    '/api/reports',
    send(reporter, 'POST', {
      targetKind: 'post',
      targetId: target.id,
      reason: 'spam',
      detail: 'E2E 楼层举报',
    }),
  )
  const prb = (await postReport.json()) as { id: string }
  const queueRes = await app.request('/api/moderation/reports?pageSize=100', {
    headers: { cookie: staff.cookie },
  })
  const qrb = (await queueRes.json()) as {
    items: {
      id: string
      postFloor: number | null
      postTopicId: string | null
      topicTitle: string | null
    }[]
  }
  const row = qrb.items.find((r) => r.id === prb.id)
  check(
    '帖子举报在队列里带楼层号与主题标题',
    postReport.status === 201 &&
      row?.postFloor === target.floor &&
      row?.postTopicId === tb.id &&
      row?.topicTitle === title,
  )
  const del = await app.request(
    `/api/shrine/posts/${target.id}`,
    send(staff, 'DELETE', { reason: 'spam' }),
  )
  const resolved = await app.request(
    `/api/moderation/reports/${prb.id}/resolve`,
    send(staff, 'POST', { status: 'resolved' }),
  )
  const afterDel = await app.request(`/api/shrine/topics/${tb.id}/posts`)
  const adp = (await afterDel.json()) as {
    posts: { floor: number; deleted: boolean }[]
  }
  check(
    '版主删楼并结案，楼层变成占位',
    del.status === 200 &&
      resolved.status === 200 &&
      adp.posts.some((p) => p.floor === target.floor && p.deleted),
  )
  const victimInbox = await app.request('/api/notifications', {
    headers: { cookie: victim.cookie },
  })
  const vib = (await victimInbox.json()) as {
    items: { kind: string; payload: { reason?: string } | null }[]
  }
  check(
    '被删楼的作者收到带理由的通知',
    vib.items.some(
      (n) => n.kind === 'post_deleted' && n.payload?.reason === 'spam',
    ),
  )

  // --- 版主不能编辑他人正文 ---
  const edit = await app.request(
    `/api/shrine/posts/${(floors[2] as { id: string }).id}`,
    send(staff, 'PATCH', { bodyMd: '版主改的' }),
  )
  check('版主编辑他人楼层 → 403', edit.status === 403)

  // --- purge → 作者收到 resource_deleted，且通知在 purge 之后仍在（P0-11）---
  const admin = await signUp('E2E 站长')
  await app.request('/api/me', { headers: { cookie: admin.cookie } })
  await db
    .update(schema.userProfile)
    .set({ role: 'admin' })
    .where(eq(schema.userProfile.userId, admin.id))
  const purge = await app.request(
    `/api/admin/resources/${resource.id}`,
    send(admin, 'DELETE', { mode: 'purge', reason: 'E2E 清理' }),
  )
  const [gone] = await db
    .select({ id: schema.resource.id })
    .from(schema.resource)
    .where(eq(schema.resource.id, resource.id))
  const authorInbox = await app.request('/api/notifications', {
    headers: { cookie: author.cookie },
  })
  const aib = (await authorInbox.json()) as {
    items: { kind: string; payload: { title?: string } | null }[]
  }
  check(
    '站长 purge 后作者收到 resource_deleted，标题快照仍在（P0-11）',
    purge.status === 200 &&
      !gone &&
      aib.items.some(
        (n) =>
          n.kind === 'resource_deleted' && n.payload?.title === '東方E2Eテスト',
      ),
    `status=${purge.status}`,
  )

  // --- 清理：本次造的一切 ---
  if (!process.env.E2E_KEEP) {
    const ids = [
      author,
      reader,
      staff,
      admin,
      mentioner,
      spammer,
      linker,
      ...posters,
    ].map((s) => s.id)
    // report.reporter_id / post.author_id 都是 set null：不先删会留下孤儿
    await db.delete(schema.report).where(inArray(schema.report.reporterId, ids))
    await db
      .delete(schema.notification)
      .where(inArray(schema.notification.userId, ids))
    await db.delete(schema.topic).where(eq(schema.topic.id, tb.id))
    await db.delete(schema.resource).where(eq(schema.resource.id, resource.id))
    await db.delete(schema.user).where(inArray(schema.user.id, ids))
    console.log('已清理本次 e2e 数据（E2E_KEEP=1 可保留）')
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

await main()
