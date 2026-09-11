import { LOCALES, type Locale, type LocalizedText } from '@gensokyo/shared'
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { ErrorText } from '~/components/error-text'
import { LiveRegion } from '~/components/live-region'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { m } from '~/paraglide/messages'

/**
 * 三个语言的自称。**不进 messages**：语言名在三种界面下都是同一个词，
 * 做成可翻译条目只会得到三份一模一样的值。site-header 的 LangSwitcher
 * 里有同样的一份——那边不从这里 import 是为了不把 shared（连带 zod）
 * 拖进首屏可达集。
 */
const ENDONYM: Record<Locale, string> = {
  zh: '中文',
  ja: '日本語',
  en: 'English',
}

type Props = {
  resourceId: string
  title: LocalizedText | null
  description: LocalizedText | null
  /** 投稿者本人或 staff。只有他们能改写已经写好的译名 */
  canOverwrite: boolean
  action: string
}

/**
 * 补译名。**登录用户才渲染**——匿名读者是 /kourindou/:slug 的绝大多数，
 * 给他们一张永远点不动的表单只是徒增首屏。
 *
 * 不做「提议 → 审核」队列，因为陌生人只能填空位：填空是纯增量，写坏了由
 * 作者或 staff 覆写即可。这条判据的权威在 api 侧（`isTranslationOverwrite`），
 * 这里的 disabled 只是提前把结果说出来，不是闸门。
 */
export function TranslateCard({
  resourceId,
  title,
  description,
  canOverwrite,
  action,
}: Props) {
  const fetcher = useFetcher<{
    ok: boolean
    intent?: string
    code?: string
  }>()
  const [locale, setLocale] = useState<Locale>(() => {
    // 默认落在第一个空着的语言上：那是这张卡片唯一对陌生人开放的格子
    return LOCALES.find((l) => !title?.[l]?.trim()) ?? LOCALES[0]
  })

  /**
   * 取**这个语言自己的**值，不能用 displayTitle 的回落值：选到 en 时
   * 把中文译名填进输入框，用户一按保存就把中文存成了英文译名。
   */
  const savedTitle = title?.[locale] ?? ''
  const savedDesc = description?.[locale] ?? ''
  const [draftTitle, setDraftTitle] = useState(savedTitle)
  const [draftDesc, setDraftDesc] = useState(savedDesc)

  // 换语言时把草稿换成那个语言的现值
  const [shownLocale, setShownLocale] = useState<Locale>(locale)
  if (shownLocale !== locale) {
    setShownLocale(locale)
    setDraftTitle(savedTitle)
    setDraftDesc(savedDesc)
  }

  const filled = savedTitle.trim() !== '' || savedDesc.trim() !== ''
  const locked = filled && !canOverwrite
  const changed = draftTitle !== savedTitle || draftDesc !== savedDesc
  const busy = fetcher.state !== 'idle'
  const result = fetcher.data?.intent === 'translate' ? fetcher.data : undefined

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-sm">{m.translate_heading()}</CardTitle>
        <p className="text-sm text-muted-foreground">{m.translate_hint()}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* fieldset/legend 而不是 role="group"：语言选择是一组互斥选项，
            屏幕阅读器靠 legend 播报它们属于哪一组 */}
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">{m.translate_locale()}</legend>
          {LOCALES.map((l) => {
            const has = (title?.[l] ?? '').trim() !== ''
            return (
              <Button
                key={l}
                type="button"
                size="sm"
                variant={l === locale ? 'default' : 'outline'}
                aria-pressed={l === locale}
                onClick={() => setLocale(l)}
              >
                <span lang={l}>{ENDONYM[l]}</span>
                {has && (
                  <span className="text-xs opacity-70">
                    ·<span className="sr-only"> {m.translate_has()}</span>
                  </span>
                )}
              </Button>
            )
          })}
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor="tr-title">{m.translate_title_label()}</Label>
          <Input
            id="tr-title"
            lang={locale}
            value={draftTitle}
            disabled={locked || busy}
            onChange={(e) => setDraftTitle(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="tr-desc">{m.translate_desc_label()}</Label>
          <Textarea
            id="tr-desc"
            rows={3}
            lang={locale}
            value={draftDesc}
            disabled={locked || busy}
            onChange={(e) => setDraftDesc(e.target.value)}
          />
        </div>

        {locked && (
          <p className="text-xs text-muted-foreground">
            {m.translate_locked()}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={locked || busy || !changed}
            onClick={() =>
              fetcher.submit(
                {
                  intent: 'translate',
                  id: resourceId,
                  locale,
                  title: draftTitle,
                  description: draftDesc,
                },
                { method: 'post', action },
              )
            }
          >
            {m.translate_submit()}
          </Button>
          {result?.ok === false && (
            <p role="alert" className="text-xs text-destructive">
              <ErrorText code={result.code} />
            </p>
          )}
        </div>

        {/* 「办完了吗」先问有没有一行字，再问要不要动画 */}
        <LiveRegion>{result?.ok ? m.translate_saved() : null}</LiveRegion>
      </CardContent>
    </Card>
  )
}
