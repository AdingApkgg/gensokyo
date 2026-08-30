import { NOTIFICATION_KIND } from '@gensokyo/shared'
import { desc, relations, sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { post, topic } from './content'
import { resource } from './kourindou'

export const notificationKind = pgEnum('notification_kind', NOTIFICATION_KIND)

/**
 * 通知。**一张宽表 + 写扇出 + 行级 read_at**。
 *
 * 不做 event + inbox 两张表：per-user 的已读状态无论如何要占一行，
 * 侧表只省下几十字节，却给全站最热的读路径（收件箱）多加一次 join。
 *
 * 不做折叠（collapse_key / count / 部分唯一索引 / upsert arbiter）：
 * 折叠的成本收益完全由扇出规模决定，而扇出的全部规模来自订阅。
 * M4 没有订阅表——收件人从 topic.authorId / resource.uploaderId 推出，
 * 一次回复产生 ≤2 行通知，不会变成垃圾场。补做时旧行的 collapse_key
 * 为 NULL，而 NULL≠NULL 使存量数据天然兼容，是教科书级 additive。
 */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 收件箱是私有数据，随人走 */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 「你曾被回复过」不该因为对方注销就消失 */
    actorId: text('actor_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    kind: notificationKind('kind').notNull(),

    // ---- subject 是类型化的可空外键 ----
    topicId: uuid('topic_id').references(() => topic.id, {
      onDelete: 'cascade',
    }),
    postId: uuid('post_id').references(() => post.id, { onDelete: 'cascade' }),
    /**
     * ⚠️ **kind='resource_deleted' 绝不能带这个外键。**
     * 硬删会在同一个事务里顺着它把通知自己级联删掉，于是作者永远收不到
     * 「你的资源被删除了」——而**症状是「什么都没发生」**，没有报错、
     * 没有日志、没有残留。唯一能发现它的方式是 e2e：
     * purge 之后断言那条通知**仍然存在**。
     * purge 类通知只在 payload.title 里存标题快照。
     */
    resourceId: uuid('resource_id').references(() => resource.id, {
      onDelete: 'cascade',
    }),

    /** 被删对象的标题快照等——只在没有外键可指时使用 */
    payload: jsonb('payload'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('notification_user_created_idx').on(t.userId, desc(t.createdAt)),
    /**
     * 部分索引：未读数走它，随阅读自然缩小，是自愈的。
     * **不做反范式计数器**——那要在五处同步维护，漏一处就永久漂移。
     */
    index('notification_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
  ],
)

export const notificationRelations = relations(notification, ({ one }) => ({
  recipient: one(user, {
    fields: [notification.userId],
    references: [user.id],
  }),
  topic: one(topic, {
    fields: [notification.topicId],
    references: [topic.id],
  }),
  post: one(post, { fields: [notification.postId], references: [post.id] }),
}))
