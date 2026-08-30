import { db, schema } from '@gensokyo/db'
import {
  type SiteConfigKey,
  TRUST_AUTO_PUBLISH_THRESHOLD,
} from '@gensokyo/shared'

/**
 * 站点配置的读取。
 *
 * 配置改动罕见而读取频繁（每次投稿都要查即发即审门槛），所以在进程内缓存，
 * 由写入端显式失效。多进程部署时各进程的缓存最多陈旧到下一次 TTL——
 * 配置项都不是安全边界，这个代价可以接受。
 */
const TTL_MS = 60_000
let cache: Record<string, unknown> | null = null
let loadedAt = 0

export function invalidateConfig() {
  cache = null
}

async function load() {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache
  const rows = await db.select().from(schema.siteConfig)
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  loadedAt = Date.now()
  return cache
}

export async function configValue<T>(
  key: SiteConfigKey,
  fallback: T,
): Promise<T> {
  const all = await load()
  const v = all[key]
  return v === undefined || v === null ? fallback : (v as T)
}

/** 即发即审门槛：配置没设时回落到编译期常量 */
export const autoPublishThreshold = () =>
  configValue('autoPublishThreshold', TRUST_AUTO_PUBLISH_THRESHOLD)

export const registrationOpen = () => configValue('registrationOpen', true)
