/**
 * 演示数据补充：同人游戏、汉化补丁、魔改版。
 *
 *   bun run seed:demo-fanworks
 *
 * 条目取自车万云（cloud.touhou.re）的「东方狗」分区目录，那里按
 * 同人游戏 / 补丁 / 游戏魔改 分类，是圈内实际的组织方式。
 *
 * 按平台规则做了过滤：**官方游戏、官方音乐、官方出版物、官方补丁一律不收**，
 * 只收同人二次创作。许可状态统一 unspecified——这些是社区流传的二创，
 * 没有任何一处写明允许再分发，如实标注才是这个字段的意义。
 *
 * 数据在此固化，重跑不需要登录那个网盘。
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
const HOST = 'https://cloud.touhou.re'
const BASE = '/国外分流2/东方狗/东方Project'

const link = (...segs: string[]) =>
  `${HOST}${[...BASE.split('/').filter(Boolean), ...segs]
    .map(encodeURIComponent)
    .map((s) => `/${s}`)
    .join('')}`

/** 同人 STG。全部是同人社团作品，非官方 */
const GAMES = [
  '东方光条阁',
  '东方夏夜祭',
  '东方幕华祭',
  '东方梦无垠',
  '东方梦旧市',
  '东方祈华梦',
  '东方花逐夜',
  '东方门殊钱',
  '东方雪莲华',
  '妖怪狐狸合战',
  '战斗天邪鬼',
  '方解梦异闻',
  '海鲜堂（东方邪星章制作组）',
  '雪晶石',
]

/** 补丁。已剔除「官方补丁」与官方游戏本体的重打包 */
const PATCHES: { name: string; note: string; tag?: string }[] = [
  {
    name: 'th175_beta1_win7修复补丁(非官方).zip',
    note: '非官方兼容性修复，让新作能在 Win7 上运行',
  },
  { name: 'win10红魔乡帧数补丁.zip', note: '修正红魔乡在 Win10 下的帧数问题' },
  { name: '红魔乡判定点补丁 (低速开启）.zip', note: '低速时显示自机判定点' },
  { name: '红魔乡判定点补丁 (改贴图).zip', note: '判定点贴图替换版' },
  { name: '红魔乡自机贴图更换.zip', note: '自机贴图替换' },
  {
    name: '鬼形兽汉化补丁（尝鲜版-含大量翻译错误）.zip',
    note: '社区汉化尝鲜版，译文尚未校对',
    tag: 'lang-zh',
  },
  { name: '鬼形兽爆分补丁.rar', note: '分数练习用补丁' },
]

/** 魔改版：基于官作的同人改造，属于二次创作 */
const MODS = [
  { name: '[th08] th08ultra(25倍弹幕).exe', note: '永夜抄 25 倍弹幕版' },
  {
    name: '[th08] 东方永夜抄 (魔改版)-ogg.zip',
    note: '永夜抄魔改版（OGG 音源）',
  },
  {
    name: '[th14] 东方天流宫×东方辉针城.zip',
    note: '辉针城 × 东方天流宫 联动魔改',
  },
  { name: '[th15] 车万相对论.rar', note: '绀珠传魔改' },
  {
    name: 'Subterranean Hatred 1.0(地灵殿PH) .zip',
    note: '地灵殿 Phantasmagoria 改造',
  },
  { name: 'th15东方励志传1.3.dat', note: '绀珠传魔改版' },
  { name: 'th18_八倍弹幕.dat', note: '虹龙洞 8 倍弹幕' },
  { name: '东方滑稽殿v1.1.rar', note: '地灵殿恶搞魔改' },
  { name: '随机天空璋.zip', note: '天空璋符卡随机化' },
  { name: '随机绀珠传.zip', note: '绀珠传符卡随机化' },
]

const slugify = (s: string) =>
  `${s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '')}-${Math.random().toString(36).slice(2, 8)}`

const LICENSE_NOTE =
  '社区流传的同人二次创作，未见作者对再分发的明确授权。如权利人有异议，请通过举报下架。'

type Entry = {
  title: string
  kind: 'game' | 'patch'
  category: string
  desc: string
  url: string
  tags: string[]
}

const entries: Entry[] = [
  ...GAMES.map(
    (n): Entry => ({
      title: n,
      kind: 'game',
      category: 'game',
      desc: '同人弹幕射击游戏。收录自社区镜像，社团与版本信息待补全。',
      url: link('同人游戏', 'STG', n),
      tags: ['lang-zh'],
    }),
  ),
  ...PATCHES.map(
    (p): Entry => ({
      title: p.name.replace(/\.(zip|rar|exe|dat)$/i, ''),
      kind: 'patch',
      category: 'patch',
      desc: p.note,
      url: link('补丁', p.name),
      tags: p.tag ? [p.tag] : [],
    }),
  ),
  ...MODS.map(
    (mod): Entry => ({
      title: mod.name.replace(/\.(zip|rar|exe|dat)$/i, ''),
      kind: 'game',
      category: 'game',
      desc: `${mod.note}。基于官方作品的同人改造。`,
      url: link('游戏魔改', mod.name),
      tags: [],
    }),
  ),
]

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
  for (const e of entries) {
    const [row] = await db
      .insert(resource)
      .values({
        slug: slugify(e.title),
        titleOriginal: e.title,
        titleOriginalLocale: 'zh',
        title: {},
        description: { zh: e.desc },
        kind: e.kind,
        categoryId: e.category,
        status: 'published',
        license: 'unspecified',
        licenseNote: LICENSE_NOTE,
        uploaderId: DEMO_USER,
      })
      .returning({ id: resource.id })
    if (!row) continue
    created++

    if (e.tags.length) {
      await db
        .insert(resourceTag)
        .values(e.tags.map((t) => ({ resourceId: row.id, tagId: t })))
        .onConflictDoNothing()
    }

    await db.insert(topic).values({
      kind: 'resource',
      resourceId: row.id,
      authorId: DEMO_USER,
      title: e.title,
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
      await db.insert(resourceFile).values({
        versionId: version.id,
        label: '车万云 · 东方狗',
        url: e.url,
        kind: 'netdisk',
        sortOrder: 0,
      })
    }
  }

  console.log(
    `导入 ${created} 条同人作品（${GAMES.length} 游戏 / ${PATCHES.length} 补丁 / ${MODS.length} 魔改，官方内容已排除）`,
  )
}

await main()
