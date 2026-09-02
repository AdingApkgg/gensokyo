import { BOARD_SLUGS, type BoardSlug } from '@gensokyo/shared'
import { Link } from 'react-router'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { boardDescription, boardLabel } from '~/lib/display'
import { localizeHref } from '~/paraglide/runtime'

/**
 * 六版块静态网格。纯 chrome、零请求、**永远渲染**——
 * 最新流为空时它就是页面的全部内容，也是「这里有六个地方可以去」的唯一提示。
 */
export function BoardNav({ current }: { current?: BoardSlug }) {
  return (
    <nav className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {BOARD_SLUGS.map((b) => (
        <Link
          key={b}
          to={localizeHref(`/shrine/b/${b}`)}
          aria-current={b === current ? 'page' : undefined}
        >
          <Card
            className={`h-full transition-colors hover:border-primary/50 ${b === current ? 'border-primary' : ''}`}
          >
            <CardHeader>
              <CardTitle className="font-heading text-base">
                {boardLabel(b)}
              </CardTitle>
              <CardDescription className="line-clamp-2">
                {boardDescription(b)}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </nav>
  )
}
