/**
 * 演示数据：从 TouhouDB 的公开 API 取真实的同人专辑编目，落成资源条目。
 *
 *   bun run seed:demo
 *
 * 这是**开发用的演示数据**，不是生产内容：
 * - 元数据（专辑名、社团、展会、封面）来自 TouhouDB 公开 API，是事实性编目信息
 * - 上海爱丽丝幻乐团的官方专辑被排除——产品文档规定官方作品本体不碰
 * - 许可状态一律 unspecified，因为没有任何证据表明社团授权了再分发。
 *   这也顺带让"未标明"的警示徽章在界面上真实出现
 * - 镜像链接指向东方圈现有的网盘站，用于演示外链分发的展示效果
 */
import { db } from '../src/client'
import {
  resource,
  resourceFile,
  resourceTag,
  resourceVersion,
  tag,
  topic,
  user,
} from '../src/schema'

const TDB = 'https://touhoudb.com/api'
const DEMO_USER = 'demo-importer'

/** 官方社团：平台规定不碰官方作品本体 */
const OFFICIAL = ['上海アリス幻樂団', 'Team Shanghai Alice', '黄昏フロンティア']

const MIRRORS = [
  {
    host: 'https://cloud.lilywhite.cc',
    label: '莉莉云',
    kind: 'netdisk' as const,
  },
  {
    host: 'https://cloud.touhou.re',
    label: '车万云',
    kind: 'netdisk' as const,
  },
]

type TdbAlbum = {
  id: number
  name: string
  discType?: string
  releaseDate?: { year?: number; month?: number; day?: number }
  releaseEvent?: { name?: string }
  mainPicture?: { urlSmallThumb?: string; urlThumb?: string }
  artists?: { name: string; categories?: string }[]
}

const slugify = (s: string) =>
  `${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')}-${Math.random().toString(36).slice(2, 8)}`

/** TouhouDB 的展会名 → 我们种子里的展会标签 */
function eventTag(name?: string): string | null {
  if (!name) return null
  const c = name.match(/Comiket\s*(\d+)/i)
  if (c) return `c${c[1]}`
  const r = name.match(/Reitaisai\s*(\d+)/i)
  if (r) return `rts${r[1]}`
  return null
}

async function fetchAlbums(): Promise<TdbAlbum[]> {
  const out: TdbAlbum[] = []
  for (const sort of ['RatingAverage', 'ReleaseDate', 'AdditionDate']) {
    const url = `${TDB}/albums?maxResults=40&sort=${sort}&fields=Artists,MainPicture,ReleaseEvent`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) continue
    const body = (await res.json()) as { items?: TdbAlbum[] }
    out.push(...(body.items ?? []))
  }
  // 去重 + 过滤官方
  const seen = new Set<number>()
  return out.filter((a) => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    const circle = a.artists?.find((x) => x.categories === 'Circle')?.name
    return circle !== undefined && !OFFICIAL.includes(circle)
  })
}

async function main() {
  const albums = (await fetchAlbums()).slice(0, 40)
  if (albums.length === 0) {
    console.error('TouhouDB 没返回数据，中止')
    process.exit(1)
  }

  await db
    .insert(user)
    .values({
      id: DEMO_USER,
      name: '编目机器人',
      email: 'demo-importer@example.invalid',
      emailVerified: false,
    })
    .onConflictDoNothing()

  const knownTags = new Set(
    (await db.select({ id: tag.id }).from(tag)).map((t) => t.id),
  )

  let created = 0
  for (const a of albums) {
    const circle = a.artists?.find((x) => x.categories === 'Circle')?.name
    const cover =
      a.mainPicture?.urlThumb ?? a.mainPicture?.urlSmallThumb ?? undefined
    const year = a.releaseDate?.year

    const [row] = await db
      .insert(resource)
      .values({
        slug: slugify(a.name),
        titleOriginal: a.name,
        titleOriginalLocale: 'ja',
        title: {},
        description: {
          zh: [
            circle ? `社团：${circle}` : null,
            year ? `发行年份：${year}` : null,
            a.releaseEvent?.name ? `首发展会：${a.releaseEvent.name}` : null,
            '元数据来自 TouhouDB 公开编目，许可状态未经社团确认。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
        kind: 'music',
        categoryId: 'music',
        status: 'published',
        // 没有任何证据表明社团授权再分发，如实标注
        license: 'unspecified',
        licenseNote: '尚未与社团确认分发许可，如权利人有异议请通过举报下架。',
        circleNameRaw: circle,
        coverUrl: cover,
        uploaderId: DEMO_USER,
      })
      .returning({ id: resource.id, slug: resource.slug })

    if (!row) continue
    created++

    const et = eventTag(a.releaseEvent?.name)
    const tagIds = [et, 'lang-ja'].filter(
      (t): t is string => t !== null && knownTags.has(t),
    )
    if (tagIds.length) {
      await db
        .insert(resourceTag)
        .values(tagIds.map((t) => ({ resourceId: row.id, tagId: t })))
        .onConflictDoNothing()
    }

    await db.insert(topic).values({
      kind: 'resource',
      resourceId: row.id,
      authorId: DEMO_USER,
      title: a.name,
    })

    const [version] = await db
      .insert(resourceVersion)
      .values({
        resourceId: row.id,
        label: 'v1',
        changelog: '初次收录',
        isLatest: 1,
      })
      .returning({ id: resourceVersion.id })

    if (version) {
      await db.insert(resourceFile).values(
        MIRRORS.map((mirror, i) => ({
          versionId: version.id,
          label: `${mirror.label} · ${a.name}`,
          url: `${mirror.host}/s/${row.slug}`,
          kind: mirror.kind,
          extractCode: i === 0 ? `th${1000 + (a.id % 9000)}` : undefined,
          sortOrder: i,
        })),
      )
    }
  }

  console.log(`导入 ${created} 条真实专辑编目（已排除官方作品）`)
}

await main()
