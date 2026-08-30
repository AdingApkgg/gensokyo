import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { visit } from 'unist-util-visit'
import { HANDLE_RE, isReservedHandle } from '../ids'
import { MAX_MENTIONS_PER_POST } from './enums'

/**
 * 提及的匹配规则。**只跑在 mdast 的 text 节点上**，不跑在 raw markdown 上。
 *
 * 前导用 Unicode 感知的负向后顾，不能写 `[^\w@]`：JS 的 `\w` 只等价于
 * [A-Za-z0-9_]，任何汉字或假名都满足 `[^\w@]`。本站主语言是中日文，
 * 「联系我：小明@gmail.com」是常态写法——用 `\w` 的话它会抽出 `gmail`，
 * 而 gmail / qq / 163 全是合法且可注册的 handle，谁注册谁就坐收全站
 * 中日文邮箱地址带来的通知。这既是误伤也是可主动占位的放大器。
 *
 * 尾部拒绝 `.` + 小写字母：挡住行首邮箱（`@163.com`）这种前面没有字符、
 * 后顾无从判断的情况。用 `[a-z]` 而不是 `\p{L}`，否则「谢谢 @reimu.好」
 * 会被误拒。
 */
const MENTION =
  /(?<![\p{L}\p{N}_@])@([a-z0-9][a-z0-9_]{1,19})(?![a-z0-9_])(?!\.[a-z])/gu

/**
 * 这些节点里的文字**不算提及**：
 *
 * - `code` / `inlineCode`：贴一段含 @ 的代码不该给一群无关的人发通知。
 *   走 mdast 之后，未闭合围栏、`~~~`、四空格缩进、多反引号、跨行 code span
 *   五种写法一次性全对——正则版只挡住了其中两种。
 * - `html`：计划禁用 rehype-raw，html 节点渲染时会被整个丢弃。
 *   `<!-- @reimu -->` 里的 @ 发得出通知却一个字都看不到。
 * - `definition` / `linkReference` / `imageReference`：链接引用定义那一行
 *   （`[@reimu]: https://…`）任何 CommonMark 都不渲染。
 * - `link` / `image`：url、title、alt 都不是可见正文。gfm 的 autolink literal
 *   会把裸 URL 变成 link 节点，于是 `https://x.com/@reimu` 也自动排除。
 *
 * 「发得出通知但渲染后看不见」是本站最没有防御的失败模式：被 @ 的人点进来
 * 找不到痕迹，版主看渲染结果也拿不到可处置的证据，而本站明确不做私信与拉黑。
 */
const OPAQUE = new Set([
  'code',
  'inlineCode',
  'html',
  'definition',
  'linkReference',
  'imageReference',
  'link',
  'image',
])

/**
 * 从 Markdown 正文里抽出被提及的 handle。
 *
 * 这是 @ 解析的**唯一**实现：api 据它决定给谁发通知，web 据它把 @xxx
 * 渲染成链接。两处各写一遍必然漂移，而漂移的表现是「看得到链接但收不到
 * 通知」这种没人会报的 bug。
 *
 * 解析用与渲染器同一套 mdast + gfm，所以「渲染出来的可见文字」与
 * 「据以发通知的文字」是同一棵树上的同一批节点。
 *
 * 返回值最多 MAX_MENTIONS_PER_POST + 1 个：**多返回一个是故意的**，
 * 让路由层能判断「超限」并返回 mention_limit_exceeded，而不是静默截断到
 * 10 个——静默截断会让发帖人以为都提及到了。
 */
export function extractMentions(md: string): string[] {
  const tree = fromMarkdown(md, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })

  const out: string[] = []
  let full = false

  visit(tree, (node) => {
    if (full) return false
    // 整棵子树跳过：link 的 children 是可见的，但 url/title 不是，
    // 而 @ 出现在可见 children 里时它本来就是链接文字的一部分，不该当提及
    if (OPAQUE.has(node.type)) return 'skip'
    if (node.type !== 'text') return

    for (const m of node.value.matchAll(MENTION)) {
      const h = m[1]
      if (!h) continue
      // 正则已限定字符集，这是防它被改宽时的第二道
      if (!HANDLE_RE.test(h)) continue
      // 保留字不是任何人的 handle，@admin 不该指向任何人
      if (isReservedHandle(h)) continue
      if (out.includes(h)) continue

      out.push(h)
      if (out.length > MAX_MENTIONS_PER_POST) {
        full = true
        return false
      }
    }
  })

  return out
}
