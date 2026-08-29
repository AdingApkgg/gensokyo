/**
 * slug 生成。
 *
 * 标题多为中日文，纯粹从标题转写往往什么都不剩，所以策略是
 * 「能提取的 ASCII 片段 + 随机后缀」：ASCII 标题得到可读 slug，
 * CJK 标题退化成纯随机串但仍然可用。
 *
 * 随机后缀同时解决两件事：实际上不会撞（不必重试），
 * 以及 slug 不可枚举。
 */
export function makeSlug(titleOriginal: string): string {
  const ascii = titleOriginal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')

  const suffix = Math.random().toString(36).slice(2, 8)
  return ascii ? `${ascii}-${suffix}` : suffix
}
