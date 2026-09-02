/**
 * 三语消息审计：
 *   bun run check-messages
 *
 * 硬失败（退出码 1）：key 集合三语不逐字相同、同一 key 的 {占位符} 不一致、
 * 有空值、代码里引用了不存在的 `m.key()`。
 * 软提示：没有任何代码引用的 key（可能是漏用，也可能是该删了）。
 *
 * Paraglide 编译时只会对缺 key 报警告，不会挡构建——所以缺一语的 key 会以
 * 回落语言的文案上线，中文站上冒出一句日文。这个脚本让它成为门禁的一部分。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const LOCALES = ['zh', 'ja', 'en'] as const
const files: Record<string, Record<string, string>> = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(
      readFileSync(join(root, 'apps/web/messages', `${l}.json`), 'utf8'),
    ),
  ]),
)
const keysOf = (o: Record<string, string>) =>
  Object.keys(o).filter((k) => !k.startsWith('$'))

let bad = 0
const base = new Set(keysOf(files.zh ?? {}))
for (const l of LOCALES) {
  const s = new Set(keysOf(files[l] ?? {}))
  for (const k of base) {
    if (!s.has(k)) {
      console.log(`✗ ${l} 缺 ${k}`)
      bad++
    }
  }
  for (const k of s) {
    if (!base.has(k)) {
      console.log(`✗ ${l} 多出 ${k}`)
      bad++
    }
  }
}

const placeholders = (v: unknown) =>
  [...String(v).matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',')
for (const k of base) {
  const ph = LOCALES.map((l) => placeholders(files[l]?.[k]))
  if (new Set(ph).size > 1) {
    console.log(`✗ 占位符不一致 ${k}: ${ph.map((p) => p || '∅').join(' | ')}`)
    bad++
  }
  for (const l of LOCALES) {
    if (String(files[l]?.[k] ?? '').trim() === '') {
      console.log(`✗ ${l}.${k} 为空`)
      bad++
    }
  }
}

// 代码引用：apps/web/app 下所有 ts/tsx，跳过 Paraglide 生成目录
const used = new Set<string>()
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'paraglide') walk(p)
    } else if (/\.tsx?$/.test(name)) {
      for (const m of readFileSync(p, 'utf8').matchAll(
        /\bm\.([a-zA-Z0-9_]+)\(/g,
      )) {
        if (m[1]) used.add(m[1])
      }
    }
  }
}
walk(join(root, 'apps/web/app'))
for (const k of used) {
  if (!base.has(k)) {
    console.log(`✗ 代码引用了不存在的 key：${k}`)
    bad++
  }
}
const unused = [...base].filter((k) => !used.has(k))
if (unused.length > 0) {
  console.log(`⚠ 没有代码引用的 key ${unused.length} 个：${unused.join(', ')}`)
}

console.log(
  bad
    ? `${bad} 处问题`
    : `✓ ${base.size} 个 key × ${LOCALES.length} 语一致，代码引用 ${used.size} 个`,
)
process.exit(bad ? 1 : 0)
