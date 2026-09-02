import { describe, expect, test } from 'bun:test'
import {
  createPostSchema,
  createTopicSchema,
  markReadSchema,
  setHandleSchema,
} from './schemas'

describe('createPostSchema', () => {
  /**
   * 钉住 zod 的求值顺序：`.trim()` 必须在 `.min(1)` **之前**生效。
   * 顺序反了的话「   」是一条合法的帖子，论坛第一天就会有一堆空楼层。
   * 这依赖 zod 的内部行为，升级可能悄悄翻转——所以钉在测试里。
   */
  test('纯空白被拒，不是变成空串放进来', () => {
    expect(createPostSchema.safeParse({ bodyMd: '   ' }).success).toBe(false)
    expect(createPostSchema.safeParse({ bodyMd: '\n\n\t' }).success).toBe(false)
  })

  test('两端空白被剥掉，存进去的是 trim 后的值', () => {
    const r = createPostSchema.parse({ bodyMd: '  你好  ' })
    expect(r.bodyMd).toBe('你好')
  })

  test('中间的空白不动——代码块的缩进不能被吃掉', () => {
    const md = 'a\n\n    indented\n\nb'
    expect(createPostSchema.parse({ bodyMd: md }).bodyMd).toBe(md)
  })

  test('上限 20000 字，与 DB 的 post_body_len CHECK 同值', () => {
    expect(
      createPostSchema.safeParse({ bodyMd: 'a'.repeat(20000) }).success,
    ).toBe(true)
    expect(
      createPostSchema.safeParse({ bodyMd: 'a'.repeat(20001) }).success,
    ).toBe(false)
  })

  test('parentId 必须是 uuid（楼层是业务实体，不是用户 id）', () => {
    expect(
      createPostSchema.safeParse({ bodyMd: 'x', parentId: 'not-a-uuid' })
        .success,
    ).toBe(false)
  })

  test('locale 只收三语', () => {
    expect(createPostSchema.parse({ bodyMd: 'x', locale: 'ja' }).locale).toBe(
      'ja',
    )
    expect(
      createPostSchema.safeParse({ bodyMd: 'x', locale: 'ko' }).success,
    ).toBe(false)
  })
})

describe('createTopicSchema', () => {
  test('版块 slug 闭合六值——这是不建 board 表的全部依据', () => {
    const base = { title: 't', bodyMd: 'b' }
    expect(
      createTopicSchema.safeParse({ ...base, boardSlug: 'tea-house' }).success,
    ).toBe(true)
    expect(
      createTopicSchema.safeParse({ ...base, boardSlug: 'shrine' }).success,
    ).toBe(false)
    expect(
      createTopicSchema.safeParse({ ...base, boardSlug: 'tea-party' }).success,
    ).toBe(false)
  })

  test('标题也 trim 且不能为空白', () => {
    expect(
      createTopicSchema.safeParse({
        boardSlug: 'meta',
        title: '   ',
        bodyMd: 'b',
      }).success,
    ).toBe(false)
  })
})

describe('markReadSchema（XOR）', () => {
  /**
   * 必须是 z.object + refine，**不能是 z.union**：
   * union 在两个都给出时会静默走第一分支并把 upTo 剥掉，
   * 于是「全部已读」变成「只读了这几条」而前端毫不知情。
   *
   * 游标是通知 id 不是时间戳：created_at 微秒精度经 toISOString 截成毫秒后
   * `created_at <= before` 永远标不掉最新那条；且 PG 的 now() 是事务起点，
   * 点击前开始、点击后提交的通知会被误标。id 游标两个问题都没有。
   */
  const uuid = '0192f3c4-5678-7abc-9def-0123456789ab'
  const uuid2 = '0192f3c4-5678-7abc-9def-0123456789ac'

  test('只给 ids 通过', () => {
    expect(markReadSchema.safeParse({ ids: [uuid] }).success).toBe(true)
  })

  test('只给 upTo 通过，且必须是 uuid', () => {
    expect(markReadSchema.safeParse({ upTo: uuid }).success).toBe(true)
    expect(markReadSchema.safeParse({ upTo: 'not-a-uuid' }).success).toBe(false)
    // 时间戳不再是合法游标——这条钉住「别改回去」
    expect(
      markReadSchema.safeParse({ upTo: '2026-08-30T00:00:00Z' }).success,
    ).toBe(false)
  })

  test('两个都给 → 拒绝（不是静默丢掉一个）', () => {
    expect(markReadSchema.safeParse({ ids: [uuid], upTo: uuid2 }).success).toBe(
      false,
    )
  })

  test('一个都不给 → 拒绝', () => {
    expect(markReadSchema.safeParse({}).success).toBe(false)
  })

  test('ids 为空数组 → 拒绝（min 1）', () => {
    expect(markReadSchema.safeParse({ ids: [] }).success).toBe(false)
  })
})
describe('setHandleSchema', () => {
  test('保留字进不来', () => {
    expect(setHandleSchema.safeParse({ handle: 'admin' }).success).toBe(false)
  })

  test('合法 handle 通过', () => {
    expect(setHandleSchema.parse({ handle: 'reimu' }).handle).toBe('reimu')
  })
})
