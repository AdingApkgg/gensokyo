import { describe, expect, test } from 'bun:test'
import { mergeWatched, pendingIdsFrom, withoutPending } from './dash-pending'

const f = (key: string, state: string) => ({ key, state })

describe('pendingIdsFrom', () => {
  test('只认自己前缀的、且非 idle 的', () => {
    expect(
      pendingIdsFrom(
        [
          f('review:a', 'submitting'),
          f('review:b', 'idle'),
          f('report:c', 'submitting'),
          f('someOtherFetcher', 'loading'),
          f('review:d', 'loading'),
        ],
        'review:',
      ),
    ).toEqual(['a', 'd'])
  })

  /** 两个 dash 页的 action 返回形状不同，串前缀会让一边读到另一边的 data */
  test('report: 前缀不会捞到 review: 的行', () => {
    const all = [f('review:a', 'submitting'), f('report:b', 'submitting')]
    expect(pendingIdsFrom(all, 'report:')).toEqual(['b'])
  })

  test('id 里带冒号也切得对（slice 前缀长度，不是 split）', () => {
    expect(pendingIdsFrom([f('review:x:y', 'submitting')], 'review:')).toEqual([
      'x:y',
    ])
  })

  test('没有在途的返回空数组', () => {
    expect(pendingIdsFrom([f('review:a', 'idle')], 'review:')).toEqual([])
  })
})

describe('withoutPending', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  test('在途的那一行当帧就不在列表里', () => {
    expect(withoutPending(items, ['b'])).toEqual([{ id: 'a' }, { id: 'c' }])
  })

  test('没有在途时原样返回', () => {
    expect(withoutPending(items, [])).toEqual(items)
  })

  test('在途 id 不在列表里也不炸', () => {
    expect(withoutPending(items, ['zzz'])).toEqual(items)
  })
})

describe('mergeWatched', () => {
  /**
   * 这条是整个播报链的关键：结算那一帧 pendingIds 已经空了，
   * 若盯梢集合跟着空掉，组件在拿到 data 的同一帧卸载，回执永远播不出来。
   */
  test('结算后仍保留，不跟着在途集合缩回去', () => {
    const afterSubmit = mergeWatched([], ['a'])
    expect(afterSubmit).toEqual(['a'])
    // 结算：pendingIds 变空，但盯梢集合必须还留着 a
    expect(mergeWatched(afterSubmit, [])).toEqual(['a'])
  })

  test('重复登记不产生重复项', () => {
    expect(mergeWatched(['a'], ['a', 'b'])).toEqual(['a', 'b'])
  })

  test('没有新增时返回同一个引用（避免无谓的 setState）', () => {
    const w = ['a']
    expect(mergeWatched(w, ['a'])).toBe(w)
  })
})
