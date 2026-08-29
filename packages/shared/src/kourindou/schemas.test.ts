import { describe, expect, test } from 'bun:test'
import {
  createResourceSchema,
  entityIdSchema,
  listResourcesQuerySchema,
  presignUploadSchema,
  reviewResourceSchema,
  slugIdSchema,
  userIdSchema,
} from './schemas'

/**
 * better-auth 1.7.2 的 generateId 是 32 位随机字母数字串，不是 UUID。
 * 用 z.uuid() 校验用户 id 会对每一个真实用户返回 400 —— 这组测试钉住这个区别。
 */
const REAL_BETTER_AUTH_ID = 'k3Nf8QxZ2mLpVwR7bTyH4jCd6sGaE1uO'
const REAL_UUID = '01931f6e-8c4a-7000-8000-9a1b2c3d4e5f'

describe('id schema 三分', () => {
  test('userIdSchema 接受 better-auth 的 32 位串', () => {
    expect(userIdSchema.parse(REAL_BETTER_AUTH_ID)).toBe(REAL_BETTER_AUTH_ID)
  })

  test('entityIdSchema 拒绝 better-auth 的 id（它不是 UUID）', () => {
    expect(() => entityIdSchema.parse(REAL_BETTER_AUTH_ID)).toThrow()
  })

  test('entityIdSchema 接受 uuid', () => {
    expect(entityIdSchema.parse(REAL_UUID)).toBe(REAL_UUID)
  })

  test('slugIdSchema 接受查找表的 slug，拒绝大写与空格', () => {
    expect(slugIdSchema.parse('th06')).toBe('th06')
    expect(slugIdSchema.parse('c105')).toBe('c105')
    expect(() => slugIdSchema.parse('TH06')).toThrow()
    expect(() => slugIdSchema.parse('th 06')).toThrow()
  })

  test('列表筛选用真实用户 id 不报错（P0 回归点）', () => {
    const parsed = listResourcesQuerySchema.parse({
      uploaderId: REAL_BETTER_AUTH_ID,
    })
    expect(parsed.uploaderId).toBe(REAL_BETTER_AUTH_ID)
    expect(parsed.page).toBe(1)
    expect(parsed.sort).toBe('newest')
  })
})

describe('createResourceSchema', () => {
  const base = {
    titleOriginal: '東方紅魔郷 ～ the Embodiment of Scarlet Devil',
    titleOriginalLocale: 'ja',
    kind: 'game',
    license: 'allowed',
  }

  test('最小输入即可，多语字段默认空对象', () => {
    const r = createResourceSchema.parse(base)
    expect(r.title).toEqual({})
    expect(r.description).toEqual({})
    expect(r.tagIds).toEqual([])
  })

  test('许可状态是必填的（版权生死线）', () => {
    const { license: _license, ...withoutLicense } = base
    expect(() => createResourceSchema.parse(withoutLicense)).toThrow()
  })

  test('拒绝未知许可状态', () => {
    expect(() =>
      createResourceSchema.parse({ ...base, license: 'whatever' }),
    ).toThrow()
  })

  test('标签数量有上限', () => {
    expect(() =>
      createResourceSchema.parse({
        ...base,
        tagIds: Array.from({ length: 13 }, (_, i) => `tag-${i}`),
      }),
    ).toThrow()
  })
})

describe('presignUploadSchema', () => {
  const base = {
    kind: 'file',
    filename: 'th06.zip',
    contentType: 'application/zip',
  }

  test('接受 5GB 以内', () => {
    expect(
      presignUploadSchema.parse({ ...base, sizeBytes: 5 * 1024 ** 3 })
        .sizeBytes,
    ).toBe(5 * 1024 ** 3)
  })

  test('拒绝超过单次 PUT 上限的文件', () => {
    expect(() =>
      presignUploadSchema.parse({ ...base, sizeBytes: 5 * 1024 ** 3 + 1 }),
    ).toThrow()
  })
})

describe('reviewResourceSchema', () => {
  test('approve 不需要理由', () => {
    expect(reviewResourceSchema.parse({ decision: 'approve' }).decision).toBe(
      'approve',
    )
  })

  test('reject 必须给理由', () => {
    expect(() => reviewResourceSchema.parse({ decision: 'reject' })).toThrow()
    expect(
      reviewResourceSchema.parse({
        decision: 'reject',
        rejectReason: 'copyright',
      }).rejectReason,
    ).toBe('copyright')
  })
})
