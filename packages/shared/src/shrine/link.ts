import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { visit } from 'unist-util-visit'

/**
 * 从 Markdown 正文里抽出**所有会渲染成可点目标**的 URL。
 *
 * 与 {@link extractMentions} 同一套 mdast + gfm，理由也相同：判定必须跑在
 * 渲染器看到的那棵树上，不能跑在裸文本上。
 *
 * 上一版是 `/\bhttps?:\/\/[^\s)<>]+/`，实测漏掉的形状比它认得的还多——
 * 每一条都会渲染成可点的站外链接：
 *
 * | 写法                        | 正则  | 渲染结果                    |
 * |-----------------------------|-------|-----------------------------|
 * | `www.evil.example/spam`     | 漏    | `http://www.evil.example/…` |
 * | `[x](//evil.example)`       | 漏    | `https://evil.example`      |
 * | `[x](/\evil.example)`       | 漏    | `https://evil.example`      |
 * | `spam@evil.example`         | 漏    | `mailto:…`                  |
 * | `[1]: //evil.example` + 引用 | 漏    | `https://evil.example`      |
 * | `![](//evil.example/a.png)` | 漏    | 记录每个访客 IP 的远程图片  |
 *
 * 反过来，正则误伤的也不少：代码块里贴的 URL、以及本站自己的链接。走 AST
 * 之后 `code` / `inlineCode` 天然不产生 url 节点，误伤自动消失。
 *
 * 只收 url 字段，不收 title/alt——那些不是可点目标。
 */
export function extractLinkUrls(md: string): string[] {
  const tree = fromMarkdown(md, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })

  const out: string[] = []
  visit(tree, (node) => {
    // definition 是引用式链接的定义行，它本身不渲染，但引用它的地方渲染
    const url = (node as { url?: unknown }).url
    if (typeof url === 'string' && url !== '' && !out.includes(url)) {
      out.push(url)
    }
  })
  return out
}

/**
 * URL 里要先剥掉的字符：控制字符、空白、零宽、BOM。
 *
 * `java\tscript:alert(1)` 这类写法靠它归位——WHATWG 解析器自己也剥，
 * 这里先剥一遍是为了让「剥完是什么」在日志和测试里看得见。
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 剥控制字符正是本意
const CTRL = /[\u0000-\u0020\u007f\u200b-\u200f\u2028\u2029\ufeff]/g

/**
 * 相对地址的解析基准。**故意用一个不可能属于任何人的 host**：
 * 解析后 origin 还等于它，就说明这是一个站内相对路径。
 */
const SENTINEL = 'https://internal.invalid'

export type LinkTarget =
  | { kind: 'internal' }
  /** http(s) 的站外地址 */
  | { kind: 'external'; origin: string }
  /** mailto: / data: / javascript: 等非 http(s) 协议，一律按站外算 */
  | { kind: 'opaque'; protocol: string }

/**
 * 判定一个 URL 是站内还是站外。
 *
 * **判定方式是「解析出来的 origin 是不是我们的」，不是「有没有 scheme」。**
 * 前一版按 scheme 判，于是所有不写 scheme 的写法（`//host`、`/\host`、
 * `www.host` 自动链接）全部被判成站内——而那恰好是发广告最省事的写法。
 *
 * `mailto:` 归入站外：「加我邮箱」是垃圾贴最常见的落地方式，
 * 与贴一条外链在治理上是同一件事。
 *
 * @param ownOrigins 本站自己的 origin（站点域名、图床基址）。命中即站内——
 *   否则用户把刚上传到自建 MinIO 的截图插进帖子会被判成站外链接。
 */
export function classifyLink(
  url: string,
  ownOrigins: readonly string[] = [],
): LinkTarget {
  const clean = url.replace(CTRL, '')
  let parsed: URL
  try {
    parsed = new URL(clean, SENTINEL)
  } catch {
    // 解析不了的东西渲染器也解析不了，当站内（渲染后不可点）
    return { kind: 'internal' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'opaque', protocol: parsed.protocol }
  }
  if (parsed.origin === SENTINEL) return { kind: 'internal' }
  if (ownOrigins.includes(parsed.origin)) return { kind: 'internal' }
  return { kind: 'external', origin: parsed.origin }
}

/** 正文里有没有站外链接（含 mailto/data 这类非 http 协议） */
export function hasExternalLink(
  md: string,
  ownOrigins: readonly string[] = [],
): boolean {
  return extractLinkUrls(md).some(
    (u) => classifyLink(u, ownOrigins).kind !== 'internal',
  )
}
