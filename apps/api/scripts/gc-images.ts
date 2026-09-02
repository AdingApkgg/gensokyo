/**
 * 清理没有被任何行引用的图片。
 *
 *   bun run gc:images -- --dry
 *   bun run gc:images -- --legacy-base=https://old.example/img/gensokyo   # 换过域名之后
 *   bun run gc:images -- --allow-empty-refs                               # 桶里确实全是孤儿
 *
 * 谓词是**白名单**——只删「不在引用集合里」且「超过宽限期」的对象。
 * 绝不写成取反的黑名单（"没被 resource_file 引用的删掉"），
 * 那种写法会在漏掉任何一处引用来源时删光全站图片。
 *
 * 三道熔断，防的是三种不同的「白名单坏了」：
 *
 * ① 引用集合为空而桶里有对象 → 拒绝。之前有个 bug 正好制造这个局面——
 *    publicBaseUrl 依赖 s3() 的惰性初始化，而本脚本从不调它，于是
 *    isManagedUrl 恒为 false、白名单塌成空集、一跑就是全删。
 *    「桶里确实全是孤儿」与这个 bug 不可区分，所以要跳过它得显式给
 *    `--allow-empty-refs`，且先看过对象清单。
 *
 * ② 引用集合非空但**与桶里的对象对不上** → 拒绝。防的是「白名单派生错了」：
 *    从 Markdown 抽 URL 时多吃一个闭括号，派生出 `post/xxx.webp)`，桶里那个叫
 *    `post/xxx.webp`，精确比对不上，过了宽限期这张正在用的图被精确删掉。
 *    熔断①挡不住它——封面都还在，白名单远非空集。所以要看命中率。
 *    **命中率的分母只算「普通用户伪造不了」的引用**：单值列（封面/头像/用户头像）
 *    与**未软删**帖子里的引用。软删的帖子照样进白名单（宁可漏删），但不进分母——
 *    否则任何人发一条塞满 200 个假 key 的帖，就能让命中率永远低于阈值、
 *    GC 永远拒绝，而全站没有硬删路径、staff 也改不了别人的正文。
 *    排除软删之后，处置路径就是现成的：版主删掉那条帖，重跑。
 *
 * ③ 发现「长得像我们的对象、但挂在别的 base 下」的引用 → 拒绝。这是换域名 /
 *    上 CDN / 改桶名之后没迁移存量 URL 的形状。那时①②都看不见（它们只看
 *    当前 base 下的引用），老图全被判成无引用，宽限期一过整批被删。
 *    要么先跑迁移把 URL 改写到新 base，要么用 `--legacy-base=` 把旧 base
 *    也纳入白名单派生。
 */
import { db, schema } from '@gensokyo/db'
import { S3Client } from 'bun'
import { and, asc, eq, gt, isNotNull, like, or } from 'drizzle-orm'
import {
  bareKeyPattern,
  deleteObject,
  extractManagedKeys,
  publicBaseUrl,
} from '../src/storage'

const HOUR = 60 * 60 * 1000
/**
 * 宽限期按 key 前缀分。帖子图要长得多：草稿被设计成跨天存活（localStorage），
 * 而图片上传是立即落桶的——写到一半放两天再回来发，图不能已经没了。
 * 前缀不认识的对象（不是我们生成的）按默认宽限期，仍受白名单保护。
 */
const GRACE_MS: Record<string, number> = { post: 7 * 24 * HOUR }
const DEFAULT_GRACE_MS = 24 * HOUR
const graceFor = (key: string) => {
  const slash = key.indexOf('/')
  return (
    (slash > 0 ? GRACE_MS[key.slice(0, slash)] : undefined) ?? DEFAULT_GRACE_MS
  )
}

/** 熔断②的阈值：可信引用至少有这么多时才按比例判；样本太小就只看是否全空 */
const MIN_SAMPLE_FOR_RATIO = 10
const MIN_HIT_RATIO = 0.9

/** 每批扫多少条帖子。别一次 select 全表——正文列大，全表进内存不是常态操作 */
const POST_BATCH = 500

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry')
const allowEmptyRefs = argv.includes('--allow-empty-refs')
const legacyBases = argv
  .filter((a) => a.startsWith('--legacy-base='))
  .map((a) => a.slice('--legacy-base='.length).replace(/\/$/, ''))
  .filter(Boolean)

/** LIKE 的通配符要转义，base 里理论上没有 % 和 _，但别赌 */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&')

type Ref = {
  key: string
  /** 来自哪里，熔断报告用：`resource.coverUrl` / `post:<id>` / `announcement` */
  source: string
  /**
   * 是否计入熔断②的分母。单值列与未软删帖子为 true；
   * 软删帖子为 false——进白名单但不当证据。
   */
  trusted: boolean
}

