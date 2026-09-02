import {
  isReservedHandle,
  MENTION_OPAQUE_NODES,
  MENTION_RE,
} from '@gensokyo/shared'
import type { Root } from 'mdast'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { SKIP, visit } from 'unist-util-visit'
import { externalLinkProps, isInternalHref } from '~/lib/links'
import { localizeHref } from '~/paraglide/runtime'

/**
 * Markdown 渲染管线：react-markdown + remark-gfm/breaks + rehype-sanitize。
 *
 * **坚决不装 `rehype-raw`**——CLAUDE.md 的原话：任何 PR 里出现它都是安全事故。
 * 没有它，正文里的原始 HTML 会被当成文本，这正是要的。
 *
 * 净化 schema 三处收紧：
 * - `protocols` 用展开而不是整体替换：原写法整体替换掉了 defaultSchema.protocols，
 *   `img.src` 因此失去协议白名单。
 * - 不允许任何 className（默认给 `code` 留了 language-* 例外）：本站不做高亮，
 *   一个可控的 class 就是一个样式注入面。
 * - `a` 只留 href/title，`img` 只留 src/alt/title。
 */
const schema = {
  ...defaultSchema,
  /**
   * 不再给 id 加前缀：这条管线没有 rehype-raw，hast 里的 id **只可能**来自
   * remark-rehype 的脚注，而它已经带了 `user-content-` 前缀。再加一层就是
   * `user-content-user-content-fn-1`，href 指向不存在的元素，脚注跳转全部失效。
   * ⚠️ 若将来引入任何能生成 id 的插件，必须把这条恢复成默认值。
   */
  clobberPrefix: '',
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
  attributes: {
    ...defaultSchema.attributes,
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    code: [],
    '*': (defaultSchema.attributes?.['*'] ?? []).filter(
      (a) => a !== 'className' && a !== 'style',
    ),
  },
}

/**
 * 把 text 节点里的 @handle 变成 /u/:handle 链接。
 *
 * 用的是 shared 的 **同一条** MENTION_RE 与同一份 OPAQUE 集合：
 * 「渲染出来的可见链接」与「据以发通知的提及」是同一批节点——
 * 两边各写一份必然漂移，漂移的表现是「看得到链接但收不到通知」。
 */
function remarkMentions() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (MENTION_OPAQUE_NODES.has(node.type)) return SKIP
      if (node.type !== 'text' || !parent || index === undefined) return
      const value = node.value
      const matches = [...value.matchAll(MENTION_RE)]
      if (matches.length === 0) return

      const out: unknown[] = []
      let cursor = 0
      for (const mt of matches) {
        const start = mt.index ?? 0
        const handle = mt[1] as string
        // 与 extractMentions 同一条规则：保留字不是任何人的 handle，@admin 不该成链接
        if (isReservedHandle(handle)) continue
        if (start > cursor)
          out.push({ type: 'text', value: value.slice(cursor, start) })
        out.push({
          type: 'link',
          url: localizeHref(`/u/${handle}`),
          children: [{ type: 'text', value: `@${handle}` }],
        })
        cursor = start + mt[0].length
      }
      if (cursor < value.length)
        out.push({ type: 'text', value: value.slice(cursor) })
      parent.children.splice(index, 1, ...(out as never[]))
      return index + out.length
    })
  }
}

const components: Components = {
  a({ href, children, node: _node, ...rest }) {
    const h = href ?? ''
    if (isInternalHref(h)) {
      return (
        <a href={h} {...rest}>
          {children}
        </a>
      )
    }
    return (
      <a href={h} {...rest} {...externalLinkProps}>
        {children}
      </a>
    )
  },
  img({ src, alt, title }) {
    // 远程图片不带 referrer；lazy 让一屏几十张图的主题不至于一次全拉
    return (
      <img
        src={src}
        alt={alt ?? ''}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-h-[32rem] rounded-md"
      />
    )
  },
}

export function Markdown({
  children,
  lang,
}: {
  children: string
  lang?: string | null
}) {
  return (
    <div lang={lang ?? undefined} className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMentions]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
