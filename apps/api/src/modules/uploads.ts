import { type Context, Hono } from 'hono'
import { fail } from '../errors'
import { requireAuth } from '../middleware/require'
import type { Actor, AppEnv } from '../middleware/session'
import { isImagePurpose, MAX_IMAGE_BYTES, putImage } from '../storage'

/**
 * 上传限流：**进程内计数**，不建表。
 *
 * 上传没有记录表，而为它建一张表在 M4 没有第二个用途。进程内计数挡得住
 * 「一个账号几分钟内填满 MinIO」；挡不住多副本各算各的（现在只有一个 api 进程），
 * 也挡不住**换号刷**——注册即拿会话，靠 better-auth 内置的注册限流
 * （每 IP 10 秒 3 次）兜底，所以再按 IP 加一层更宽的窗。
 * IP 取自反代头（Cloudflare 的 cf-connecting-ip，其次 x-forwarded-for 首跳）；
 * **没有反代头时不按 IP 限**——那意味着直连，攻击者本来就能伪造这些头，
 * 而开发环境全部请求会挤进同一个桶。
 * **触发条件：出现第二个 api 副本，或第一次真实滥用**，到那时再换 Redis。
 */
export const UPLOAD_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 } as const
export const UPLOAD_LIMIT_IP = { max: 100, windowMs: 10 * 60 * 1000 } as const
const byActor = new Map<string, number[]>()
const byIp = new Map<string, number[]>()

type Limit = { readonly max: number; readonly windowMs: number }

function prune(
  map: Map<string, number[]>,
  key: string,
  limit: Limit,
  now: number,
) {
  const stamps = (map.get(key) ?? []).filter((t) => t > now - limit.windowMs)
  if (stamps.length === 0) map.delete(key)
  else map.set(key, stamps)
  return stamps
}

const retryAfter = (stamps: number[], limit: Limit, now: number) =>
  Math.max(1, Math.ceil(((stamps[0] ?? now) + limit.windowMs - now) / 1000))

/** 只判不记。记账在上传**成功**之后——被拒的请求（参数错、文件坏、超限）一律不占窗口 */
export function checkUploadLimit(
  actor: Actor,
  ip: string | null,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  // 与 rate.ts 同一条理由：站长要能连着传六篇引导帖的配图
  if (actor.role === 'moderator' || actor.role === 'admin') return { ok: true }

  const a = prune(byActor, actor.id, UPLOAD_LIMIT, now)
  if (a.length >= UPLOAD_LIMIT.max)
    return { ok: false, retryAfterSeconds: retryAfter(a, UPLOAD_LIMIT, now) }
  if (ip) {
    const i = prune(byIp, ip, UPLOAD_LIMIT_IP, now)
    if (i.length >= UPLOAD_LIMIT_IP.max)
      return {
        ok: false,
        retryAfterSeconds: retryAfter(i, UPLOAD_LIMIT_IP, now),
      }
  }
  return { ok: true }
}

export function stampUpload(actor: Actor, ip: string | null, now = Date.now()) {
  if (actor.role === 'moderator' || actor.role === 'admin') return
  prune(byActor, actor.id, UPLOAD_LIMIT, now).push(now)
  byActor.set(actor.id, byActor.get(actor.id) ?? [now])
  if (ip) {
    prune(byIp, ip, UPLOAD_LIMIT_IP, now).push(now)
    byIp.set(ip, byIp.get(ip) ?? [now])
  }
}

/** 测试用：窗口按 actor 清掉，别让上一条用例的计数漏进下一条 */
export const resetUploadWindow = (actorId?: string) => {
  if (actorId) byActor.delete(actorId)
  else {
    byActor.clear()
    byIp.clear()
  }
}

/** 反代给的客户端 IP；没有反代头就是 null（直连或开发环境） */
const clientIp = (c: Context<AppEnv>): string | null =>
  c.req.header('cf-connecting-ip')?.trim() ||
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
  null

/** multipart 的边界与字段头开销上限；超过它的请求体不可能装着一张合法大小的图 */
const MULTIPART_SLACK = 64 * 1024

/**
 * 图片上传。只服务封面、头像与帖子配图这类小图；大型资源用外链镜像，不经过这里。
 * 走 multipart 代理而非预签名——对象与响应在同一个请求里产生，
 * 失败即无痕，不会留下需要 GC 的孤儿。
 */
export const uploads = new Hono<AppEnv>().post(
  '/image',
  requireAuth,
  async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const ip = clientIp(c)

    /**
     * 限流与体积都判在 `parseBody()` **之前**。parseBody 会把整个 multipart
     * 读进内存；判在它之后等于让一个已经被 429 的客户端每次仍能塞给服务端
     * 一整包请求体再被拒——限流只限制了落桶次数，没限制带宽与内存。
     * content-length 缺失（chunked）时靠 index.ts 的 maxRequestBodySize 兜底。
     */
    const limit = checkUploadLimit(actor, ip)
    if (!limit.ok) {
      c.header('Retry-After', String(limit.retryAfterSeconds))
      return fail(c, 'rate_limited', 429)
    }
    const declared = Number(c.req.header('content-length'))
    if (
      Number.isFinite(declared) &&
      declared > MAX_IMAGE_BYTES + MULTIPART_SLACK
    )
      return fail(c, 'file_too_large', 413)

    const form = await c.req.parseBody()
    const file = form.file
    const purpose = form.purpose

    if (!(file instanceof File))
      return fail(c, 'validation_failed', 400, ['file'])
    /**
     * 白名单查表，未知值 400。上一版是二元三目 `=== 'avatar' ? 'avatar' : 'cover'`，
     * 未知值**静默变成 cover**——打错一个字，图就落进错误的前缀，
     * 走错误的宽限期，出现在错误的 GC 统计里。
     * parseBody 对重复字段给数组，所以这里必须是 typeof string 的判定。
     */
    if (!isImagePurpose(purpose))
      return fail(c, 'validation_failed', 400, ['purpose'])

    const result = await putImage(purpose, file)
    if (!result.ok) {
      if (result.reason === 'size') return fail(c, 'file_too_large', 413)
      return fail(c, 'validation_failed', 400, ['file'])
    }

    // 只有真的落了桶才记账
    stampUpload(actor, ip)
    return c.json({ url: result.url, key: result.key, size: result.size })
  },
)
