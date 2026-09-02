import { db, schema } from '@gensokyo/db'
import {
  deleteResourceSchema,
  grantRoleSchema,
  PUBLIC_CONFIG_KEYS,
  resetStrikesSchema,
  siteConfigSchema,
  userSearchSchema,
} from '@gensokyo/shared'
import { and, desc, eq, ilike, inArray, isNotNull, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { entityIdParam, fail, userIdParam, validate } from '../errors'
import { requireRole } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { notify } from '../notify'
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
  .get('/users', validate('query', userSearchSchema), async (c) => {
    const { q } = c.req.valid('query')

    /**
     * 不带 q 只列现任 staff。全站用户列表对站长没有用处，却是一份现成的
     * 邮箱清单——默认不吐。要提的人还是普通用户，得靠 q 按邮箱/昵称找。
     */
    const where = q
      ? or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`))
      : inArray(userProfile.role, ['moderator', 'admin'])

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
      .where(where)
      .limit(50)
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

  /**
   * 清零违规。这是 strikeCount **唯一的递减路径**。
   *
   * 没有它，一次误判就是永久的：`canPostLinks` 与 `canAutoPublish` 里
   * `strikeCount > 0` 的短路都在阈值判断**之前**，把门槛调成 0 也救不回来。
   * 删楼幂等只挡住「双击 +2」，挡不住「误判 +1」。
   *
   * 记 `trust_change`（既有枚举值，不加新的）：宽恕与惩罚是同一条治理链，
   * 审计要能回答「谁、什么时候、凭什么把这个人的违规清掉了」。
   */
  .post(
    '/users/:id/strikes/reset',
    userIdParam,
    validate('json', resetStrikesSchema),
    async (c) => {
      const actor = c.get('actor')
      if (!actor) return fail(c, 'unauthorized', 401)
      const id = c.req.param('id')
      const { reason } = c.req.valid('json')

      const [target] = await db
        .select({ strikeCount: userProfile.strikeCount })
        .from(userProfile)
        .where(eq(userProfile.userId, id))
        .limit(1)
      if (!target) return fail(c, 'not_found', 404)
      // 本来就是 0：别写一条「从 0 清到 0」的审计，那会把日志变成噪音
      if (target.strikeCount === 0)
        return fail(c, 'invalid_state_transition', 409)

      /**
       * 乐观条件：只在 strikeCount 仍等于刚才读到的值时才清。
       * 惩罚路径是原子 `+1`（moderation.ts / shrine.ts），与这里交错时——站长
       * 复核旧误判的同时审核员刚拒了一条新的侵权投稿——无条件 `SET 0` 会把
       * 那次新违规一并抹掉，且审计里写的是 `{from: 2, to: 0}` 而实际抹掉的是 3。
       * 审计存在的理由正是「凭什么清掉」，它给出错的答案比没有更糟。
       */
      const cleared = await db.transaction(async (tx) => {
        const [hit] = await tx
          .update(userProfile)
          .set({ strikeCount: 0 })
          .where(
            and(
              eq(userProfile.userId, id),
              eq(userProfile.strikeCount, target.strikeCount),
            ),
          )
          .returning({ id: userProfile.userId })
        if (!hit) return false
        await tx.insert(moderationLog).values({
          actorId: actor.id,
          action: 'trust_change',
          subjectKind: 'user',
          subjectId: id,
          fromValue: { strikeCount: target.strikeCount },
          toValue: { strikeCount: 0 },
          reason,
        })
        return true
      })
      // 读到的值已经变了：让站长刷新后重看，别替他决定
      if (!cleared) return fail(c, 'invalid_state_transition', 409)

      return c.json({ strikeCount: 0 })
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
          uploaderId: resource.uploaderId,
          deletedAt: resource.deletedAt,
        })
        .from(resource)
        .where(eq(resource.id, id))
        .limit(1)
      if (!row) return fail(c, 'not_found', 404)
      // 软删幂等：已经在回收站里的再软删一次，会重写 deletedAt、再记一条审计、再发一条通知
      if (mode === 'soft' && row.deletedAt !== null)
        return fail(c, 'invalid_state_transition', 409)

      await db.transaction(async (tx) => {
        /**
         * 审计先写。moderationLog.subjectId 是 text 而非外键，正是为了让
         * 记录在被删对象消失之后仍然存在——硬删之后还能答得出「删了什么、
         * 谁删的、依据是什么」。
         */
        await tx.insert(moderationLog).values({
          actorId: actor.id,
          action: mode === 'purge' ? 'hard_delete' : 'soft_delete',
          subjectKind: 'resource',
          subjectId: id,
          fromValue: { slug: row.slug, title: row.titleOriginal },
          toValue: { mode },
          reason,
        })

        if (row.uploaderId) {
          await notify(tx, [
            mode === 'purge'
              ? {
                  userId: row.uploaderId,
                  kind: 'resource_deleted',
                  actorId: actor.id,
                  /**
                   * ⚠️ **不带 resourceId。** 下面那句 delete 会在同一个事务里顺着
                   * 外键把这条通知自己级联删掉，作者永远收不到——而症状是
                   * 「什么都没发生」。标题快照进 payload。
                   */
                  payload: { title: row.titleOriginal, slug: row.slug },
                }
              : {
                  userId: row.uploaderId,
                  kind: 'resource_delisted',
                  actorId: actor.id,
                  resourceId: id,
                  // reason 是写进审计日志的内部理由，不投递
                  payload: { mode: 'soft' },
                },
          ])
        }

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

  /** 软删的可以恢复；硬删的不行，这就是两者的区别。恢复同样留痕 */
  .post('/resources/:id/restore', entityIdParam, async (c) => {
    const actor = c.get('actor')
    if (!actor) return fail(c, 'unauthorized', 401)
    const id = c.req.param('id')
    const [row] = await db
      .select({ deletedAt: resource.deletedAt, slug: resource.slug })
      .from(resource)
      .where(eq(resource.id, id))
      .limit(1)
    if (!row) return fail(c, 'not_found', 404)
    if (row.deletedAt === null) return fail(c, 'invalid_state_transition', 409)

    await db.transaction(async (tx) => {
      await tx
        .update(resource)
        .set({ deletedAt: null })
        .where(eq(resource.id, id))
      await tx.insert(moderationLog).values({
        actorId: actor.id,
        action: 'status_change',
        subjectKind: 'resource',
        subjectId: id,
        fromValue: { deleted: true },
        toValue: { deleted: false, slug: row.slug },
        reason: '从回收站恢复',
      })
    })
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
