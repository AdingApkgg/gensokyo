import { describe, expect, test } from 'bun:test'
import { classifyLink, hasExternalLink } from './link'

const OWN = ['https://th.saop.cc', 'https://img.th.saop.cc']

describe('classifyLink', () => {
  test('站内相对路径', () => {
    for (const u of ['/shrine/topics/x', 'foo/bar', '#anchor', '']) {
      expect(classifyLink(u, OWN).kind).toBe('internal')
    }
  })

  test('本站 origin 命中白名单', () => {
    expect(classifyLink('https://th.saop.cc/kourindou', OWN).kind).toBe(
      'internal',
    )
    // 图床：用户刚上传的截图不该被判成站外链接
    expect(classifyLink('https://img.th.saop.cc/post/a.webp', OWN).kind).toBe(
      'internal',
    )
  })

  test('协议相对与反斜杠变体解析成站外 host', () => {
    // WHATWG 对 special scheme 把 \ 当 /，两者都落到 evil.example
    for (const u of ['//evil.example/a', '/\\evil.example']) {
      const r = classifyLink(u, OWN)
      expect(r).toEqual({ kind: 'external', origin: 'https://evil.example' })
    }
  })

  test('非 http 协议一律 opaque', () => {
    expect(classifyLink('mailto:a@b.com', OWN).kind).toBe('opaque')
    expect(classifyLink('data:text/html,x', OWN).kind).toBe('opaque')
    // 制表符切开的 javascript: 由解析器归位
    expect(classifyLink('java\tscript:alert(1)', OWN).kind).toBe('opaque')
  })
})

describe('hasExternalLink', () => {
  /**
   * 这一组每一条都是上一版正则漏掉的写法，且每一条都渲染成可点的站外目标。
   * 它们是这次改写的**全部理由**——少一条就说明又能用五个字符绕过。
   */
  test.each([
    ['裸 scheme', '看这个 https://evil.example/spam'],
    ['gfm autolink www', '好货在 www.evil.example/spam 快来'],
    ['协议相对链接', '[广告](//evil.example/spam)'],
    ['反斜杠变体', '[广告](/\\evil.example)'],
    ['邮箱自动链接', '联系 spam@evil.example'],
    ['引用式定义', '看[这个][1]\n\n[1]: //evil.example/spam'],
    ['远程图片', '![img](//evil.example/track.png)'],
    ['data URI', '[x](data:text/html;base64,PHNjcmlwdD4=)'],
  ])('拦下：%s', (_name, md) => {
    expect(hasExternalLink(md, OWN)).toBe(true)
  })

  test.each([
    ['站内深链', '见 [这个主题](/shrine/topics/abc)'],
    ['本站绝对地址', '见 https://th.saop.cc/kourindou/x'],
    ['自己上传的图', '![截图](https://img.th.saop.cc/post/a.webp)'],
    ['代码块里的 URL', '```\ncurl https://evil.example\n```'],
    ['行内代码里的 URL', '用 `https://evil.example` 这个地址'],
    ['纯文本域名（渲染后不可点）', '那个站叫 evil.example，自己搜'],
  ])('放行：%s', (_name, md) => {
    expect(hasExternalLink(md, OWN)).toBe(false)
  })

  test('没有配置本站 origin 时，本站链接也算站外——宁可误伤不可漏', () => {
    expect(hasExternalLink('见 https://th.saop.cc/x', [])).toBe(true)
  })
})
