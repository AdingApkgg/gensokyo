import { db, schema } from '@gensokyo/db'
import {
  deleteResourceSchema,
  grantRoleSchema,
  PUBLIC_CONFIG_KEYS,
  siteConfigSchema,
} from '@gensokyo/shared'
import { desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { entityIdParam, fail, userIdParam, validate } from '../errors'
import { requireRole } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { invalidateConfig } from '../site-config'

const { resource, user, userProfile, moderationLog, siteConfig } = schema

/**
 * 站长独占能力：提权、硬删、站点配置。
 *
 * moderator 管内容，admin 管人和站——这条线的意义在于，被攻破的审核员账号
 * 不能给自己升权，也不能不可逆地销毁东西。
 */
export const admin = new Hono<AppEnv>()
  .use('*', requireRole('admin'))

  // ------------------------------------------------------------ 提权
  .get('/users', async (c) => {
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: userProfile.role,
        approvedResourceCount: userProfile.approvedResourceCount,
        strikeCount: userProfile.strikeCount,
      })
      .from(userProfile)
      .innerJoin(user, eq(user.id, userProfile.userId))
      .where(inArray(userProfile.role, ['moderator', 'admin']))
    return c.json({ items: rows })
  })

  .patch(
    '/users/:id/role',
    userIdParam,
    validate('json', grantRoleSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const id = c.req.param('id')
      const { role, reason } = c.req.valid('json')

      // 别把自己锁在门外——降权自己会让站点可能一个 admin 都不剩
      if (id === actor.id) return fail(c, 'self_action_forbidden', 403)

      const [target] = await db
        .select({ role: userProfile.role })
        .from(userProfile)
        .where(eq(userProfile.userId, id))
        .limit(1)
      if (!target) return fail(c, 'not_found', 404)

      // 现有 admin 只能由脚本降级：HTTP 上既不能造 admin 也不能废 admin
      if (target.role === 'admin') return fail(c, 'forbidden', 403)

      await db.transaction(async (tx) => {
        await tx
          .update(userProfile)
          .set({ role })
          .where(eq(userProfile.userId, id))
        await tx.insert(moderationLog).values({
          actorId: actor.id,
          action: 'role_change',
          subjectKind: 'user',
          subjectId: id,
          fromValue: { role: target.role },
          toValue: { role },
          reason,
        })
      })

      return c.json({ role })
    },
  )

  // ------------------------------------------------------------ 删除
  .delete(
    '/resources/:id',
    entityIdParam,
    validate('json', deleteResourceSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const id = c.req.param('id')
      const { mode, reason } = c.req.valid('json')

      const [row] = await db
        .select({
          id: resource.id,
          slug: resource.slug,
          titleOriginal: resource.titleOriginal,
          deletedAt: resource.deletedAt,
        })
        .from(resource)
        .where(eq(resource.id, id))
        .limit(1)
      if (!row) return fail(c, 'not_found', 404)

      await db.transaction(async (tx) => {
        /**
         * 审计先写。moderationLog.subjectId 是 text 而非外键，正是为了让
         * 记录在被删对象消失之后仍然存在——硬删之后还能答得出「删了什么、
         * 谁删的、依据是什么」。
         */
        await tx.insert(moderationLog).values({
          actorId: actor.id,
          action: mode === 'purge' ? 'hard_delete' : 'status_change',
          subjectKind: 'resource',
          subjectId: id,
          fromValue: { slug: row.slug, title: row.titleOriginal },
          toValue: { mode },
          reason,
        })

        if (mode === 'purge') {
          // 级联会带走 version / file / tag / rating / favorite / topic / post
          await tx.delete(resource).where(eq(resource.id, id))
        } else {
          await tx
            .update(resource)
            .set({ deletedAt: new Date() })
            .where(eq(resource.id, id))
        }
      })

      return c.json({ mode, id })
    },
  )

  /** 软删的可以恢复；硬删的不行，这就是两者的区别 */
  .post('/resources/:id/restore', entityIdParam, async (c) => {
    const id = c.req.param('id')
    const [row] = await db
      .select({ deletedAt: resource.deletedAt })
      .from(resource)
      .where(eq(resource.id, id))
      .limit(1)
    if (!row) return fail(c, 'not_found', 404)
    if (row.deletedAt === null) return fail(c, 'invalid_state_transition', 409)

    await db
      .update(resource)
      .set({ deletedAt: null })
      .where(eq(resource.id, id))
    return c.json({ restored: true })
  })

  /** 软删回收站：只有这里能看到被软删的东西 */
  .get('/resources/deleted', async (c) => {
    const items = await db
      .select({
        id: resource.id,
        slug: resource.slug,
        titleOriginal: resource.titleOriginal,
        deletedAt: resource.deletedAt,
      })
      .from(resource)
      .where(isNotNull(resource.deletedAt))
      .orderBy(desc(resource.deletedAt))
      .limit(100)
    return c.json({ items })
  })

  // ------------------------------------------------------------ 站点配置
  .get('/config', async (c) => {
    const rows = await db.select().from(siteConfig)
    return c.json({
      config: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    })
  })

  .patch('/config', validate('json', siteConfigSchema), async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const input = c.req.valid('json')
    const entries = Object.entries(input).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return fail(c, 'validation_failed', 400)

    await db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx
          .insert(siteConfig)
          .values({ key, value, updatedBy: actor.id })
          .onConflictDoUpdate({
            target: siteConfig.key,
            set: { value, updatedBy: actor.id },
          })
      }
      await tx.insert(moderationLog).values({
        actorId: actor.id,
        action: 'config_change',
        subjectKind: 'site',
        subjectId: 'config',
        toValue: input,
        reason: `修改了 ${entries.map(([k]) => k).join(', ')}`,
      })
    })

    invalidateConfig()
    return c.json({ config: input })
  })

/** 公开配置：前端要用它决定是否显示注册入口、下架联系方式等 */
export const publicConfig = new Hono<AppEnv>().get('/', async (c) => {
  const rows = await db
    .select()
    .from(siteConfig)
    .where(inArray(siteConfig.key, [...PUBLIC_CONFIG_KEYS]))
  return c.json({
    config: Object.fromEntries(rows.map((r) => [r.key, r.value])),
  })
})
