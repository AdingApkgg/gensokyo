/**
 * 演示数据补充：连缘 Project 与西方 Project。
 *
 *   bun run seed:demo-lilywhite
 *
 * 取自莉莉云的公开分享（无需登录）。这两个系列是车万云那边没有的：
 * 莉莉云自己的说明写着同人游戏部分不转存（车万云已收 5500+ 款），
 * 它主要存官作相关与周边，外加这两个独立系列。
 *
 * - 连缘 Project：JynX 的独立同人 STG 系列，与东方无隶属关系但受众高度重叠
 * - 西方 Project：Amusement Makers 的作品（秋霜玉 / 稀翁玉 / 幡紫竜）
 *
 * 许可状态一律 unspecified：这些是社区流通的同人作品，未见明确的再分发授权。
 * 秋霜玉近年有商业再版，条目保留但备注提示需要复核。
 */
import { db } from '../src/client'
import {
  resource,
  resourceFile,
  resourceTag,
  resourceVersion,
  topic,
  user,
} from '../src/schema'

const DEMO_USER = 'demo-importer'
const SHARE = 'https://cloud.lilywhite.cc/s/4ZUW'

const link = (dir: string, file: string) =>
  `${SHARE}?path=${encodeURIComponent(`/${dir}/${file}`)}`

type Work = {
  slug: string
  title: string
  zh: string
  series: string
  desc: string
  dir: string
  files: { label: string; file: string }[]
  note?: string
}

const WORKS: Work[] = [
  {
    slug: 'lenen-01-mugenri',
    title: '連縁無現里',
    zh: '连缘无现里',
    series: '连缘 Project',
    dir: '连缘Project',
    desc: '连缘 Project 第一作。JynX 制作的独立同人弹幕射击游戏，与东方 Project 无隶属关系，但玩家群体高度重叠。',
    files: [
      { label: '日文版', file: '[le01] 连缘无现里 (日文版).zip' },
      { label: '汉化版', file: '[le01] 连缘无现里 (汉化版).zip' },
    ],
  },
  {
    slug: 'lenen-02-hemizuka',
    title: '連縁蛇叢釼',
    zh: '连缘蛇丛剑',
    series: '连缘 Project',
    dir: '连缘Project',
    desc: '连缘 Project 第二作。',
    files: [
      { label: '日文版', file: '[le02] 连缘蛇丛剑 (日文版).zip' },
      { label: '汉化版', file: '[le02] 连缘蛇丛剑 (汉化版).zip' },
    ],
  },
  {
    slug: 'lenen-03-reiretsuden',
    title: '連縁霊烈傳',
    zh: '连缘灵烈传',
    series: '连缘 Project',
    dir: '连缘Project',
    desc: '连缘 Project 第三作。',
    files: [
      { label: '日文版', file: '[le03] 连缘灵烈传 (日文版).zip' },
      { label: '汉化版', file: '[le03] 连缘灵烈传 (汉化版).zip' },
    ],
  },
  {
    slug: 'lenen-04-tenneisenki',
    title: '連縁天影戦記',
    zh: '连缘天影战记',
    series: '连缘 Project',
    dir: '连缘Project',
    desc: '连缘 Project 第四作。',
    files: [
      { label: '日文版', file: '[le04] 连缘天影战记 (日文版).zip' },
      { label: '汉化版', file: '[le04] 连缘天影战记 (汉化版).zip' },
    ],
  },
  {
    slug: 'seihou-01-shuusou-gyoku',
    title: '秋霜玉',
    zh: '秋霜玉',
    series: '西方 Project',
    dir: '西方Project',
    desc: '西方 Project 第一作，Amusement Makers 制作。',
    note: '本作近年有商业再版，此条目的分发状态需要复核。',
    files: [{ label: '汉化版', file: '[sh1] 秋霜玉 (汉化版).rar' }],
  },
  {
    slug: 'seihou-02-kioh-gyoku',
    title: '稀翁玉',
    zh: '稀翁玉',
    series: '西方 Project',
    dir: '西方Project',
    desc: '西方 Project 第二作，Amusement Makers 制作。',
    files: [{ label: '日文版', file: '[sh2] 稀翁玉 (日文版).zip' }],
  },
  {
    slug: 'seihou-03-banshiryuu',
    title: '幡紫竜',
    zh: '幡紫竜',
    series: '西方 Project',
    dir: '西方Project',
    desc: '西方 Project 第三作，Amusement Makers 制作。',
    files: [{ label: '日文版', file: '[sh3] 幡紫竜 (日文版).zip' }],
  },
]

const BASE_NOTE =
  '社区流通的同人作品，未见作者对再分发的明确授权。如权利人有异议，请通过举报下架。'

async function main() {
  await db
    .insert(user)
    .values({
      id: DEMO_USER,
      name: '编目机器人',
      email: 'demo-importer@example.invalid',
      emailVerified: false,
    })
    .onConflictDoNothing()

  let created = 0
  for (const w of WORKS) {
    const [row] = await db
      .insert(resource)
      .values({
        slug: w.slug,
        titleOriginal: w.title,
        titleOriginalLocale: 'ja',
        title: { zh: w.zh },
        description: {
          zh: `${w.desc}\n\n收录自莉莉云公开分享（东方狗下载站国际站）。`,
        },
        kind: 'game',
        categoryId: 'game',
        status: 'published',
        license: 'unspecified',
        licenseNote: w.note ? `${BASE_NOTE}\n${w.note}` : BASE_NOTE,
        circleNameRaw: w.series,
        uploaderId: DEMO_USER,
      })
      .onConflictDoNothing()
      .returning({ id: resource.id })

    if (!row) continue
    created++

    await db
      .insert(resourceTag)
      .values([{ resourceId: row.id, tagId: 'lang-ja' }])
      .onConflictDoNothing()

    await db.insert(topic).values({
      kind: 'resource',
      resourceId: row.id,
      authorId: DEMO_USER,
      title: w.title,
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
        w.files.map((f, i) => ({
          versionId: version.id,
          label: `莉莉云 · ${f.label}`,
          url: link(w.dir, f.file),
          kind: 'netdisk' as const,
          sortOrder: i,
        })),
      )
    }
  }

  console.log(`导入 ${created} 条（连缘 4 / 西方 3），来源：莉莉云公开分享`)
}

await main()
