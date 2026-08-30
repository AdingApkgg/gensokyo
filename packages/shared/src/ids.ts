import { z } from 'zod'

/**
 * id 分三种，不可混用。
 *
 * better-auth 的 generateId 产生 32 位随机字母数字串（实测 1.7.2），**不是 UUID**——
 * 用 z.uuid() 校验用户 id 会对每一个真实用户返回 400。
 *
 * M4 从 kourindou/ 上提到这里：shrine 与 notifications 都要用，
 * 留在 kourindou 下会造成 shrine 反向依赖香霖堂的契约。
 */
export const entityIdSchema = z.uuid()
export const userIdSchema = z.string().min(1).max(64)
export const slugIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

/** 举报目标是多态的（资源/帖子/用户），只能用最宽的形状，存在性交给应用层 */
export const anyIdSchema = z.string().min(1).max(64)

/**
 * handle 是 M4 唯一同时命中两条不可逆红线的字段：它进 /u/:handle（已发出的 URL），
 * 也进已发布帖子的正文（@xxx）。改它等于死链 + 重写历史正文。
 *
 * 纯 ASCII、无连字符、首字符必须字母数字。
 * - 无连字符：与 slug 的字符集区分开，避免 /u/foo-bar 与版块 slug 视觉混淆
 * - 首字符限制：挡的是 `_admin` 这类靠前导下划线做的视觉冒充
 * - 纯 ASCII：假名会让 /u/ 路径进入 percent-encoding，且 @ 的终止边界判定复杂化。
 *   显示名（user.name）完全自由，handle 只是稳定标识，与 X / GitHub 的做法一致
 *
 * **DB 侧的 user_profile_handle_fmt CHECK 由这同一个字面量派生**，
 * 并有测试断言两者一致——两处各写一遍正则必然漂移。
 */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,19}$/

/**
 * 保留字。只写在 zod 里的约束绕过 API 就没了，而这里绕过的后果是**不可逆冒充**
 * （@admin 一旦被注册并出现在已发布的正文里，改不回来），所以 DB 侧也有一条 CHECK。
 */
export const RESERVED_HANDLES = [
  'admin',
  'administrator',
  'root',
  'staff',
  'moderator',
  'mod',
  'everyone',
  'here',
  'all',
  'system',
  'gensokyo',
  'official',
  'support',
  'help',
  'api',
  'me',
  'new',
  'settings',
  'null',
  'undefined',
] as const
export type ReservedHandle = (typeof RESERVED_HANDLES)[number]

export const isReservedHandle = (h: string): boolean =>
  (RESERVED_HANDLES as readonly string[]).includes(h)

/** 注册与认领用：形状合法**且**不是保留字 */
export const handleSchema = z
  .string()
  .regex(HANDLE_RE)
  .refine((h) => !isReservedHandle(h), { message: 'reserved' })

/**
 * 路径参数用：**只校验形状，不查保留字**。
 *
 * `/u/admin` 的正确答案是 404（没有这个用户）而不是 400（参数格式错误）——
 * 保留字是「注册不出来」的规则，不是「路径写错了」的规则。用 handleSchema
 * 挡路径会让保留字的存在从 URL 上被探测出来，也会让错误码说谎。
 */
export const handlePathSchema = z.string().regex(HANDLE_RE)
