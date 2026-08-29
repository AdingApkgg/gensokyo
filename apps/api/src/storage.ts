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
let publicBase = ''

function s3() {
  if (!client) {
    const c = cfg()
    publicBase = c.S3_PUBLIC_BASE_URL.replace(/\/$/, '')
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

/** 只收这几种图片；键是扩展名，值是文件头魔数 */
const IMAGE_TYPES: Record<string, { ext: string; magic: number[][] }> = {
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { ext: 'webp', magic: [[0x52, 0x49, 0x46, 0x46]] }, // RIFF
  'image/avif': { ext: 'avif', magic: [[0x00, 0x00, 0x00]] }, // ftyp box 长度前缀
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export type ImagePurpose = 'cover' | 'avatar'

/** Content-Type 可以伪造，所以核对文件头 */
function sniff(bytes: Uint8Array, contentType: string) {
  const spec = IMAGE_TYPES[contentType]
  if (!spec) return false
  return spec.magic.some((sig) => sig.every((b, i) => bytes[i] === b))
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

  return { ok: true, url: `${publicBase}/${key}`, key, size: buf.byteLength }
}

/** GC 用：判断一个 URL 是否指向我们自己的桶 */
export function isManagedUrl(url: string) {
  return publicBase !== '' && url.startsWith(`${publicBase}/`)
}

export async function deleteObject(key: string) {
  await s3().delete(key)
}
