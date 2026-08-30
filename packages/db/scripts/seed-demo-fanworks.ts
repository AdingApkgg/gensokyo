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
} from '../src/schema'
import {
  createResourceTopic,
  ensureSeedUser,
  seedHandle,
} from './_shared/create-resource-topic'

const DEMO_USER = 'demo-importer'
/**
 * 两个镜像存的是同一棵「东方狗」目录树（莉莉云的存储由车万云提供），
 * 但可达性不同：
 *
 * - **莉莉云**走公开分享链接，免登录，路径已逐条对着分享索引核实存在
 * - **车万云**要注册登录才能看到内容，但同人游戏只有它那边有
 *   （莉莉云的 /同人游戏 是空的——它的 readme 写明这部分不转存）
 *
 * 所以补丁与魔改走莉莉云，同人游戏走车万云。
 */
const LILY_SHARE = 'https://cloud.lilywhite.cc/s/4ZUW'
const TOUHOU_HOST = 'https://cloud.touhou.re'
const TOUHOU_BASE = '/国外分流2/东方狗/东方Project'

/** 莉莉云：分享链接 + path 查询参数 */
const lilyLink = (...segs: string[]) =>
  `${LILY_SHARE}?path=${encodeURIComponent(`/东方Project/${segs.join('/')}`)}`

/** 车万云：路径直接进 URL */
const link = (...segs: string[]) =>
  `${TOUHOU_HOST}${[...TOUHOU_BASE.split('/').filter(Boolean), ...segs]
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
/**
 * 魔改作品。**只收补丁式的，不收整包。**
 *
 * 实测镜像上这批文件的体积泾渭分明：补丁式改造器不足 7MB（要你自己有正版
 * 才能用），而「魔改版」整包是 22–655MB——那里面装着官方本体。
 * 收后者等于分发官方游戏，踩产品文档第一条生死线与站规第一条第 1 项。
 * 被排除的：永夜抄魔改版(80/655MB)、天流宫×辉针城(493MB)、随机天空璋/绀珠传
 * (各 71MB)、励志传(74MB)、八倍弹幕(112MB)、滑稽殿(22MB)、地灵殿PH(59MB)。
 */
const MODS = [
  {
    name: '[th08] th08ultra(25倍弹幕).exe',
    note: '永夜抄 25 倍弹幕版。补丁式，需自备正版',
  },
  { name: '[th15] randomD.exe', note: '绀珠传符卡随机化。补丁式，需自备正版' },
  { name: '[th15] 车万相对论.rar', note: '绀珠传魔改。补丁式，需自备正版' },
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
      url: lilyLink('补丁', p.name),
      tags: p.tag ? [p.tag] : [],
    }),
  ),
  ...MODS.map(
    (mod): Entry => ({
      title: mod.name.replace(/\.(zip|rar|exe|dat)$/i, ''),
      kind: 'game',
      category: 'game',
      desc: `${mod.note}。基于官方作品的同人改造。`,
      url: lilyLink('游戏魔改', mod.name),
      tags: [],
    }),
  ),
]

async function main() {
  await ensureSeedUser({
    id: DEMO_USER,
    name: '编目机器人',
    email: 'demo-importer@example.invalid',
    handle: seedHandle(DEMO_USER),
  })

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

    await createResourceTopic(row.id, DEMO_USER)

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
