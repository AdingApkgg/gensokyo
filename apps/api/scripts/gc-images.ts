/**
 * 清理没有被任何行引用的图片。
 *
 *   bun run gc:images -- --dry
 *
 * 谓词是**白名单**——只删「不在引用集合里」且「超过宽限期」的对象。
 * 绝不写成取反的黑名单（"没被 resource_file 引用的删掉"），
 * 那种写法会在漏掉任何一处引用来源时删光全站图片。
 *
 * 另有一道熔断：引用集合为空而桶里有对象时直接拒绝执行。之前有个 bug 正好
 * 制造这个局面——publicBaseUrl 依赖 s3() 的惰性初始化，而本脚本从不调它，
 * 于是 isManagedUrl 恒为 false、白名单塌成空集、一跑就是全删。
 */
import { db, schema } from '@gensokyo/db'
import { S3Client } from 'bun'
import { isNotNull } from 'drizzle-orm'
import { deleteObject, isManagedUrl, publicBaseUrl } from '../src/storage'

const GRACE_MS = 24 * 60 * 60 * 1000
const dryRun = process.argv.includes('--dry')

/**
 * 所有可能引用图片的列。**加一处引用来源就必须加到这里**，
 * 漏掉等于让 GC 删掉正在用的图。
 */
async function referencedUrls(): Promise<Set<string>> {
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
  const set = new Set<string>()
  for (const row of [...covers, ...avatars, ...userImages]) {
    if (row.url) set.add(row.url)
  }
  return set
}

async function main() {
  const base = publicBaseUrl()
  if (!base) {
    console.error('S3_PUBLIC_BASE_URL 未配置，拒绝执行')
    process.exit(1)
  }

  const referenced = await referencedUrls()
  const keys = new Set<string>()
  for (const url of referenced) {
    if (isManagedUrl(url)) keys.add(url.slice(base.length + 1))
  }

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

  // 熔断：桶里有东西但一个引用都没解析出来，几乎必然是引用侧出了 bug
  if (keys.size === 0 && objects.length > 0) {
    console.error(
      `拒绝执行：桶内有 ${objects.length} 个对象但引用集合为空。` +
        '这通常意味着 publicBaseUrl 或引用查询坏了，而不是真的全都没人用。',
    )
    process.exit(1)
  }

  const cutoff = Date.now() - GRACE_MS
  let removed = 0
  for (const o of objects) {
    if (keys.has(o.key)) continue
    // 拿不到时间就当作「刚上传」，宁可漏删不可错删
    const age = o.lastModified ? new Date(o.lastModified).getTime() : Date.now()
    if (age > cutoff) continue
    if (dryRun) console.log(`would delete ${o.key}`)
    else await deleteObject(o.key)
    removed++
  }

  console.log(
    `${dryRun ? '[dry] ' : ''}scanned ${objects.length}, referenced ${keys.size}, removed ${removed}`,
  )
}

await main()
