import {
  createFileSchema,
  createResourceSchema,
  LICENSE_STATUS,
  type LicenseStatus,
  LOCALES,
  MIRROR_KIND,
  type MirrorKind,
  RESOURCE_KIND,
  type ResourceKind,
} from '@gensokyo/shared'
import { Plus, Trash2, Upload as UploadIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, redirect, useFetcher } from 'react-router'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Textarea } from '~/components/ui/textarea'
import { apiFor } from '~/lib/api'
import { kindLabel, licenseLabel, licenseVariant } from '~/lib/display'
import { m } from '~/paraglide/messages'
import { localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/upload'

export function meta() {
  return [{ title: `${m.upload_title()} · ${m.site_name()}` }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const res = await apiFor(request).api.me.$get()
  const body = await res.json()
  if (!('user' in body) || !body.user) {
    throw redirect(localizeHref('/login'))
  }
  return null
}

type Mirror = {
  label: string
  url: string
  mirrorKind: MirrorKind
  extractCode: string
}

/**
 * 编辑期多带一个 key：镜像可以中途删除，拿下标当 React key 会让后一条
 * 复用前一条的 DOM，正在输入的那格会跳焦点、打断中日文输入法的候选。
 * key 只活在表单里，提交前剥掉，不进 payload。
 */
type MirrorDraft = Mirror & { key: string }

/** 一次投稿是三个调用：建草稿 → 挂版本与链接 → 投递。中途失败要能说清停在哪 */
export async function action({ request }: Route.ActionArgs) {
  const api = apiFor(request)
  const form = await request.formData()

  const parsedResource = createResourceSchema.safeParse({
    titleOriginal: form.get('titleOriginal'),
    titleOriginalLocale: form.get('titleOriginalLocale'),
    kind: form.get('kind'),
    license: form.get('license'),
    licenseNote: form.get('licenseNote') || undefined,
    circleNameRaw: form.get('circleNameRaw') || undefined,
    coverUrl: form.get('coverUrl') || undefined,
    description: form.get('description')
      ? { zh: String(form.get('description')) }
      : {},
  })
  if (!parsedResource.success) return { ok: false as const }

  const mirrors = JSON.parse(String(form.get('mirrors') ?? '[]')) as Mirror[]
  const files = mirrors.map((mi) =>
    createFileSchema.parse({
      label: mi.label,
      url: mi.url,
      mirrorKind: mi.mirrorKind,
      extractCode: mi.extractCode || undefined,
    }),
  )

  const created = await api.api.kourindou.resources.$post({
    json: parsedResource.data,
  })
  const createdBody = await created.json()
  if ('error' in createdBody) return { ok: false as const }
  const { id, slug } = createdBody.resource

  const ver = await api.api.kourindou.resources[':id'].versions.$post({
    param: { id },
    json: { label: 'v1', changelog: '', files },
  })
  if (!ver.ok) return { ok: false as const, slug }

  const submitted = await api.api.kourindou.resources[':id'].submit.$post({
    param: { id },
  })
  const submitBody = await submitted.json()
  if ('error' in submitBody) return { ok: false as const, slug }

  return { ok: true as const, slug, autoPublished: submitBody.autoPublished }
}

// ------------------------------------------------------------------ 组件

function CoverPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const inputId = useId()

  async function upload(file: File) {
    setState('busy')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('purpose', 'cover')
    try {
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error('upload failed')
      const body = (await res.json()) as { url: string }
      onChange(body.url)
      setState('idle')
    } catch {
      // 失败只影响封面，表单其余内容原样保留
      setState('failed')
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{m.upload_field_cover()}</Label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className="size-16 rounded object-cover" />
        ) : (
          <div className="size-16 rounded bg-muted" />
        )}
        <div className="grid gap-1">
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="text-sm file:mr-2 file:rounded file:border file:bg-background file:px-2 file:py-1"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
            }}
          />
          <p className="text-xs text-muted-foreground">
            {state === 'busy'
              ? m.upload_cover_uploading()
              : m.upload_cover_hint()}
          </p>
          {state === 'failed' && (
            <p className="text-xs text-destructive">
              {m.upload_cover_failed()}
            </p>
          )}
        </div>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange('')}
          >
            {m.upload_cover_remove()}
          </Button>
        )}
      </div>
    </div>
  )
}

