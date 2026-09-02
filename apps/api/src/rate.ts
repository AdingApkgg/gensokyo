import { db, schema } from '@gensokyo/db'
import { hasExternalLink as hasExternalLinkIn } from '@gensokyo/shared'
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm'
import type { Actor } from './middleware/session'
import { publicBaseUrl } from './storage'

/**
 * 写操作限流。
 *
 * **用 SQL 数已有的行，不维护计数器。** 发帖和举报都有现成的表和
 * `(author_id, created_at)` 索引，直接数就是精确的：跨副本一致、
 * 进程重启不丢、没有需要同步维护的第二份状态。
 * 代价是每次写多一次 COUNT，而那条索引正是为它建的。
 *
 * 为什么必须有：`rate_limited` 这个错误码从 M3 起就存在但从没被抛出过。
 * 公网上一个开放的写端点上线第一天就会被扫——这与社区规模无关，
 * 和「等有人了再说」的其它功能不是一类。
 *
 * ⚠️ **已知限制一：先查后写，没有互斥。** N 个并发请求会同时读到 count=0，
 * 于是 N 条全部落库——冷却窗与小时配额都能被并发批量突破。要修得把计数与
 * 插入收进同一个事务并持 `pg_advisory_xact_lock(hashtext(actor_id))`，那要
 * 改动三个调用点的事务边界。
 *
 * ⚠️ **已知限制二：只数落库的行，失败的请求不进窗口。** 举报一个不存在的目标
 * 返回 404 且不写行，于是那条路径上限流从不生效——可以无限速地对任意 uuid
 * 发举报请求探测。要修得引入按 actor 计**请求数**的计数器（进程内或 Redis），
 * 那与「不维护第二份状态」这条取舍直接冲突，值不值得等有真实流量再定。
 * （它至少不构成存在性预言机：不可见目标一律 404，四种可见性组合同形。）
 *
 * 两条都挡不住并发扫描与探测，挡得住重复提交与顺序扫描。
 * 它们是**已知且写在这里**的取舍，不是没想到。
 */

/** 冷却窗：防连点与重复提交。比配额更早触发，给出的反馈也更直观 */
const COOLDOWN_SECONDS: Record<Bucket, number> = {
  post: 15,
  report: 15,
  /**
   * 编辑的冷却窗比发帖短得多：发完立刻发现笔误要能马上改。
   * 但**不能没有**——见下。
   */
  edit: 2,
}

/** 小时配额：正常人一小时发不了这么多，机器人一分钟就超 */
const HOURLY_QUOTA: Record<Bucket, number> = { post: 30, report: 10, edit: 120 }

/**
 * `edit` 单独成桶，而不是「编辑不限流」。
 *
 * 限流管的是**造内容的量**，不该管改错别字——所以编辑不占发帖配额。
 * 但把它实现成「跳过 assertRate」等于开了一个 requireAuth 之后毫无闸门的
 * 写端点，而 post_revision 表明确不建：一条帖子可以在被看见、被搜索引擎
 * 收录之后，以不受限的频率翻脸改成任意内容，且不留任何痕迹。
 * T6 把 @ 通知挂到编辑上之后，它还会直接变成通知炮台。
 */
export type Bucket = 'post' | 'report' | 'edit'

export type RateResult =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'quota'; retryAfterSeconds: number }

const since = (seconds: number) => new Date(Date.now() - seconds * 1000)

