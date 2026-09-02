import type { MirrorKind } from '@gensokyo/shared'
import { Download, Star } from 'lucide-react'
import { useState } from 'react'
import { data, Form, Link, redirect, useFetcher } from 'react-router'
import { Discussion } from '~/components/discussion/Discussion'
import { ReportDialog } from '~/components/discussion/ReportDialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Separator } from '~/components/ui/separator'
import { apiFor } from '~/lib/api'
import { discussionAction, floorParam } from '~/lib/discussion-action'
import {
  averageRating,
  displayTitle,
  kindLabel,
  licenseLabel,
  licenseVariant,
} from '~/lib/display'
import { m } from '~/paraglide/messages'
import { getLocale, localizeHref } from '~/paraglide/runtime'
import type { Route } from './+types/detail'

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData?.resource
        ? `${displayTitle(loaderData.resource)} · ${m.site_name()}`
        : m.detail_not_found(),
    },
  ]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const api = apiFor(request)
  const slug = params.slug as string

  const res = await api.api.kourindou.resources[':slug'].$get({
    param: { slug },
  })
  const detail = await res.json()
  if ('error' in detail) throw data(null, { status: 404 })

  /**
   * 楼层走神社：资源评论区与论坛帖是同一份数据，M4 起也是同一组端点。
   * topicId 由详情接口给出，主题被软删时它是 null——那时不渲染评论区，
   * 而不是渲染出一个点进去 404 的壳。
   */
  let discussion = null
  if (detail.topicId) {
    // 此前传 query:{}，默认第一页，**第 21 条评论就看不见且无提示**——补 ?floor=
    // floorParam 只放行正整数：非法值回落第一页，别让整个讨论区连回复框一起消失
    const res2 = await api.api.shrine.topics[':id'].posts.$get({
      param: { id: detail.topicId },
      query: floorParam(request.url),
    })
    const body = await res2.json()
    if (!('error' in body)) discussion = body
  }

  return { ...detail, discussion }
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData()
  const intent = form.get('intent')
  const slug = params.slug as string
  const api = apiFor(request)

  /**
   * 讨论区四个 intent（comment/edit/delete/report）与主题页共用一份处理——
   * 两处各写一遍就是两份错误映射。它会读响应：hc 对 4xx/5xx 不抛异常，
   * `await` 完就当成功的写法曾让被拒的评论「凭空消失」。
   */
  const topicId = String(form.get('topicId') ?? '') || null
  const shared = await discussionAction(request, form, topicId)
  if (shared) return shared

  if (intent === 'rate') {
    await api.api.kourindou.resources[':slug'].rating.$put({
      param: { slug },
      json: { score: Number(form.get('score')) },
    })
    return { ok: true as const }
  }

  if (intent === 'favorite') {
    await api.api.kourindou.resources[':slug'].favorite.$put({
      param: { slug },
    })
    return { ok: true as const }
  }

  /**
   * 下架入口放在这里，因为收到下架请求时站长正看着这个页面。
   * 只做软删：硬删要先看得见「删了什么」，那是回收站的事。
   */
  if (intent === 'trash') {
    const reason = String(form.get('reason') ?? '').trim()
    if (!reason) return { ok: false as const }
    const res = await api.api.admin.resources[':id'].$delete({
      param: { id: String(form.get('id')) },
      json: { mode: 'soft', reason },
    })
    if (res.ok) throw redirect(localizeHref('/dash/trash'))
    return { ok: false as const }
  }

  return { ok: false as const }
}

const mirrorLabel = (k: MirrorKind) =>
  ({
    netdisk: m.mirror_netdisk(),
    direct: m.mirror_direct(),
    torrent: m.mirror_torrent(),
    magnet: m.mirror_magnet(),
    other: m.mirror_other(),
  })[k]