/** 许可状态用带解释的卡片而不是下拉框——它是本站最重要的字段，值得占版面 */
function LicensePicker({
  value,
  onChange,
}: {
  value: LicenseStatus | ''
  onChange: (v: LicenseStatus) => void
}) {
  const desc: Record<LicenseStatus, string> = {
    allowed: m.upload_license_allowed_desc(),
    unspecified: m.upload_license_unspecified_desc(),
    out_of_print: m.upload_license_out_of_print_desc(),
    licensed: m.upload_license_licensed_desc(),
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">
        {m.upload_license_legend()}
        <span className="ml-2 text-xs font-normal text-destructive">
          {m.upload_license_required()}
        </span>
      </legend>
      <p className="mb-1 max-w-prose text-xs leading-5 text-muted-foreground">
        {m.upload_license_why()}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {LICENSE_STATUS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChange(l)}
            aria-pressed={value === l}
            className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${
              value === l ? 'border-primary bg-muted/40' : ''
            }`}
          >
            <Badge variant={licenseVariant(l)}>{licenseLabel(l)}</Badge>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {desc[l]}
            </p>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

let mirrorSeq = 0
const emptyMirror = (): MirrorDraft => ({
  key: `m${mirrorSeq++}`,
  label: '',
  url: '',
  mirrorKind: 'netdisk',
  extractCode: '',
})

/** 剥掉只在表单里用的 key，别让它进提交的 JSON */
const toPayload = ({ key: _key, ...rest }: MirrorDraft): Mirror => rest

const mirrorLabel = (k: MirrorKind) =>
  ({
    netdisk: m.mirror_netdisk(),
    direct: m.mirror_direct(),
    torrent: m.mirror_torrent(),
    magnet: m.mirror_magnet(),
    other: m.mirror_other(),
  })[k]

export default function UploadWizard() {
  const fetcher = useFetcher<typeof action>()
  const [step, setStep] = useState(1)

  const [titleOriginal, setTitleOriginal] = useState('')
  const [locale, setLocale] = useState<string>('ja')
  const [kind, setKind] = useState<ResourceKind>('music')
  const [circle, setCircle] = useState('')
  const [description, setDescription] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [license, setLicense] = useState<LicenseStatus | ''>('')
  const [licenseNote, setLicenseNote] = useState('')
  const [mirrors, setMirrors] = useState<MirrorDraft[]>([emptyMirror()])
  const [errors, setErrors] = useState<string[]>([])

  const result = fetcher.data
  const busy = fetcher.state !== 'idle'

  // 提交完成后不再显示表单
  if (result?.ok) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-heading text-2xl font-bold">
          {result.autoPublished
            ? m.upload_ok_published()
            : m.upload_ok_pending()}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {result.autoPublished
            ? m.upload_ok_published_desc()
            : m.upload_ok_pending_desc()}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild>
            <Link to={localizeHref(`/kourindou/${result.slug}`)}>
              {m.upload_view()}
            </Link>
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            {m.upload_again()}
          </Button>
        </div>
      </main>
    )
  }

  /** 每步用同一份 zod 契约校验，错误就地显示 */
  function next() {
    if (step === 1) {
      const parsed = createResourceSchema.safeParse({
        titleOriginal,
        titleOriginalLocale: locale,
        kind,
        license: license || undefined,
        licenseNote: licenseNote || undefined,
        circleNameRaw: circle || undefined,
        coverUrl: coverUrl || undefined,
      })
      if (!parsed.success) {
        setErrors([
          ...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? ''))),
        ])
        return
      }
    }
    if (step === 2) {
      const usable = mirrors.filter((mi) => mi.url.trim() && mi.label.trim())
      if (usable.length === 0) return setErrors(['mirrors'])
      for (const mi of usable) {
        const ok = createFileSchema.safeParse({
          label: mi.label,
          url: mi.url,
          mirrorKind: mi.mirrorKind,
          extractCode: mi.extractCode || undefined,
        })
        if (!ok.success) return setErrors(['url'])
      }
    }
    setErrors([])
    setStep(step + 1)
  }

  function submit() {
    const usable = mirrors.filter((mi) => mi.url.trim() && mi.label.trim())
    fetcher.submit(
      {
        titleOriginal,
        titleOriginalLocale: locale,
        kind,
        license,
        licenseNote,
        circleNameRaw: circle,
        coverUrl,
        description,
        mirrors: JSON.stringify(usable.map(toPayload)),
      },
      { method: 'post' },
    )
  }

  const err = (field: string) => errors.includes(field)

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header>
        <h1 className="font-heading text-2xl font-bold">{m.upload_title()}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.upload_step({ n: step })} ·{' '}
          {[m.upload_step1(), m.upload_step2(), m.upload_step3()][step - 1]}
        </p>
      </header>

      <Separator className="my-6" />

      {step === 1 && (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="titleOriginal">{m.upload_field_title()}</Label>
            <Input
              id="titleOriginal"
              value={titleOriginal}
              onChange={(e) => setTitleOriginal(e.target.value)}
              aria-invalid={err('titleOriginal')}
              required
            />
            <p className="text-xs text-muted-foreground">
              {m.upload_field_title_hint()}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>{m.upload_field_locale()}</Label>
              <Select value={locale} onValueChange={setLocale}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {{ zh: '中文', ja: '日本語', en: 'English' }[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{m.upload_field_kind()}</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as ResourceKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_KIND.map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="circle">{m.upload_field_circle()}</Label>
            <Input
              id="circle"
              value={circle}
              onChange={(e) => setCircle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {m.upload_field_circle_hint()}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">{m.upload_field_desc()}</Label>
            <Textarea
              id="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <CoverPicker value={coverUrl} onChange={setCoverUrl} />

          <Separator />

          <LicensePicker value={license} onChange={setLicense} />
          {err('license') && (
            <p className="text-sm text-destructive">
              {m.upload_license_required()}
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="licenseNote">{m.upload_license_note()}</Label>
            <Input
              id="licenseNote"
              value={licenseNote}
              onChange={(e) => setLicenseNote(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {m.upload_license_note_hint()}
            </p>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4">
          {mirrors.map((mi, i) => (
            <Card key={mi.key}>
              <CardContent className="grid gap-3 pt-5">
                <div className="grid gap-2">
                  <Label>{m.upload_mirror_label()}</Label>
                  <Input
                    value={mi.label}
                    placeholder={m.upload_mirror_label_ph()}
                    onChange={(e) => {
                      const next = [...mirrors]
                      const cur = next[i]
                      if (cur) cur.label = e.target.value
                      setMirrors(next)
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{m.upload_mirror_url()}</Label>
                  <Input
                    value={mi.url}
                    placeholder="https://…"
                    aria-invalid={err('url')}
                    onChange={(e) => {
                      const next = [...mirrors]
                      const cur = next[i]
                      if (cur) cur.url = e.target.value
                      setMirrors(next)
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>{m.upload_mirror_kind()}</Label>
                    <Select
                      value={mi.mirrorKind}
                      onValueChange={(v) => {
                        const next = [...mirrors]
                        const cur = next[i]
                        if (cur) cur.mirrorKind = v as MirrorKind
                        setMirrors(next)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MIRROR_KIND.map((k) => (
                          <SelectItem key={k} value={k}>
                            {mirrorLabel(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>{m.upload_mirror_code()}</Label>
                    <Input
                      value={mi.extractCode}
                      onChange={(e) => {
                        const next = [...mirrors]
                        const cur = next[i]
                        if (cur) cur.extractCode = e.target.value
                        setMirrors(next)
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      {m.upload_mirror_code_hint()}
                    </p>
                  </div>
                </div>
                {mirrors.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-self-end"
                    onClick={() =>
                      setMirrors(mirrors.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 /> {m.upload_mirror_remove()}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}

          {err('mirrors') && (
            <p className="text-sm text-destructive">{m.upload_mirror_none()}</p>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => setMirrors([...mirrors, emptyMirror()])}
          >
            <Plus /> {m.upload_mirror_add()}
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{kindLabel(kind)}</Badge>
                {license && (
                  <Badge variant={licenseVariant(license)}>
                    {licenseLabel(license)}
                  </Badge>
                )}
              </div>
              <CardTitle className="mt-2">{titleOriginal}</CardTitle>
              {circle && (
                <p className="text-sm text-muted-foreground">{circle}</p>
              )}
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {description && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {description}
                </p>
              )}
              {mirrors
                .filter((mi) => mi.url.trim())
                .map((mi) => (
                  <div
                    key={mi.url}
                    className="flex items-center gap-2 rounded border p-2"
                  >
                    <Badge variant="outline">
                      {mirrorLabel(mi.mirrorKind)}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">{mi.label}</span>
                    {mi.extractCode && (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {mi.extractCode}
                      </code>
                    )}
                  </div>
                ))}
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground">
            {m.upload_review_hint()}
          </p>
          {result?.ok === false && (
            <p className="text-sm text-destructive">{m.upload_failed()}</p>
          )}
        </div>
      )}

      <div className="mt-8 flex items-center gap-3">
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep(step - 1)}
          >
            {m.upload_back()}
          </Button>
        )}
        {step < 3 ? (
          <Button type="button" onClick={next} className="ml-auto">
            {m.upload_next()}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={submit}
            disabled={busy}
            className="ml-auto"
          >
            <UploadIcon /> {m.upload_submit()}
          </Button>
        )}
      </div>
    </main>
  )
}
