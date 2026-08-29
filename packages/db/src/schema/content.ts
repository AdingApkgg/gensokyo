import { TOPIC_KIND } from '@gensokyo/shared'
import { relations } from 'drizzle-orm'
import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { resource } from './kourindou'

export const topicKind = pgEnum('topic_kind', TOPIC_KIND)

/**
 * 讨论主题。这是产品文档第 1 号已批准决策的载体：
 * **资源评论区与论坛帖是同一份数据**，两个视图。
 *
 * M3 只用 kind='resource'（每个资源自动挂一个），M4 博丽神社加 kind='board'。
 * 推到 M4 再拆就要做数据迁移，所以第一天就建成这个形状。
 */
export const topic = pgTable(
  'topic',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: topicKind('kind').notNull(),
    /** kind='resource' 时指向资源，且一个资源只有一个主题 */
    resourceId: uuid('resource_id')
      .references(() => resource.id, { onDelete: 'cascade' })
      .unique(),
    /** kind='board' 时的版块（M4 用） */
    boardSlug: varchar('board_slug', { length: 32 }),
    title: varchar('title', { length: 200 }),
    authorId: text('author_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    postCount: integer('post_count').notNull().default(0),
    lastPostAt: timestamp('last_post_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('topic_board_last_post_idx').on(t.boardSlug, t.lastPostAt),
    index('topic_kind_idx').on(t.kind),
  ],
)

/**
 * 楼层。legacy 的 comments.parentId 是裸 integer 无外键，可以插入
 * 指向不存在 id 的孤儿回复——这里补上自引用外键。
 */
export const post = pgTable(
  'post',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topic.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    parentId: uuid('parent_id').references((): AnyPgColumn => post.id, {
      onDelete: 'set null',
    }),
    floor: integer('floor').notNull(),
    bodyMd: text('body_md').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('post_topic_floor_idx').on(t.topicId, t.floor),
    /** 并发发帖不能产生重复楼层 */
    uniqueIndex('post_topic_floor_uq').on(t.topicId, t.floor),
    index('post_author_idx').on(t.authorId),
  ],
)

export const topicRelations = relations(topic, ({ one, many }) => ({
  resource: one(resource, {
    fields: [topic.resourceId],
    references: [resource.id],
  }),
  author: one(user, { fields: [topic.authorId], references: [user.id] }),
  posts: many(post),
}))

export const postRelations = relations(post, ({ one }) => ({
  topic: one(topic, { fields: [post.topicId], references: [topic.id] }),
  author: one(user, { fields: [post.authorId], references: [user.id] }),
}))
