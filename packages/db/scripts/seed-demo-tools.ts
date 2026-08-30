/**
 * 演示数据补充：开源同人工具与补丁。
 *
 *   bun run seed:demo-tools
 *
 * 与专辑那批的关键区别是**许可状态是 allowed 而非 unspecified**——
 * 这几个项目本身就是开源、公开分发的，链接直接指向作者的官方发布页。
 * 这样界面上四档许可徽章才都有真实样本，而不是清一色的警示红。
 *
 * 刻意不收录的：官方游戏本体（平台规则），以及 Steam 上在售的商业同人游戏
 * （夜雀食堂、Luna Nights 之类）——那些是卖钱的作品，不该出现在分发站。
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

const ITEMS = [
  {
    slug: 'thcrap',
    titleOriginal: 'Touhou Community Reliant Automatic Patcher',
    locale: 'en',
    title: {
      zh: '东方社区自动补丁器 thcrap',
      ja: '東方コミュニティ自動パッチャー',
    },
    kind: 'patch' as const,
    category: 'patch',
    circle: 'Touhou Patch Center',
    desc: {
      zh: '社区维护的自动翻译补丁框架，支持官作全系列的多语言化，补丁内容由社区在线协作维护。开源项目，自由分发。',
      en: 'Community-maintained auto-patcher that layers multilingual translations onto the official games. Open source, freely redistributable.',
    },
    license: 'allowed' as const,
    licenseNote: '开源项目，作者允许自由分发。',
    tags: ['lang-zh', 'lang-ja', 'lang-en'],
    files: [
      {
        label: 'GitHub Releases',
        url: 'https://github.com/thpatch/thcrap/releases',
        kind: 'direct' as const,
      },
      {
        label: '官方站点',
        url: 'https://www.thpatch.net/',
        kind: 'direct' as const,
      },
    ],
  },
  {
    slug: 'danmakufu-ph3',
    titleOriginal: '東方弾幕風 ph3',
    locale: 'ja',
    title: { zh: '东方弹幕风 ph3', en: 'Touhou Danmakufu ph3' },
    kind: 'tool' as const,
    category: 'tool',
    circle: '一叶',
    desc: {
      zh: '同人圈使用最广的弹幕游戏制作引擎，用自有脚本语言编写符卡与弹幕。大量同人 STG 基于它开发。',
      ja: '同人STG制作で最も広く使われている弾幕エンジン。専用スクリプトでスペルカードを記述する。',
    },
    license: 'allowed' as const,
    licenseNote: '作者公开发布，允许自由分发。',
    tags: ['lang-ja'],
    files: [
      {
        label: 'ph3sx 社区维护版',
        url: 'https://github.com/WishMakers0/Danmakufu-ph3sx/releases',
        kind: 'direct' as const,
      },
    ],
  },
  {
    slug: 'touhou-danmaku-kagura-tools',
    titleOriginal: 'Touhou Toolkit (thtk)',
    locale: 'en',
    title: { zh: '东方文件格式工具集 thtk' },
    kind: 'tool' as const,
    category: 'tool',
    circle: 'thtk contributors',
    desc: {
      zh: '解包与重打包官作资源文件（.dat / .anm / .std / .ecl）的命令行工具集，汉化组与研究者常用。开源。',
      en: 'Command-line tools for unpacking and rebuilding the games’ archive formats. Used by translation groups and researchers.',
    },
    license: 'allowed' as const,
    licenseNote: '开源项目，允许自由分发。',
    tags: ['lang-en'],
    files: [
      {
        label: 'GitHub Releases',
        url: 'https://github.com/thpatch/thtk/releases',
        kind: 'direct' as const,
      },
    ],
  },
  {
    slug: 'gensokyo-radio-archive',
    titleOriginal: 'Gensokyo Radio',
    locale: 'en',
    title: { zh: '幻想乡电台', ja: '幻想郷ラジオ' },
    kind: 'tool' as const,
    category: 'tool',
    circle: 'Gensokyo Radio',
    desc: {
      zh: '英文圈长期运营的东方同人音乐 24 小时电台，提供公开 API 可查询当前曲目。此条目仅作为外部服务索引收录。',
      en: 'A long-running 24/7 Touhou doujin music stream with a public now-playing API. Indexed here as an external service.',
    },
    license: 'licensed' as const,
    licenseNote: '外部服务索引，非文件分发。',
    tags: ['lang-en'],
    files: [
      {
        label: '官方站点',
        url: 'https://gensokyoradio.net/',
        kind: 'direct' as const,
      },
    ],
  },
]

async function main() {
  await ensureSeedUser({
    id: DEMO_USER,
    name: '编目机器人',
    email: 'demo-importer@example.invalid',
    handle: seedHandle(DEMO_USER),
  })

  let created = 0
  for (const it of ITEMS) {
    const [row] = await db
      .insert(resource)
      .values({
        slug: it.slug,
        titleOriginal: it.titleOriginal,
        titleOriginalLocale: it.locale,
        title: it.title,
        description: it.desc,
        kind: it.kind,
        categoryId: it.category,
        status: 'published',
        license: it.license,
        licenseNote: it.licenseNote,
        circleNameRaw: it.circle,
        uploaderId: DEMO_USER,
      })
      .onConflictDoNothing()
      .returning({ id: resource.id })

    if (!row) continue
    created++

    await db
      .insert(resourceTag)
      .values(it.tags.map((t) => ({ resourceId: row.id, tagId: t })))
      .onConflictDoNothing()

    await createResourceTopic(row.id, DEMO_USER)

    const [version] = await db
      .insert(resourceVersion)
      .values({
        resourceId: row.id,
        label: 'latest',
        changelog: '指向作者官方发布页，随上游更新',
        isLatest: 1,
      })
      .returning({ id: resourceVersion.id })

    if (version) {
      await db.insert(resourceFile).values(
        it.files.map((f, i) => ({
          versionId: version.id,
          label: f.label,
          url: f.url,
          kind: f.kind,
          sortOrder: i,
        })),
      )
    }
  }

  console.log(`导入 ${created} 条开源工具/补丁（许可状态：明示允许）`)
}

await main()
