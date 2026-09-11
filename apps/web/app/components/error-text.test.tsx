import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { ErrorText } from './error-text'

/**
 * ⚠️ 这是 web 包里**唯一**一条渲染组件的测试，刻意如此。
 *
 * 别的都是 `app/lib/` 下的纯函数——「能抽成纯函数就抽出来测」那条约定仍然
 * 成立。但这一条要钉的事实恰恰**只存在于 JSX 里**：`email_unverified` 这个
 * 拒绝必须带着一条能点的、指向 `/verify` 的链接。把判断抽成
 * `errorEscapeHref()` 再测那个纯函数是自欺——删掉 `<Link>` 那几行，纯函数
 * 测试照样全绿，而屏幕上又变回一句无路可走的死话（这个里程碑已经出过一次
 * 「功能删了测试还过」）。
 *
 * 不需要 DOM：`renderToStaticMarkup` 出字符串，`MemoryRouter` 只是给 `Link`
 * 一个能算 href 的上下文。所以这条测试没有给 CI 添任何新依赖。
 */
describe('ErrorText', () => {
  const html = (code: string | undefined) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <ErrorText code={code} />
      </MemoryRouter>,
    )

  test('email_unverified 带一条指向 /verify 的链接 —— 拒绝必须有出路', () => {
    const out = html('email_unverified')
    expect(out).toContain('<a')
    expect(out).toContain('href="/verify"')
  })

  test('没有出路的错误码不凭空加链接', () => {
    // forbidden / not_found 用户自己解决不了，给个链接只是把人送去另一个死胡同
    expect(html('forbidden')).not.toContain('<a')
    expect(html(undefined)).not.toContain('<a')
  })

  test('文案本身照旧来自 errorMessage —— 链接是追加的，不是替换', () => {
    expect(html('email_unverified').length).toBeGreaterThan(
      html('forbidden').length,
    )
    expect(html('forbidden').length).toBeGreaterThan(0)
  })
})
