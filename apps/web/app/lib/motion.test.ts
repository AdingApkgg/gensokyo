import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  confirmStagger,
  EASE_FUDE,
  EASE_SUMI,
  EASE_WASHI,
  SPRING_WASHI,
  SPRING_WASHI_VALUE,
} from './motion'

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

describe('confirmStagger —— /dash/trash 销毁确认的两拍', () => {
  test('未减弱：三拍，末拍在 0.42s 完成（stagger 是 n−1 个间隔 + 末拍自身时长）', () => {
    const v = confirmStagger(false)
    expect(v.container.show.transition.staggerChildren).toBe(0.12)
    expect(v.item.show.transition.duration).toBe(0.18)
    const 三个子节点 = 3
    expect(0.12 * (三个子节点 - 1) + 0.18).toBeCloseTo(0.42, 5)
  })

  /**
   * 这条是这个函数存在的全部理由。MotionConfig reducedMotion="user" 只关
   * transform/positional 键；删掉守卫的话，开了减弱动效的人仍会看到三段递延，
   * 而此时它是页面上唯一在动的东西，还落在唯一不可逆的操作上。
   */
  test('减弱动效：stagger 与时长都归零，三者同帧出现', () => {
    const v = confirmStagger(true)
    expect(v.container.show.transition.staggerChildren).toBe(0)
    expect(v.item.show.transition.duration).toBe(0)
  })

  test('hidden 里只有 opacity，没有任何位移键', () => {
    expect(Object.keys(confirmStagger(false).item.hidden)).toEqual(['opacity'])
  })
})

describe('SPRING_WASHI 两份写法同一个数', () => {
  test('MotionValue 用的那份与 transition 用的那份数字相同', () => {
    expect(SPRING_WASHI.visualDuration).toBe(SPRING_WASHI_VALUE.visualDuration)
    expect(SPRING_WASHI.bounce).toBe(SPRING_WASHI_VALUE.bounce)
    expect(SPRING_WASHI.type).toBe('spring')
  })
})