export default function ResourceDetail({
  loaderData,
  actionData,
  matches,
}: Route.ComponentProps) {
  const { resource, circle, tags, versions, discussion, topicId } = loaderData
  void actionData
  const user = matches[0]?.loaderData?.user
  const avg = averageRating(resource.ratingSum, resource.ratingCount)
  const locale = getLocale()

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="flex gap-5">
        {resource.coverUrl ? (
          <img
            src={resource.coverUrl}
            alt=""
            className="size-28 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="size-28 shrink-0 rounded-lg bg-muted" />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{kindLabel(resource.kind)}</Badge>
            <Badge variant={licenseVariant(resource.license)}>
              {licenseLabel(resource.license)}
            </Badge>
          </div>
          <h1 className="mt-2 font-heading text-2xl font-bold">
            {displayTitle(resource)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {circle?.nameOriginal || resource.circleNameRaw || m.anonymous()}
          </p>
          <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Star
                className={`size-4 ${avg ? 'fill-chart-2 text-chart-2' : ''}`}
              />
              {avg ?? m.no_rating()}
            </span>
            <span className="inline-flex items-center gap-1">
              <Download className="size-4" />
              {m.downloads_n({ n: resource.downloadCount })}
            </span>
          </div>
        </div>
      </header>

      {resource.licenseNote && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm">{m.detail_license_note()}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {resource.licenseNote}
          </CardContent>
        </Card>
      )}

      {tags.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {tags.map((t) => (
            <Badge key={t.id} variant="outline">
              {t.name?.[locale] || t.nameOriginal}
            </Badge>
          ))}
        </div>
      )}

      {resource.description?.[locale] && (
        <p className="mt-6 max-w-prose leading-7 whitespace-pre-wrap">
          {resource.description[locale]}
        </p>
      )}

      <Separator className="my-8" />

      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold">
          {m.detail_versions()}
        </h2>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          versions.map((v) => (
            <Card key={v.id} className="mb-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {v.label}
                  {v.isLatest === 1 && (
                    <Badge variant="secondary">latest</Badge>
                  )}
                </CardTitle>
                {v.changelog && (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {v.changelog}
                  </p>
                )}
              </CardHeader>
              <CardContent className="grid gap-2">
                {v.files.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                  >
                    <Badge variant="outline">{mirrorLabel(f.kind)}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {f.label}
                    </span>
                    {f.extractCode && (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {m.detail_extract_code()}: {f.extractCode}
                      </code>
                    )}
                    <Button size="sm" asChild>
                      {/* 走 api 跳转而非直链：计数与日志在那边 */}
                      <a
                        href={`/api/kourindou/resources/${resource.slug}/files/${f.id}/download`}
                        rel="noreferrer nofollow"
                        target="_blank"
                      >
                        <Download /> {m.detail_download()}
                      </a>
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <Separator className="my-8" />

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {m.detail_comments()}
          </h2>
          {user && (
            <Form method="post" className="ml-auto flex items-center gap-1">
              <input type="hidden" name="intent" value="rate" />
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="submit"
                  name="score"
                  value={n}
                  aria-label={`${m.detail_rate()} ${n}`}
                  className="text-muted-foreground transition-colors hover:text-chart-2"
                >
                  <Star className="size-4" />
                </button>
              ))}
            </Form>
          )}
        </div>

        {topicId && discussion ? (
          <div id="discussion" className="scroll-mt-20">
            {/* topicId 由 PostForm 的隐藏字段带给 action */}
            <Discussion
              topicId={topicId}
              page={discussion}
              user={user ? { id: user.id, role: user.role } : null}
              action={localizeHref(`/kourindou/${resource.slug}`)}
              pathname={localizeHref(`/kourindou/${resource.slug}`)}
              openingIsTopic={false}
              loginNext={`${localizeHref(`/kourindou/${resource.slug}`)}#discussion`}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {m.detail_no_comments()}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          {user && user.id !== resource.uploaderId && (
            <ReportDialog
              action={localizeHref(`/kourindou/${resource.slug}`)}
              targetKind="resource"
              targetId={resource.id}
              variant="outline"
            />
          )}
          <Link
            to={localizeHref('/shrine')}
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            {m.shrine_back_to_shrine()} →
          </Link>
        </div>
      </section>

      {user?.role === 'admin' && <AdminZone id={resource.id} />}
    </main>
  )
}

/** 站长在资源页上的唯一动作：撤下并移入回收站。彻底删除在回收站里做。 */
function AdminZone({ id }: { id: string }) {
  const fetcher = useFetcher<typeof action>()
  const [reason, setReason] = useState('')
  const busy = fetcher.state !== 'idle'

  return (
    <section className="mx-auto mt-10 max-w-3xl px-4 pb-10">
      <div className="rounded-lg border border-destructive/40 p-4">
        <h2 className="font-heading text-sm font-semibold text-destructive">
          {m.admin_danger_zone()}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.admin_soft_delete_hint()}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={m.admin_reason()}
            aria-label={m.admin_reason()}
          />
          <Button
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={() =>
              fetcher.submit(
                { intent: 'trash', id, reason },
                { method: 'post' },
              )
            }
          >
            {m.admin_soft_delete()}
          </Button>
        </div>
        {fetcher.data?.ok === false && (
          <p className="mt-2 text-xs text-destructive">
            {m.admin_reason_required()}
          </p>
        )}
      </div>
    </section>
  )
}

export function ErrorBoundary() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold">
          {m.detail_not_found()}
        </h1>
        <Link
          to={localizeHref('/kourindou')}
          className="mt-4 inline-block text-sm underline underline-offset-4"
        >
          {m.kourindou_title()}
        </Link>
      </div>
    </main>
  )
}
