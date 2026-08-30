import { describe, expect, test } from 'bun:test'
import { MAX_MENTIONS_PER_POST } from './enums'
import { extractMentions } from './mention'

describe('extractMentions：抽得出来', () => {
  test('普通提及', () => {
    expect(extractMentions('你好 @reimu 和 @marisa_')).toEqual([
      'reimu',
      'marisa_',
    ])
  })

  test('行首的提及', () => {
    expect(extractMentions('@reimu 早')).toEqual(['reimu'])
  })

  test('中日文紧邻时边界正确——handle 的字符集不含 CJK，到汉字就该停', () => {
    expect(extractMentions('@reimu的帖子')).toEqual(['reimu'])
    expect(extractMentions('@marisaさんへ')).toEqual(['marisa'])
  })

  test('去重且保序', () => {
    expect(extractMentions('@a1 @b1 @a1')).toEqual(['a1', 'b1'])
  })

  test('标点后紧跟的提及', () => {
    expect(extractMentions('（@reimu）')).toEqual(['reimu'])
  })
})

describe('extractMentions：邮箱不是提及', () => {
  test('ASCII 局部名', () => {
    expect(extractMentions('联系 foo@example.com')).toEqual([])
  })

  /**
   * 回归：`[^\w@]` 版本在这三条上全部误抽。JS 的 \w 只等价 [A-Za-z0-9_]，
   * 汉字假名都满足 [^\w@]，而本站主语言就是中日文。
   * 更糟的是 qq / gmail / example 全是合法可注册的 handle——
   * 谁注册 @gmail 谁就坐收全站中日文邮箱带来的通知。
   */
  test('中日文局部名（回归：曾抽出 qq / gmail / example）', () => {
    expect(extractMentions('我的邮箱是张三@qq.com')).toEqual([])
    expect(extractMentions('联系我：小明@gmail.com 谢谢')).toEqual([])
    expect(extractMentions('メールはれいむ@example.com です')).toEqual([])
  })

  test('行首邮箱——前面没有字符，只能靠尾部的域名判定挡', () => {
    expect(extractMentions('@163.com 是我的邮箱')).toEqual([])
  })

  test('但句末的英文句点不影响提及', () => {
    expect(extractMentions('谢谢 @reimu.')).toEqual(['reimu'])
    expect(extractMentions('谢谢 @reimu。')).toEqual(['reimu'])
  })
})

describe('extractMentions：代码里的 @ 不算', () => {
  test('成对围栏', () => {
    expect(extractMentions('```\n@reimu\n```')).toEqual([])
    expect(extractMentions('```ts\nconst x = "@reimu"\n```')).toEqual([])
  })

  test('行内代码', () => {
    expect(extractMentions('看这个 `@reimu` 写法')).toEqual([])
  })

  /**
   * 回归：正则版只挡住了 CommonMark 五种代码构造里的两种。
   * 最常见的触发路径不需要恶意——河童重工里贴报错日志忘了收尾的 ```，
   * 从那行到帖尾所有 @ 全部变成真通知。
   */
  test('未闭合围栏一直延伸到文末（回归）', () => {
    expect(
      extractMentions('看报错：\n```\nERROR at @reimu\n更多 @marisa'),
    ).toEqual([])
  })

  test('~~~ 围栏（回归）——代码里本来就含 ``` 时才会用它', () => {
    expect(extractMentions('~~~ts\nconst a = "@reimu"\n~~~')).toEqual([])
  })

  test('四空格缩进代码块（回归）', () => {
    expect(extractMentions('x\n\n    @reimu\n')).toEqual([])
  })

  test('双反引号行内代码（回归）——代码里含单反引号时才会用它', () => {
    expect(extractMentions('``@reimu``')).toEqual([])
  })

  test('跨行 code span（回归，CommonMark 合法）', () => {
    expect(extractMentions('`const a =\n@reimu`')).toEqual([])
  })

  test('代码块之外的仍然抽得到', () => {
    expect(extractMentions('```\n@a1\n```\n@b1 你看')).toEqual(['b1'])
  })
})

describe('extractMentions：渲染后看不见的地方不算', () => {
  /**
   * 这一组是最重要的：「发得出通知但渲染后一个字都看不到」是本站最没有防御的
   * 失败模式——被 @ 的人点进来找不到痕迹，版主看渲染结果也拿不到证据，
   * 而本站明确不做私信与拉黑，受害者没有任何屏蔽手段。可重复的定向骚扰。
   */
  test('链接引用定义那一行不渲染（回归）', () => {
    expect(
      extractMentions('正常内容\n\n[@reimu]: https://example.com'),
    ).toEqual([])
  })

  test('HTML 注释——禁用 rehype-raw 后 html 节点整个被丢弃（回归）', () => {
    expect(extractMentions('正常内容\n\n<!-- @reimu @marisa -->')).toEqual([])
  })

  test('图片 alt 与链接 title（回归）', () => {
    expect(extractMentions('![@reimu](https://e.com/a.png)')).toEqual([])
    expect(extractMentions('[x](https://e.com "@reimu")')).toEqual([])
  })

  test('URL 路径里的 @——贴一个 misskey 链接不该给同名本站用户发通知', () => {
    expect(extractMentions('看 https://misskey.io/@reimu 这个')).toEqual([])
    expect(extractMentions('[看这个](https://x.com/@reimu)')).toEqual([])
  })

  test('保留字不是提及——@admin 不该给任何人发通知', () => {
    expect(extractMentions('@admin @everyone @reimu')).toEqual(['reimu'])
  })

  test('不合法的 handle 形状不算', () => {
    expect(extractMentions('@_leading')).toEqual([]) // 首字符必须字母数字
    expect(extractMentions('@a')).toEqual([]) // 太短
    expect(extractMentions('@UPPER')).toEqual([]) // 大写不在字符集里
    expect(extractMentions('@with-dash')).toEqual(['with']) // 连字符是终止符
  })

  test('连续 @ 不产生空提及', () => {
    expect(extractMentions('@@reimu')).toEqual([])
  })

  /**
   * 回归：没有尾边界断言时，21 字符的 @ 串会被静默截成前 20 位，
   * 于是通知发给了一个根本没被提到的人——而那个 handle 是真实存在的。
   */
  test('超长 @ 串不被截断成一个合法 handle', () => {
    expect(extractMentions(`@${'a'.repeat(25)}`)).toEqual([])
    expect(extractMentions('@abcdefghij_klmnopqrs_extra')).toEqual([])
  })

  test('零宽字符不能用来伪造前导边界', () => {
    // U+200B 零宽空格：不是 \p{L}/\p{N}，但也不该让邮箱守卫失效
    expect(extractMentions('张三​@qq.com')).toEqual([])
  })
})

describe('extractMentions：数量', () => {
  test('超过上限时多返回一个，让路由层能判超限而不是静默截断', () => {
    const md = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(' ')
    expect(extractMentions(md).length).toBe(MAX_MENTIONS_PER_POST + 1)
  })

  test('恰好等于上限时不多返回', () => {
    const md = Array.from(
      { length: MAX_MENTIONS_PER_POST },
      (_, i) => `@user${i}`,
    ).join(' ')
    expect(extractMentions(md).length).toBe(MAX_MENTIONS_PER_POST)
  })
})
