/**
 * 种子数据：资源类型 + 标签（原作 / 展会 / 语言）。
 * 幂等——重复跑只更新名称，不产生重复行。
 *
 *   DATABASE_URL=... bun run seed
 */
import { db } from '../src/client'
import { resourceCategory, tag } from '../src/schema'

const CATEGORIES = [
  {
    id: 'game',
    kind: 'game' as const,
    name: { zh: '同人游戏', ja: '同人ゲーム', en: 'Fan games' },
  },
  {
    id: 'music',
    kind: 'music' as const,
    name: { zh: '音乐专辑', ja: '音楽アルバム', en: 'Music albums' },
  },
  {
    id: 'doujinshi',
    kind: 'doujinshi' as const,
    name: { zh: '同人志 / 图集', ja: '同人誌・画集', en: 'Doujinshi & art' },
  },
  {
    id: 'patch',
    kind: 'patch' as const,
    name: {
      zh: '汉化补丁 / 字幕',
      ja: '翻訳パッチ・字幕',
      en: 'Patches & subtitles',
    },
  },
  {
    id: 'tool',
    kind: 'tool' as const,
    name: { zh: '工具 / 素材', ja: 'ツール・素材', en: 'Tools & assets' },
  },
]

/** 官方作品。nameOriginal 是日文原题，多语表提供中英译名 */
const WORKS = [
  ['th06', '東方紅魔郷', '东方红魔乡', 'the Embodiment of Scarlet Devil'],
  ['th07', '東方妖々夢', '东方妖妖梦', 'Perfect Cherry Blossom'],
  ['th08', '東方永夜抄', '东方永夜抄', 'Imperishable Night'],
  ['th09', '東方花映塚', '东方花映塚', 'Phantasmagoria of Flower View'],
  ['th10', '東方風神録', '东方风神录', 'Mountain of Faith'],
  ['th11', '東方地霊殿', '东方地灵殿', 'Subterranean Animism'],
  ['th12', '東方星蓮船', '东方星莲船', 'Undefined Fantastic Object'],
  ['th13', '東方神霊廟', '东方神灵庙', 'Ten Desires'],
  ['th14', '東方輝針城', '东方辉针城', 'Double Dealing Character'],
  ['th15', '東方紺珠伝', '东方绀珠传', 'Legacy of Lunatic Kingdom'],
  ['th16', '東方天空璋', '东方天空璋', 'Hidden Star in Four Seasons'],
  ['th17', '東方鬼形獣', '东方鬼形兽', 'Wily Beast and Weakest Creature'],
  ['th18', '東方虹龍洞', '东方虹龙洞', 'Unconnected Marketeers'],
  ['th19', '東方獣王園', '东方兽王园', 'Unfinished Dream of All Living Ghost'],
  ['th20', '東方錦上京', '东方锦上京', 'Fossilized Wonders'],
] as const

const CONVENTIONS = [
  ['rts19', '第十九回博麗神社例大祭', '第十九回博丽神社例大祭', 'Reitaisai 19'],
  ['rts20', '第二十回博麗神社例大祭', '第二十回博丽神社例大祭', 'Reitaisai 20'],
  [
    'rts21',
    '第二十一回博麗神社例大祭',
    '第二十一回博丽神社例大祭',
    'Reitaisai 21',
  ],
  [
    'rts22',
    '第二十二回博麗神社例大祭',
    '第二十二回博丽神社例大祭',
    'Reitaisai 22',
  ],
  ['c104', 'コミックマーケット104', 'Comic Market 104', 'Comiket 104'],
  ['c105', 'コミックマーケット105', 'Comic Market 105', 'Comiket 105'],
  ['c106', 'コミックマーケット106', 'Comic Market 106', 'Comiket 106'],
  ['c107', 'コミックマーケット107', 'Comic Market 107', 'Comiket 107'],
] as const

const LANGUAGES = [
  ['lang-zh', '中国語', '简体中文', 'Chinese'],
  ['lang-ja', '日本語', '日语', 'Japanese'],
  ['lang-en', '英語', '英语', 'English'],
] as const

async function main() {
  for (const [i, c] of CATEGORIES.entries()) {
    await db
      .insert(resourceCategory)
      .values({ ...c, sortOrder: i })
      .onConflictDoUpdate({
        target: resourceCategory.id,
        set: { name: c.name, sortOrder: i },
      })
  }

  const tags = [
    ...WORKS.map(
      ([id, ja, zh, en], i) =>
        ({
          id,
          kind: 'work' as const,
          nameOriginal: ja,
          name: { zh, ja, en },
          sortOrder: i,
        }) as const,
    ),
    ...CONVENTIONS.map(
      ([id, ja, zh, en], i) =>
        ({
          id,
          kind: 'convention' as const,
          nameOriginal: ja,
          name: { zh, ja, en },
          sortOrder: i,
        }) as const,
    ),
    ...LANGUAGES.map(
      ([id, ja, zh, en], i) =>
        ({
          id,
          kind: 'language' as const,
          nameOriginal: ja,
          name: { zh, ja, en },
          sortOrder: i,
        }) as const,
    ),
  ]

  for (const t of tags) {
    await db
      .insert(tag)
      .values(t)
      .onConflictDoUpdate({
        target: tag.id,
        set: {
          name: t.name,
          nameOriginal: t.nameOriginal,
          sortOrder: t.sortOrder,
        },
      })
  }

  console.log(
    `seeded: ${CATEGORIES.length} categories, ${tags.length} tags ` +
      `(${WORKS.length} works, ${CONVENTIONS.length} conventions, ${LANGUAGES.length} languages)`,
  )
}

await main()