/**
 * 所有可能引用图片的列。**加一处引用来源就必须加到这里**，
 * 漏掉等于让 GC 删掉正在用的图。
 *
 * 单值列同时走两条路径求并集：`startsWith + slice` 保住任何形状怪异但确实在
 * base 下的旧 key，`extractManagedKeys` 保住带 query/锚点装饰过的 URL——
 * 两边都算引用，宁可多留不可错删。
 */
async function collectRefs(bases: string[]): Promise<{
  refs: Ref[]
  foreignBases: Map<string, string[]>
}> {
  const refs: Ref[] = []
  /** 挂在别的 base 下的疑似本站对象：base → 样本 */
  const foreignBases = new Map<string, string[]>()
  const known = new Set(bases)

  const noteForeign = (text: string) => {
    for (const m of text.matchAll(bareKeyPattern())) {
      const prefix = m[1] ?? ''
      if (known.has(prefix)) continue
      const list = foreignBases.get(prefix) ?? []
      if (list.length < 5) list.push(m[0])
      foreignBases.set(prefix, list)
    }
  }
  const addUrl = (url: string | null, source: string) => {
    if (!url) return
    for (const base of bases) {
      if (url.startsWith(`${base}/`)) {
        refs.push({ key: url.slice(base.length + 1), source, trusted: true })
      }
      for (const k of extractManagedKeys(url, base)) {
        refs.push({ key: k, source, trusted: true })
      }
    }
    noteForeign(url)
  }
  const addText = (
    text: string | null | undefined,
    source: string,
    trusted: boolean,
  ) => {
    if (!text) return
    for (const base of bases) {
      for (const k of extractManagedKeys(text, base)) {
        refs.push({ key: k, source, trusted })
      }
    }
    noteForeign(text)
  }

  // ---- 单值列 ----
  const [covers, avatars, userImages] = await Promise.all([
    db
      .select({ url: schema.resource.coverUrl })
      .from(schema.resource)
      .where(isNotNull(schema.resource.coverUrl)),
    db
      .select({ url: schema.circle.avatarUrl })
      .from(schema.circle)
      .where(isNotNull(schema.circle.avatarUrl)),
    // better-auth 的 update-user 会写这一列
    db
      .select({ url: schema.user.image })
      .from(schema.user)
      .where(isNotNull(schema.user.image)),
  ])
  for (const r of covers) addUrl(r.url, 'resource.coverUrl')
  for (const r of avatars) addUrl(r.url, 'circle.avatarUrl')
  for (const r of userImages) addUrl(r.url, 'user.image')

  // ---- 帖子正文：keyset 分页，只拉含图床前缀的行 ----
  // 软删的楼层与软删主题里的楼层也算引用（行还在、正文还在），但不算可信证据
  const hasAnyBase = or(
    ...bases.map((b) => like(schema.post.bodyMd, `%${likeEscape(b)}%`)),
    // 别的 base 下的疑似对象也要拉出来给熔断③看
    ...['cover', 'avatar', 'post'].map((p) =>
      like(schema.post.bodyMd, `%/${p}/%`),
    ),
  )
  let lastId = ''
  for (;;) {
    // 过滤条件每一页都带：只在第一页过滤的话，第二页起就是全表
    const batch = await db
      .select({
        id: schema.post.id,
        body: schema.post.bodyMd,
        postDeleted: schema.post.deletedAt,
        topicDeleted: schema.topic.deletedAt,
      })
      .from(schema.post)
      .innerJoin(schema.topic, eq(schema.topic.id, schema.post.topicId))
      .where(lastId ? and(hasAnyBase, gt(schema.post.id, lastId)) : hasAnyBase)
      .orderBy(asc(schema.post.id))
      .limit(POST_BATCH)
    for (const row of batch) {
      const live = row.postDeleted === null && row.topicDeleted === null
      addText(row.body, `post:${row.id}`, live)
    }
    if (batch.length < POST_BATCH) break
    lastId = batch[batch.length - 1]?.id ?? ''
  }

  // ---- 站点公告：三语 jsonb，逐个字符串值抽 ----
  const [announcement] = await db
    .select({ value: schema.siteConfig.value })
    .from(schema.siteConfig)
    .where(eq(schema.siteConfig.key, 'announcement'))
  if (announcement && typeof announcement.value === 'object') {
    for (const v of Object.values(
      announcement.value as Record<string, unknown>,
    )) {
      if (typeof v === 'string') addText(v, 'announcement', true)
    }
  }

  return { refs, foreignBases }
}

async function listBucket(): Promise<
  { key: string; lastModified?: string | Date }[]
> {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
  })
  // 分页续取：只看第一页的话，超过 maxKeys 的对象会被当成无引用
  const objects: { key: string; lastModified?: string | Date }[] = []
  let token: string | undefined
  do {
    const page = await s3.list({ maxKeys: 1000, continuationToken: token })
    for (const o of page.contents ?? []) {
      if (o.key) objects.push({ key: o.key, lastModified: o.lastModified })
    }
    token = page.isTruncated ? page.nextContinuationToken : undefined
  } while (token)
  return objects
}

