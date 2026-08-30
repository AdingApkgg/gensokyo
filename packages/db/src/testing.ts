import { inArray } from 'drizzle-orm'
import { db } from './client'
import * as schema from './schema'

/**
 * 测试残留清理。
 *
 * 测试打的是共享的开发库，不是一次性容器。不收尾的话每跑一次就多十几个
 * 账号和资源：跑到第二十次时 /dash/users 里全是 `kr-1788…@example.com`，
 * 站长找不到真人；`select count(*) from resource` 也不再说明任何事情。
 *
 * 账号和资源必须分开记、且**先删资源再删账号**。
 * resource.uploader_id 是 `set null` 而不是 cascade（投稿者注销不该带走
 * 他传过的资源），所以顺序反了资源就会先变成没有主人的孤儿行，
 * 污染只是从 user 表挪到了 resource 表。
 *
 * 用法：测试文件里 `afterAll(cleanupTracked)`，建对象时套一层 track。
 */
const users: string[] = []
const resources: string[] = []
const topics: string[] = []

export function trackUser(id: string | undefined): string {
  if (id) users.push(id)
  return id as string
}

export function trackResource<T extends { id: string }>(r: T): T {
  resources.push(r.id)
  return r
}

/**
 * 只用于直接建的**版块**主题。资源主题不用记：它随 resource 级联删。
 */
export function trackTopic(id: string): string {
  topics.push(id)
  return id
}

export async function cleanupTracked() {
  // 版块主题不挂在任何资源下，删资源带不走它们
  if (topics.length > 0) {
    await db
      .delete(schema.topic)
      .where(inArray(schema.topic.id, topics.splice(0)))
  }
  if (resources.length > 0) {
    await db
      .delete(schema.resource)
      .where(inArray(schema.resource.id, resources.splice(0)))
  }
  if (users.length > 0) {
    // user_profile 级联删；moderation_log.actor_id 是 set null，
    // 审计记录本身活下来——这正是那条外键要的行为。
    await db.delete(schema.user).where(inArray(schema.user.id, users.splice(0)))
  }
}
