import { S3Client } from 'bun'
import { z } from 'zod'

/**
 * 自建 MinIO，只存小图（封面、社团头像）。
 *
 * 大型资源走外链镜像——托管 GB 级同人游戏既贵又有版权风险，
 * 而封面外链（热链网盘图）根本不可靠，所以只自托管这一半。
 *
 * 小文件**经 API 代理上传**而非预签名直传：几 MB 的带宽成本可以忽略，
 * 换来的是对象与数据库行在同一个请求里创建——没有 upload_intent 表、
 * 没有核销逻辑、没有越权挂载他人对象的洞、没有孤儿对象。
 */
const cfg = () =>
  z
    .object({
      S3_ENDPOINT: z.url(),
      S3_REGION: z.string().min(1).default('us-east-1'),
      S3_ACCESS_KEY_ID: z.string().min(1),
      S3_SECRET_ACCESS_KEY: z.string().min(1),
      S3_BUCKET: z.string().min(1),
      /** 对外读取的基地址，dev 是 MinIO 自己，prod 由 Caddy 反代 */
      S3_PUBLIC_BASE_URL: z.url(),
    })
    .parse(process.env)

let client: S3Client | undefined

/** 独立求值，不依赖 s3() 是否被调用过——GC 的白名单谓词依赖它 */
export const publicBaseUrl = () =>
  (process.env.S3_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')

function s3() {
  if (!client) {
    const c = cfg()
    client = new S3Client({
      endpoint: c.S3_ENDPOINT,
      region: c.S3_REGION,
      accessKeyId: c.S3_ACCESS_KEY_ID,
      secretAccessKey: c.S3_SECRET_ACCESS_KEY,
      bucket: c.S3_BUCKET,
    })
  }
  return client
}

const ascii = (b: Uint8Array, at: number, s: string) =>
  [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0))

/**
 * 只收这几种图片，逐类按真实结构判定。
 *
 * 之前 webp 只查 'RIFF'（wav/avi 同头）、avif 查「前三字节为零」——
 * 等于任何 ≤5MB 文件都能过，把站点变成匿名网盘。
 */
const IMAGE_TYPES: Record<
  string,
  { ext: string; ok: (b: Uint8Array) => boolean }
> = {
  'image/jpeg': {
    ext: 'jpg',
    ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/png': {
    ext: 'png',
    ok: (b) =>
      b[0] === 0x89 && ascii(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a,
  },
  // RIFF....WEBP：必须同时命中头尾两段
  'image/webp': {
    ext: 'webp',
    ok: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  },
  // ISO-BMFF：4 字节 box 长度 + 'ftyp' + 品牌以 'avif'/'avis' 开头
  'image/avif': {
    ext: 'avif',
    ok: (b) =>
      ascii(b, 4, 'ftyp') && (ascii(b, 8, 'avif') || ascii(b, 8, 'avis')),
  },
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * 上传用途白名单。**它同时是对象 key 的第一段**（`<purpose>/<uuid>.<ext>`），
 * 所以这个数组是 key 文法的一部分——GC 的正则从它派生，别在别处再抄一份。
 *
 * `post`：帖子正文里的图。宽限期比封面长（见 gc-images），因为草稿被设计成
 * 跨天存活而图片是立即落桶的。
 */
export const IMAGE_PURPOSES = ['cover', 'avatar', 'post'] as const
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number]

export const isImagePurpose = (v: unknown): v is ImagePurpose =>
  typeof v === 'string' && (IMAGE_PURPOSES as readonly string[]).includes(v)

/** Content-Type 可以伪造，所以核对文件头 */
function sniff(bytes: Uint8Array, contentType: string) {
  const spec = IMAGE_TYPES[contentType]
  if (!spec || bytes.length < 16) return false
  return spec.ok(bytes)
}

export type PutImageResult =
  | { ok: true; url: string; key: string; size: number }
  | { ok: false; reason: 'type' | 'size' | 'corrupt' }

export async function putImage(
  purpose: ImagePurpose,
  file: File,
): Promise<PutImageResult> {
  const spec = IMAGE_TYPES[file.type]
  if (!spec) return { ok: false, reason: 'type' }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'size' }
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  if (!sniff(buf, file.type)) return { ok: false, reason: 'corrupt' }

  // 随机键名：防枚举，也避免同名覆盖
  const key = `${purpose}/${Bun.randomUUIDv7()}.${spec.ext}`
  await s3().write(key, buf, { type: file.type })

  return {
    ok: true,
    url: `${publicBaseUrl()}/${key}`,
    key,
    size: buf.byteLength,
  }
}

