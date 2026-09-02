import { describe, expect, test } from 'bun:test'
import {
  bareKeyPattern,
  extractManagedKeys,
  isImagePurpose,
  managedKeyPattern,
} from './storage'

const BASE = 'https://th.saop.cc/img/gensokyo'
const UUID = '01a04fe3-8fac-7000-bf86-fc051d3d5213'

describe('extractManagedKeys —— GC 白名单的 key 派生', () => {
  /**
   * 这一条是整个 T5 的理由。宽松正则会把闭括号吃进 key，
   * 派生出 `post/….webp)`，与桶里的 `post/….webp` 精确比对不上，
   * 过了宽限期这张正在用的图被精确删掉。
   */
  test('Markdown 图片语法：闭括号不进 key', () => {
    const md = `看这张 ![截图](${BASE}/post/${UUID}.webp) 就明白了`
    expect(extractManagedKeys(md, BASE)).toEqual([`post/${UUID}.webp`])
  })

  test('链接语法、裸 URL、尖括号自动链接 —— 三种写法派生同一个 key', () => {
    const variants = [
      `[图](${BASE}/post/${UUID}.png)`,
      `${BASE}/post/${UUID}.png`,
      `<${BASE}/post/${UUID}.png>`,
      `![](${BASE}/post/${UUID}.png "标题")`,
    ]
    for (const v of variants) {
      expect(extractManagedKeys(v, BASE)).toEqual([`post/${UUID}.png`])
    }
  })

  test('三种 purpose 都认；不认识的前缀不算本站对象', () => {
    const md = [
      `${BASE}/cover/${UUID}.jpg`,
      `${BASE}/avatar/${UUID}.webp`,
      `${BASE}/post/${UUID}.avif`,
      `${BASE}/evil/${UUID}.png`,
    ].join('\n')
    expect(extractManagedKeys(md, BASE)).toEqual([
      `cover/${UUID}.jpg`,
      `avatar/${UUID}.webp`,
      `post/${UUID}.avif`,
    ])
  })

  test('扩展名后面紧跟字母数字不算 —— 挡住 .webpx 这类前缀碰撞', () => {
    expect(extractManagedKeys(`${BASE}/post/${UUID}.webpx`, BASE)).toEqual([])
    expect(extractManagedKeys(`${BASE}/post/${UUID}.png2`, BASE)).toEqual([])
  })

  test('别家的域名、错的桶名一个都不认', () => {
    const md = [
      `https://evil.example/img/gensokyo/post/${UUID}.png`,
      `https://th.saop.cc/img/other/post/${UUID}.png`,
    ].join('\n')
    expect(extractManagedKeys(md, BASE)).toEqual([])
  })

  test('base 含正则元字符时要转义 —— 127.0.0.1:59000 里的点', () => {
    const local = 'http://127.0.0.1:59000/gensokyo'
    expect(extractManagedKeys(`${local}/cover/${UUID}.png`, local)).toEqual([
      `cover/${UUID}.png`,
    ])
    // 点没转义的话 127x0x0x1 也会匹配
    expect(
      extractManagedKeys(
        `http://127x0x0x1:59000/gensokyo/cover/${UUID}.png`,
        local,
      ),
    ).toEqual([])
  })

  test('大写 hex 不认 —— 那是 S3 里另一个不存在的对象', () => {
    expect(
      extractManagedKeys(`${BASE}/post/${UUID.toUpperCase()}.png`, BASE),
    ).toEqual([])
  })

  test('空 base 或空文本返回空，不抛', () => {
    expect(extractManagedKeys('x', '')).toEqual([])
    expect(extractManagedKeys('', BASE)).toEqual([])
  })

  test('正则每次调用是新实例 —— g 标志的 lastIndex 不会串', () => {
    const re1 = managedKeyPattern(BASE)
    const re2 = managedKeyPattern(BASE)
    expect(re1).not.toBe(re2)
  })
})

describe('isImagePurpose', () => {
  test('白名单三值', () => {
    expect(isImagePurpose('cover')).toBe(true)
    expect(isImagePurpose('avatar')).toBe(true)
    expect(isImagePurpose('post')).toBe(true)
  })
  test('未知值与非字符串都不是 —— 上一版会把未知值静默变成 cover', () => {
    expect(isImagePurpose('banner')).toBe(false)
    expect(isImagePurpose('')).toBe(false)
    expect(isImagePurpose(undefined)).toBe(false)
    expect(isImagePurpose(['cover'])).toBe(false)
  })
})

describe('bareKeyPattern —— 侦测挂在别的 base 下的本站对象', () => {
  test('捕获组 1 是前缀，能把旧域名下的引用揪出来', () => {
    const md = `旧图 ![](https://old.example/img/gensokyo/post/${UUID}.png) 还在`
    const m = [...md.matchAll(bareKeyPattern())]
    expect(m).toHaveLength(1)
    expect(m[0]?.[1]).toBe('https://old.example/img/gensokyo')
  })

  test('当前 base 下的引用同样匹配 —— 调用方负责用 known 集合过滤', () => {
    const m = [...`${BASE}/cover/${UUID}.webp`.matchAll(bareKeyPattern())]
    expect(m[0]?.[1]).toBe(BASE)
  })

  test('别家路径里碰巧有 /post/ 但后面不是 uuid.ext 的不算', () => {
    expect([
      ...'https://x.example/post/hello.png'.matchAll(bareKeyPattern()),
    ]).toHaveLength(0)
    expect([
      ...`https://x.example/post/${UUID}.exe`.matchAll(bareKeyPattern()),
    ]).toHaveLength(0)
  })

  test('前缀在括号/引号处截断，不把 Markdown 语法吃进去', () => {
    const m = [
      ...`[x](https://old.example/post/${UUID}.png)`.matchAll(bareKeyPattern()),
    ]
    expect(m[0]?.[1]).toBe('https://old.example')
  })
})