async function countSince(bucket: Bucket, actorId: string, from: Date) {
  const [row] =
    bucket === 'report'
      ? await db
          .select({ n: count() })
          .from(schema.report)
          .where(
            and(
              eq(schema.report.reporterId, actorId),
              gte(schema.report.createdAt, from),
            ),
          )
      : bucket === 'edit'
        ? /**
           * 编辑数的是 updatedAt（列上有 $onUpdate）。
           * `updatedAt > createdAt` 这条谓词**不能省**：插入时两者相等，
           * 少了它刚发的帖会把自己算成一次编辑，于是「发完立刻改错别字」
           * 又被挡住——那正是这个桶存在的理由所要避免的。
           */
          await db
            .select({ n: count() })
            .from(schema.post)
            .where(
              and(
                eq(schema.post.authorId, actorId),
                gte(schema.post.updatedAt, from),
                sql`${schema.post.updatedAt} > ${schema.post.createdAt}`,
                // 软删也会 bump updatedAt（$onUpdate），但那不是作者的编辑——
                // 否则 staff 删一层，作者就被算进自己的编辑冷却窗
                isNull(schema.post.deletedAt),
              ),
            )
        : await db
            .select({ n: count() })
            .from(schema.post)
            .where(
              and(
                eq(schema.post.authorId, actorId),
                gte(schema.post.createdAt, from),
              ),
            )
  return row?.n ?? 0
}

/**
 * staff 不限流：站长要能连着发六篇引导帖，版主要能连着处理举报。
 * 这与外链禁令的 staff 短路是同一条理由。
 */
export async function assertRate(
  actor: Actor,
  bucket: Bucket,
): Promise<RateResult> {
  if (actor.role === 'moderator' || actor.role === 'admin') return { ok: true }

  const cooldown = COOLDOWN_SECONDS[bucket]
  if ((await countSince(bucket, actor.id, since(cooldown))) > 0) {
    return { ok: false, reason: 'cooldown', retryAfterSeconds: cooldown }
  }
  if (
    (await countSince(bucket, actor.id, since(3600))) >= HOURLY_QUOTA[bucket]
  ) {
    return { ok: false, reason: 'quota', retryAfterSeconds: 3600 }
  }
  return { ok: true }
}

/**
 * 能不能发站外链接。
 *
 * 冷启动期的默认值是**先放开、出事再收紧**——与资源侧「先审后发」相反是对的，
 * 因为帖子可删而资源分发不可撤。门槛走独立的 `linkTrustThreshold`：
 * 与 autoPublishThreshold 共用一个 key 的话，这个「相反」表达不出来。
 *
 * ⚠️ `accountAgeDays` 的基准是 `user_profile.createdAt`——那是**首次带会话
 * 访问 API 的时间**，不是注册时间（profile 由 sessionMiddleware 惰性创建）。
 * 对「注册完立刻发广告」这个实际要防的行为来说，两者等价。
 */
const LINK_MIN_ACCOUNT_AGE_DAYS = 3

export function canPostLinks(actor: Actor, approvedThreshold: number): boolean {
  // staff 短路：否则站长发不出自己写的引导帖
  if (actor.role === 'moderator' || actor.role === 'admin') return true
  if (actor.strikeCount > 0) return false
  if (actor.approvedResourceCount >= approvedThreshold) return true
  const ageDays =
    (Date.now() - actor.createdAt.getTime()) / (24 * 60 * 60 * 1000)
  return ageDays >= LINK_MIN_ACCOUNT_AGE_DAYS
}

/**
 * 本站自己的 origin。命中它们的链接算站内——否则用户走完整条上传流程、
 * 拿到自建 MinIO 的图片 URL、贴进正文，会收到「新账号不能发站外链接」，
 * 而他发的是站内的。
 */
function ownOrigins(): string[] {
  const out: string[] = []
  for (const raw of [process.env.BETTER_AUTH_URL, publicBaseUrl()]) {
    if (!raw) continue
    try {
      out.push(new URL(raw).origin)
    } catch {
      // 配错了就当没有：宁可把本站链接误判成站外，也不要因为解析失败放行全部
    }
  }
  return out
}

/**
 * 正文里有没有站外链接。
 *
 * 判定跑在 mdast 上而不是正则上——见 shared/shrine/link.ts 里那张表：
 * 上一版 `\bhttps?:\/\/` 漏掉的写法比它认得的还多，而绕过成本是删五个字符。
 */
export const hasExternalLink = (bodyMd: string) =>
  hasExternalLinkIn(bodyMd, ownOrigins())