/** GC 用：判断一个 URL 是否指向我们自己的桶 */
export function isManagedUrl(url: string) {
  const base = publicBaseUrl()
  return base !== '' && url.startsWith(`${base}/`)
}

export const escapeRegExp = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 对象 key 的完整文法，**锚死**，不多吃一个字符。
 *
 * key 是上面 putImage 自己生成的：`<purpose>/<uuidv7>.<ext>`，三段的取值
 * 都是我们定的，所以这里可以写成精确文法而不是「像 URL 的东西」。
 *
 * 为什么必须锚死：GC 的白名单装的是 key，判定是**精确字符串相等**。
 * 从 Markdown `![](https://…/post/xxx.webp)` 里用宽松正则抽 URL，多吃一个
 * 闭括号，派生出来的 key 就是 `post/xxx.webp)`——桶里那个叫 `post/xxx.webp`，
 * `has()` 为 false，**过了宽限期这张正在用的图被精确删掉**。熔断挡不住：
 * 封面都还在，白名单远非空集。「多匹配一点是安全方向」这个直觉在这里是反的。
 *
 * uuidv7 是 36 位 `[0-9a-f-]`；扩展名从 IMAGE_TYPES 派生，加一种图片格式
 * 不用回来改这里。
 */
export function managedKeyPattern(base: string): RegExp {
  const exts = [...new Set(Object.values(IMAGE_TYPES).map((t) => t.ext))]
  return new RegExp(
    `${escapeRegExp(base)}/(?:${IMAGE_PURPOSES.join('|')})/[0-9a-f-]{36}\\.(?:${exts.join('|')})(?![0-9a-z])`,
    // 不加 i：key 是我们自己生成的小写；大写的「同名」在 S3 里是另一个不存在的对象
    'g',
  )
}

/**
 * **不带 base 前缀**的 key 文法：`<任意前缀>/<purpose>/<uuid>.<ext>`。
 * 捕获组 1 是前缀（scheme + host + 路径），GC 用它侦测「长得像我们的对象、
 * 但挂在别的 base 下」的引用——换域名 / 上 CDN / 改桶名之后没迁移存量 URL，
 * 就是这个形状。那时按当前 base 派生的白名单会把所有老图判成无引用，
 * 两道熔断都看不见（它们只看「当前 base 下」的引用），宽限期一过老图整批被删。
 */
export function bareKeyPattern(): RegExp {
  const exts = [...new Set(Object.values(IMAGE_TYPES).map((t) => t.ext))]
  return new RegExp(
    `(https?://[^\\s()<>"']+?)/(?:${IMAGE_PURPOSES.join('|')})/[0-9a-f-]{36}\\.(?:${exts.join('|')})(?![0-9a-z])`,
    'g',
  )
}

/**
 * 从一段自由文本（Markdown 正文、公告 jsonb 里的字符串）里抽出本站对象 key。
 * 只返回 key（`post/….webp`），不返回整条 URL——白名单存的就是 key。
 */
export function extractManagedKeys(text: string, base: string): string[] {
  if (!base || !text) return []
  const out: string[] = []
  for (const m of text.matchAll(managedKeyPattern(base))) {
    out.push(m[0].slice(base.length + 1))
  }
  return out
}

export async function deleteObject(key: string) {
  await s3().delete(key)
}
