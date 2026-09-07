import { describe, expect, test } from 'bun:test'
import { periodFor } from './time'

describe('periodFor', () => {
  test('一分钟内：10 秒一刷', () => {
    expect(periodFor(0)).toBe(10_000)
    expect(periodFor(59_999)).toBe(10_000)
  })

  test('未来时间戳（服务端时钟偏快）也落进最勤的档，几秒内自己纠正', () => {
    expect(periodFor(-5_000)).toBe(10_000)
  })

  test('一小时内：一分钟一刷', () => {
    expect(periodFor(60_000)).toBe(60_000)
    expect(periodFor(3_599_999)).toBe(60_000)
  })

  test('一天内：十分钟一刷', () => {
    expect(periodFor(3_600_000)).toBe(600_000)
    expect(periodFor(86_399_999)).toBe(600_000)
  })

  test('超过一天：不起 interval', () => {
    expect(periodFor(86_400_000)).toBeNull()
    expect(periodFor(30 * 86_400_000)).toBeNull()
  })
})