function refuse(msg: string, ...detail: unknown[]): never {
  console.error(`拒绝执行：${msg}`)
  for (const d of detail) console.error(d)
  process.exit(1)
}

async function main() {
  const base = publicBaseUrl()
  if (!base) refuse('S3_PUBLIC_BASE_URL 未配置')
  const bases = [base, ...legacyBases]

  const [{ refs, foreignBases }, objects] = await Promise.all([
    collectRefs(bases),
    listBucket(),
  ])
  const bucket = new Set(objects.map((o) => o.key))
  const keys = new Set(refs.map((r) => r.key))

  // 熔断③：先于①②——它解释了为什么①②可能看起来「正常」
  if (foreignBases.size > 0) {
    refuse(
      `发现挂在别的 base 下的疑似本站对象引用（${foreignBases.size} 个前缀）。` +
        '多半是换过域名/CDN/桶名而没迁移存量 URL；按当前 base 派生的白名单会把它们全判成无引用。' +
        '先跑迁移把 URL 改写到当前 base，或用 --legacy-base=<旧base> 把它们纳入白名单。',
      Object.fromEntries(foreignBases),
    )
  }

  // 熔断①：桶里有东西但一个引用都没解析出来，几乎必然是引用侧出了 bug
  if (keys.size === 0 && objects.length > 0 && !allowEmptyRefs) {
    refuse(
      `桶内有 ${objects.length} 个对象但引用集合为空。` +
        '这通常意味着 publicBaseUrl 或引用查询坏了，而不是真的全都没人用。' +
        '若确认桶里全是孤儿（先 --dry 看清单），加 --allow-empty-refs 跳过这道。',
      objects.slice(0, 10).map((o) => o.key),
    )
  }

  // 熔断②：可信引用与桶对不上
  const trusted = refs.filter((r) => r.trusted)
  const trustedKeys = new Set(trusted.map((r) => r.key))
  const hits = [...trustedKeys].filter((k) => bucket.has(k))
  const misses = trusted.filter((r) => !bucket.has(r.key))
  const missBySource: Record<string, string[]> = {}
  for (const r of misses) {
    const list = missBySource[r.source] ?? []
    list.push(r.key)
    missBySource[r.source] = list
  }
  if (objects.length > 0 && trustedKeys.size > 0 && hits.length === 0) {
    refuse(
      `可信引用有 ${trustedKeys.size} 个 key，但**没有一个**在桶里。` +
        '白名单派生出来的 key 与真实对象名对不上——很可能是 base 变了或抽取规则错了。',
      {
        引用侧按来源: missBySource,
        桶侧样本: objects.slice(0, 5).map((o) => o.key),
      },
    )
  }
  if (
    trustedKeys.size >= MIN_SAMPLE_FOR_RATIO &&
    hits.length / trustedKeys.size < MIN_HIT_RATIO
  ) {
    refuse(
      `可信引用命中率 ${hits.length}/${trustedKeys.size} = ` +
        `${((hits.length / trustedKeys.size) * 100).toFixed(1)}%，低于 ${MIN_HIT_RATIO * 100}%。` +
        '若污染来自某条帖子（见下），版主软删它后重跑。',
      { 对不上的引用按来源: missBySource },
    )
  }

  const now = Date.now()
  let removed = 0
  const byPrefix: Record<string, number> = {}
  for (const o of objects) {
    if (keys.has(o.key)) continue
    // 拿不到时间就当作「刚上传」，宁可漏删不可错删
    const age = o.lastModified ? new Date(o.lastModified).getTime() : now
    if (now - age < graceFor(o.key)) continue
    if (dryRun) console.log(`would delete ${o.key}`)
    else await deleteObject(o.key)
    removed++
    const slash = o.key.indexOf('/')
    const p = slash > 0 ? o.key.slice(0, slash) : '(无前缀)'
    byPrefix[p] = (byPrefix[p] ?? 0) + 1
  }

  const untrusted = refs.length - trusted.length
  console.log(
    `${dryRun ? '[dry] ' : ''}scanned ${objects.length}, ` +
      `referenced ${keys.size} (trusted ${trustedKeys.size}: hit ${hits.length} miss ${misses.length}` +
      `${untrusted ? `; 软删来源 ${untrusted}` : ''}), ` +
      `removed ${removed}${Object.keys(byPrefix).length ? ` ${JSON.stringify(byPrefix)}` : ''}`,
  )
  if (misses.length > 0) {
    console.log(
      `注意：${misses.length} 个可信引用指向桶里不存在的对象（悬空引用，不影响本次删除）:`,
    )
    for (const [src, ks] of Object.entries(missBySource).slice(0, 5)) {
      console.log(
        `  ${src}: ${ks.slice(0, 3).join(', ')}${ks.length > 3 ? ` …+${ks.length - 3}` : ''}`,
      )
    }
  }
}

await main()
