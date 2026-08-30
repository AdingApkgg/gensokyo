import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from './client'
import * as schema from './schema'

/**
 * TS 枚举与 PG 枚举必须逐值一致。
 *
 * 这组测试的由来：M4 T1 给 REPORT_REASON 加了 spam / harassment 两个值，
 * 但 report_reason 是 pgEnum 而那次改动没有带迁移。结果是 zod 放行、
 * Postgres 抛 22P02、app.onError 把它吞成 `{"error":{"code":"internal"}}` 500——
 * 而 typecheck、全仓 test、23 项 e2e **全绿**，因为没有一条用例走那两个新值。
 *
 * 「跑得通但是错的」正是这一类：枚举放宽与它的 DDL 落在两个 commit 里，
 * 中间那个是可发布的。所以这里不逐值写断言（那会退化成抄一遍常量），
 * 而是从 pg_enum 反查，让**任何**新增值在没有迁移时立刻炸。
 */

/**
 * drizzle 的 pgEnum 返回的是**函数**（可调用来生成列），
 * enumName / enumValues 挂在函数对象自己身上——
 * 所以不能按 `typeof v === 'object'` 过滤，那会一个都拿不到。
 */
type PgEnumLike = { enumName: string; enumValues: readonly string[] }

const PG_ENUMS = (Object.values(schema) as unknown[])
  .filter((v): v is PgEnumLike => {
    if (v === null) return false
    const t = typeof v
    if (t !== 'object' && t !== 'function') return false
    return 'enumName' in (v as object) && 'enumValues' in (v as object)
  })
  .map((e) => [e.enumName, e.enumValues] as const)

describe('TS 枚举 ↔ PG 枚举', () => {
  test('反射拿到了枚举（否则这组测试是空转的）', () => {
    expect(PG_ENUMS.length).toBeGreaterThan(10)
  })

  for (const [name, values] of PG_ENUMS) {
    test(`${name}：库里的取值集合与代码逐值一致`, async () => {
      const rows = await db.execute<{ label: string }>(sql`
        select e.enumlabel as label
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typname = ${name}
        order by e.enumsortorder
      `)
      const inDb = [...rows].map((r) => r.label)

      // 用集合比而不是数组比：ADD VALUE BEFORE 会改顺序，而顺序不影响正确性
      expect(new Set(inDb)).toEqual(new Set(values))
    })
  }
})
