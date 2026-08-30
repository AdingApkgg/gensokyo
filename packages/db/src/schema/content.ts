import { BOARD_SLUGS, TOPIC_KIND } from '@gensokyo/shared'
import { desc, relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  check,
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
 * 从 BOARD_SLUGS 派生，不在 SQL 里再抄一遍——两处各写一遍必然漂移。
 *
 * ⚠️ 必须用 `sql.raw` 内联字面量。写成 `sql`${s}`` 的话 drizzle-kit 会把它
 * 参数化成 `$1, $2, …`，而 **DDL 不能用绑定参数**——生成的迁移一跑就报
 * 「there is no parameter $1」。值来自本仓的编译期常量，不是用户输入。
 */
const sqlLiteralList = (values: readonly string[]) =>
  sql.raw(
    values
      .map((v) => {
        // 常量里出现引号说明有人把它改成了不该内联的东西，宁可在构建期炸
        if (/['\\]/.test(v)) throw new Error(`不可内联的字面量: ${v}`)
        return `'${v}'`
      })
      .join(', '),
  )

/**
 * 讨论主题。这是产品文档第 1 号已批准决策的载体：
 * **资源评论区与论坛帖是同一份数据**，两个视图。
 *
 * M3 只用 kind='resource'（每个资源自动挂一个），M4 加 kind='board'。
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
    /** kind='board' 时的版块 */
    boardSlug: varchar('board_slug', { length: 32 }),
    /**
     * kind='resource' 时**恒为 NULL**。
     * M3 曾在这里存资源标题的快照，那是错的：快照不随资源 PATCH 更新，
     * 而且它是单语的——资源标题本身是 titleOriginal + 三语 jsonb 一束。
     * 资源主题的标题一律从 resource 现取。
     */
    title: varchar('title', { length: 200 }),
    authorId: text('author_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /**
     * 楼层**序列**，不是计数：软删的楼层保留占位，所以它只增不减。
     *
     * 旧名 postCount 邀请人写 `- 1` 去「修正」它。真写了的话该主题的
     * 下一次发帖会拿到一个已被占用的楼层号，撞 post_topic_floor_uq，
     * 而 createPost 的 catch 把它报成「主题不存在」——那个主题从此永久
     * 发不出帖，错误信息还指向错误的方向。
     */
    floorSeq: integer('floor_seq').notNull().default(0),
    /** 承载六篇引导帖。**无写端点**——置顶由 seed 或一条 SQL 完成 */
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    /**
     * NOT NULL：PG 的 `ORDER BY ... DESC` 默认 NULLS FIRST，
     * 可空的话每一个还没有回复的新主题都会永远排在最新流的最前面。
     */
    lastPostAt: timestamp('last_post_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * 全站最新流与版块页共用同一条排序键：置顶进排序，不抽出流外。
     *
     * ⚠️ **`nulls last` 必须写出来。** PG 的 `DESC` 默认 NULLS FIRST，而路由
     * 要的是 `pinned_at desc nulls last`（否则每条没置顶的主题都排在最前）。
     * 两者 null 位置不同时 PG **根本不会**把这条索引用于该排序——不是代价
     * 选择问题。上一版就是这样，它是一条谁也用不上的死索引，而它是论坛门面页
     * 的排序索引。末列的 `id desc` 与路由的唯一性兜底对齐。
     */
    index('topic_latest_idx').on(
      sql`${t.pinnedAt} desc nulls last`,
      sql`${t.lastPostAt} desc`,
      sql`${t.id} desc`,
    ),
    index('topic_board_last_post_idx').on(t.boardSlug, desc(t.lastPostAt)),
    index('topic_author_idx').on(t.authorId),
    /**
     * 两种 kind 的形状是互斥的，交给 DB 兜底：
     * 资源主题不许有 title（见上），版块主题必须有 title 与 boardSlug。
     */
    check(
      'topic_kind_shape',
      /**
       * 两个分支都要**闭合**，否则「互斥」只写了一半：上一版 board 分支对
       * resource_id 只字未提，于是一条同时带 title 与 resource_id 的行是合法的。
       * 那种行的后果是复合的——GET /topics 同时返回非 null 的 title 和 resource
       * （前端两条渲染分支同时命中）、visibleTopicWhere 会按资源可见性判定它
       * （资源一下架这条**版块**讨论静默消失）、而 DELETE /topics/:id 又因为
       * `resourceId !== null` 给它 409：谁也删不掉。
       */
      sql`(${t.kind} = 'resource' AND ${t.title} IS NULL AND ${t.resourceId} IS NOT NULL AND ${t.boardSlug} IS NULL)
       OR (${t.kind} = 'board' AND ${t.title} IS NOT NULL AND ${t.boardSlug} IS NOT NULL AND ${t.resourceId} IS NULL)`,
    ),
    /**
     * 版块白名单。**这条 CHECK 代替了一整张 board 表**——
     * 外键的目标行也只能从 BOARD_SLUGS seed，挡不住常量本身写错，
     * 而 CHECK 给出同等的 DB 层保证，零表零 join。
     */
    check(
      'topic_board_slug',
      sql`${t.boardSlug} IS NULL OR ${t.boardSlug} IN (${sqlLiteralList(BOARD_SLUGS)})`,
    ),
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
    /**
     * 只用于渲染时的 `<div lang=>`。不做筛选、不显示语言徽章——
     * 短回复上 zh/ja 的纯汉字检测几乎必错，标错的徽章比没有更糟。
     * 它修的是一个今天就存在的显示错误：日文帖被按中文字形渲染。
     */
    locale: varchar('locale', { length: 5 }),
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
    /** 并发发帖不能产生重复楼层 */
    uniqueIndex('post_topic_floor_uq').on(t.topicId, t.floor),
    /** 限流要按 (作者, 时间) 倒序查最近几条 */
    index('post_author_idx').on(t.authorId, desc(t.createdAt)),
    /** legacy 缺 DB 层上限，与 createPostSchema 的 20000 同值 */
    check('post_body_len', sql`char_length(${t.bodyMd}) BETWEEN 1 AND 20000`),
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
