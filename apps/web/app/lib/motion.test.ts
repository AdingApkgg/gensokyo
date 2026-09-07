import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EASE_FUDE, EASE_SUMI, EASE_WASHI } from './motion'

const css = readFileSync(join(import.meta.dir, '../app.css'), 'utf8')

/** 从 app.css 的 @theme 里读出某条曲线的四个数 */
function cubicFromCss(name: string): number[] {
  const mo = css.match(
    new RegExp(`--ease-${name}:\\s*cubic-bezier\\(([^)]+)\\)`),
  )
  if (!mo) throw new Error(`app.css 里找不到 --ease-${name}`)
  return mo[1].split(',').map((s) => Number(s.trim()))
}

describe('三材曲线的 TS 字面值与 app.css 一致', () => {
  test('sumi', () => expect(cubicFromCss('sumi')).toEqual([...EASE_SUMI]))
  test('washi', () => expect(cubicFromCss('washi')).toEqual([...EASE_WASHI]))
  test('fude', () => expect(cubicFromCss('fude')).toEqual([...EASE_FUDE]))
})
