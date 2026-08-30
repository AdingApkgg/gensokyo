/**
 * 演示数据补充：官方免费内容（体验版 + 官方补丁）与 PC-98 绝版作。
 *
 *   bun run seed:demo-official-free
 *
 * 这一批把「官作」拆成了三档，因为它们的实际状态并不相同：
 *
 * - **体验版 / 官方补丁**（本脚本，license=allowed）：ZUN 在官网免费发布，
 *   由他自己指向的社区镜像站分发。这是真正可以自由收录并提供下载的官方内容。
 *   下载页实测确认存在的只有 th08–th15，其余作品未找到同名页面，不臆造链接。
 * - **PC-98 五作**（本脚本，license=out_of_print）：1997–98 年发售，绝版近三十年，
 *   没有任何官方购买渠道。这正是「已绝版」这一档的适用对象。
 * - **Windows 完整版**（见 seed-demo-official.ts，license=licensed）：同人店、
 *   DLsite、Steam 均在售，只收录条目不提供文件。
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

const DEMO_USER = 'demo-importer'
const ZUN = 'https://www16.big.or.jp/~zun/html'
/** 车万云「东方狗」的官方游戏目录，PC-98 作品在此流通 */
const PC98_MIRROR =
  'https://cloud.touhou.re/%E5%9B%BD%E5%A4%96%E5%88%86%E6%B5%812/%E4%B8%9C%E6%96%B9%E7%8B%97/%E4%B8%9C%E6%96%B9Project/%E5%AE%98%E6%96%B9%E6%B8%B8%E6%88%8F'

/** PC-98 时代五作。1997–98 年发售，早已绝版 */
const PC98 = [
  ['th01', '東方靈異伝　～ Highly Responsive to Prayers', '东方灵异传', 1997],
  [
    'th02',
    '東方封魔録　～ the Story of Eastern Wonderland',
    '东方封魔录',
    1997,
  ],
  ['th03', '東方夢時空　～ Phantasmagoria of Dim.Dream', '东方梦时空', 1997],
  ['th04', '東方幻想郷　～ Lotus Land Story', '东方幻想乡', 1998],
  ['th05', '東方怪綺談　～ Mystic Square', '东方怪绮谈', 1998],
] as const

/** 下载页实测确认存在的作品（含体验版与官方修正补丁） */
const TRIALS = [
  ['th08', '東方永夜抄', '东方永夜抄'],
  ['th09', '東方花映塚', '东方花映塚'],
  ['th10', '東方風神録', '东方风神录'],
  ['th11', '東方地霊殿', '东方地灵殿'],
  ['th12', '東方星蓮船', '东方星莲船'],
  ['th13', '東方神霊廟', '东方神灵庙'],
  ['th14', '東方輝針城', '东方辉针城'],
  ['th15', '東方紺珠伝', '东方绀珠传'],
] as const

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

  // 原作标签此前只种到 th06，补上 PC-98 五作
  await db
    .insert(tag)
    .values(
      PC98.map(([id, ja, zh], i) => ({
        id,
        kind: 'work' as const,
        nameOriginal: ja.split('　')[0] as string,
        name: { ja: ja.split('　')[0] as string, zh },
        sortOrder: i - 10,
      })),
    )
    .onConflictDoNothing()

  let made = 0

  async function add(opts: {
    slug: string
    titleOriginal: string
    zh: string
    desc: string
    license: 'allowed' | 'out_of_print'
    licenseNote: string
    workTag: string
    fileLabel: string
    url: string
    fileNote?: string
  }) {
    const [row] = await db
      .insert(resource)
      .values({
        slug: opts.slug,
        titleOriginal: opts.titleOriginal,
        titleOriginalLocale: 'ja',
        title: { zh: opts.zh },
        description: { zh: opts.desc },
        kind: 'game',
        categoryId: 'game',
        status: 'published',
        license: opts.license,
        licenseNote: opts.licenseNote,
        circleNameRaw: '上海アリス幻樂団',
        uploaderId: DEMO_USER,
      })
      .onConflictDoNothing()
      .returning({ id: resource.id })
    if (!row) return
    made++

    await db
      .insert(resourceTag)
      .values([
        { resourceId: row.id, tagId: opts.workTag },
        { resourceId: row.id, tagId: 'lang-ja' },
      ])
      .onConflictDoNothing()

    await db.insert(topic).values({
      kind: 'resource',
      resourceId: row.id,
      authorId: DEMO_USER,
      title: opts.titleOriginal,
    })

    const [v] = await db
      .insert(resourceVersion)
      .values({
        resourceId: row.id,
        label: 'v1',
        changelog: '初次收录',
        isLatest: 1,
      })
      .returning({ id: resourceVersion.id })

    if (v) {
      await db.insert(resourceFile).values({
        versionId: v.id,
        label: opts.fileLabel,
        url: opts.url,
        kind: 'direct',
        note: opts.fileNote,
        sortOrder: 0,
      })
    }
  }

  for (const [id, ja, zh] of TRIALS) {
    await add({
      slug: `${id}-trial`,
      titleOriginal: `${ja}　体験版`,
      zh: `${zh} 体验版`,
      desc: `上海爱丽丝幻乐团官方发布的体验版，可游玩至第三面。\n\n同一页面还提供官方修正补丁（製品版向け）。两者均由 ZUN 免费发布，经其指定的社区镜像站分发。`,
      license: 'allowed',
      licenseNote: '作者官方免费发布的体验版与修正补丁，允许自由传播。',
      workTag: id,
      fileLabel: '上海アリス幻樂団 官方下载页（体验版 + 修正补丁）',
      url: `${ZUN}/${id}dl.html`,
      fileNote: '页面内含 ZUN 指定的多个镜像站',
    })
  }

  for (const [id, ja, zh, year] of PC98) {
    await add({
      slug: `${id}-pc98`,
      titleOriginal: ja,
      zh,
      desc: `PC-98 时代作品，${year} 年发售。绝版近三十年，无任何官方购买渠道。\n\n运行需要 PC-98 模拟器（如 Neko Project II）。`,
      license: 'out_of_print',
      licenseNote:
        '1997–1998 年发售，早已停止发行，目前不存在官方购买渠道。若作者恢复发行，本条目应即时下架。',
      workTag: id,
      fileLabel: '车万云 · 东方狗（官方游戏目录）',
      url: PC98_MIRROR,
      fileNote: '社区镜像目录，需自行定位对应作品',
    })
  }

  console.log(
    `导入 ${made} 条（体验版/官方补丁 ${TRIALS.length} · PC-98 绝版 ${PC98.length}）`,
  )
}

await main()
