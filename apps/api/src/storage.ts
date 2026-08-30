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

export type ImagePurpose = 'cover' | 'avatar'

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

export async function deleteObject(key: string) {
  await s3().delete(key)
}
