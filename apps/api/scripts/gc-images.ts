/**
 * 清理没有被任何行引用的图片。
 *
 *   bun run apps/api/scripts/gc-images.ts [--dry]
 *
 * 谓词是**白名单**——只删「不在引用集合里」且「超过宽限期」的对象。
 * 绝不写成取反的黑名单（"没被 resource_file 引用的删掉"），
 * 那种写法会在漏掉任何一处引用来源时删光全站图片。
 *
 * 巡检本身幂等且自愈：某次跑漏了，下一晚会捡回来。
 */
import { db, schema } from '@gensokyo/db'
import { isNotNull } from 'drizzle-orm'
import { deleteObject, isManagedUrl } from '../src/storage'

const GRACE_MS = 24 * 60 * 60 * 1000
const dryRun = process.argv.includes('--dry')

/** 所有可能引用图片的列，加一列就往这里加一项 */
async function referencedUrls(): Promise<Set<string>> {
  const [covers, avatars] = await Promise.all([
    db
      .select({ url: schema.resource.coverUrl })
      .from(schema.resource)
      .where(isNotNull(schema.resource.coverUrl)),
    db
      .select({ url: schema.circle.avatarUrl })
      .from(schema.circle)
      .where(isNotNull(schema.circle.avatarUrl)),
  ])
  const set = new Set<string>()
  for (const row of [...covers, ...avatars]) {
    if (row.url) set.add(row.url)
  }
  return set
}

async function main() {
  const referenced = await referencedUrls()
  const base = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? ''
  const cutoff = Date.now() - GRACE_MS

  const keys = new Set<string>()
  for (const url of referenced) {
    if (isManagedUrl(url)) keys.add(url.slice(base.length + 1))
  }

  const { S3Client } = await import('bun')
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
  })

  let scanned = 0
  let removed = 0
  const listing = await s3.list({ maxKeys: 1000 })
  for (const obj of listing.contents ?? []) {
    scanned++
    if (!obj.key) continue
    if (keys.has(obj.key)) continue
    const age = obj.lastModified ? new Date(obj.lastModified).getTime() : 0
    if (age > cutoff) continue // 宽限期内：可能正被某个未提交的表单持有
    if (dryRun) {
      console.log(`would delete ${obj.key}`)
    } else {
      await deleteObject(obj.key)
    }
    removed++
  }

  console.log(
    `${dryRun ? '[dry] ' : ''}scanned ${scanned}, referenced ${keys.size}, removed ${removed}`,
  )
}

await main()
