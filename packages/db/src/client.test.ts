import { expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from './client'

test('db 连通且 user 表存在', async () => {
  const r = await db.execute(sql`select count(*)::int as n from "user"`)
  const row = (Array.isArray(r) ? r[0] : (r as { rows?: { n: number }[] }).rows?.[0]) as
    | { n: number }
    | undefined
  expect(row?.n).toBe(0)
})
