import { describe, expect, test } from 'bun:test'
import { replyTarget } from './discussion-nav'

describe('replyTarget', () => {
  test('新楼落在当前窗口内：原地定位', () => {
    expect(replyTarget(37, 1, 50)).toEqual({ kind: 'inpage' })
  })

  test('新楼正好是窗口最后一层：仍算窗口内', () => {
    expect(replyTarget(50, 1, 50)).toEqual({ kind: 'inpage' })
  })

  test('新楼超出窗口一层：要导航，且落到含它的那一页页首', () => {
    expect(replyTarget(51, 1, 50)).toEqual({ kind: 'navigate', from: 51 })
  })

  test('用户停在第二页、新楼在第三页', () => {
    expect(replyTarget(120, 51, 50)).toEqual({ kind: 'navigate', from: 101 })
  })

  test('用户停在第三页、新楼就在这一页', () => {
    expect(replyTarget(120, 101, 50)).toEqual({ kind: 'inpage' })
  })

  test('软删造成楼层序列有空洞时，按页边界吸附而不是按计数', () => {
    // floorSeq 是序列不是计数：第 3 页的页首恒为 101，与实际存活楼数无关
    expect(replyTarget(103, 1, 50)).toEqual({ kind: 'navigate', from: 101 })
  })
})
