import { expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from './client'

test('db 连通且 auth 四张表存在', async () => {
  const r = await db.execute(sql`
    select count(*)::int as n from information_schema.tables
    where table_schema = 'public'
      and table_name in ('user', 'session', 'account', 'verification')
  `)
  const row = (
    Array.isArray(r) ? r[0] : (r as { rows?: { n: number }[] }).rows?.[0]
  ) as { n: number } | undefined
  expect(row?.n).toBe(4)
})
