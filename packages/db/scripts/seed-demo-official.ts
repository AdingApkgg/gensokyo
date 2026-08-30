/**
 * 演示数据补充：官方作品条目。
 *
 *   bun run seed:demo-official
 *
 * 官作是整个圈子的参照系——同人曲要标原曲、魔改要标底本、Wiki 要能互引，
 * 所以目录里必须有它们。但**这里只收录条目，不提供文件分发**：
 * 官作是上海爱丽丝幻乐团在售的商业软件，链接指向官方页面而非任何拷贝。
 *
 * 官方补丁是另一回事——ZUN 自己免费发布的更新，可以正常指向官方下载。
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
const ZUN_SITE = 'https://www16.big.or.jp/~zun/'
const CIRCLE = '上海アリス幻樂団'

/** 官方 STG 本篇。tagId 对应种子里已有的原作标签 */
const OFFICIAL = [
  [
    'th06',
    '東方紅魔郷　～ the Embodiment of Scarlet Devil',
    '东方红魔乡',
    2002,
  ],
  ['th07', '東方妖々夢　～ Perfect Cherry Blossom', '东方妖妖梦', 2003],
  ['th08', '東方永夜抄　～ Imperishable Night', '东方永夜抄', 2004],
  ['th09', '東方花映塚　～ Phantasmagoria of Flower View', '东方花映塚', 2005],
  ['th10', '東方風神録　～ Mountain of Faith', '东方风神录', 2007],
  ['th11', '東方地霊殿　～ Subterranean Animism', '东方地灵殿', 2008],
  ['th12', '東方星蓮船　～ Undefined Fantastic Object', '东方星莲船', 2009],
  ['th13', '東方神霊廟　～ Ten Desires', '东方神灵庙', 2011],
  ['th14', '東方輝針城　～ Double Dealing Character', '东方辉针城', 2013],
  ['th15', '東方紺珠伝　～ Legacy of Lunatic Kingdom', '东方绀珠传', 2015],
  ['th16', '東方天空璋　～ Hidden Star in Four Seasons', '东方天空璋', 2017],
  [
    'th17',
    '東方鬼形獣　～ Wily Beast and Weakest Creature',
    '东方鬼形兽',
    2019,
  ],
  ['th18', '東方虹龍洞　～ Unconnected Marketeers', '东方虹龙洞', 2021],
  [
    'th19',
    '東方獣王園　～ Unfinished Dream of All Living Ghost',
    '东方兽王园',
    2023,
  ],
  ['th20', '東方錦上京　～ Fossilized Wonders', '东方锦上京', 2025],
] as const

const NOTE =
  '官方商业作品。本站只收录条目供检索与互引，不提供文件——请通过官方渠道购买。'

const slugify = (id: string) => `official-${id}`

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
  for (const [tagId, ja, zh, year] of OFFICIAL) {
    const [row] = await db
      .insert(resource)
      .values({
        slug: slugify(tagId),
        titleOriginal: ja,
        titleOriginalLocale: 'ja',
        title: { zh },
        description: {
          zh: `上海爱丽丝幻乐团 ${year} 年发行的官方弹幕射击游戏。\n\n本站不提供官方作品的文件下载，此条目用于检索、标注原曲与关联同人作品。`,
        },
        kind: 'game',
        categoryId: 'game',
        status: 'published',
        // 官方作品：明确不做再分发，此处按「授权转载」之外的最保守表述处理
        license: 'licensed',
        licenseNote: NOTE,
        circleNameRaw: CIRCLE,
        uploaderId: DEMO_USER,
      })
      .onConflictDoNothing()
      .returning({ id: resource.id })

    if (!row) continue
    created++

    await db
      .insert(resourceTag)
      .values([
        { resourceId: row.id, tagId },
        { resourceId: row.id, tagId: 'lang-ja' },
      ])
      .onConflictDoNothing()

    await db.insert(topic).values({
      kind: 'resource',
      resourceId: row.id,
      authorId: DEMO_USER,
      title: ja,
    })

    const [version] = await db
      .insert(resourceVersion)
      .values({
        resourceId: row.id,
        label: '官方',
        changelog: '条目收录，不含文件',
        isLatest: 1,
      })
      .returning({ id: resourceVersion.id })

    if (version) {
      await db.insert(resourceFile).values({
        versionId: version.id,
        label: '上海アリス幻樂団 官方页面',
        url: ZUN_SITE,
        kind: 'direct',
        note: '官方购买 / 下载渠道',
        sortOrder: 0,
      })
    }
  }

  console.log(`导入 ${created} 条官方作品条目（仅编目，链接指向官方页面）`)
}

await main()
