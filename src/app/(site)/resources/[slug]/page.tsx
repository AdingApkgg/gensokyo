import { notFound } from "next/navigation";
import Link from "next/link";
import { db, resources, resourceFiles, comments, users, favorites } from "@/lib/db";
import { and, eq, desc } from "drizzle-orm";
import { FavoriteButton } from "@/components/favorite-button";
import { ReportDialog } from "@/components/report-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit3, User as UserIcon, Calendar, Tag } from "lucide-react";
import { publicUrl } from "@/lib/s3-public";
import { getSession } from "@/lib/get-session";
import { RatingStars } from "@/components/rating-stars";
import { CommentSection } from "@/components/comment-section";
import { DownloadList } from "@/components/download-list";
import { formatBytes } from "@/lib/utils";

export const revalidate = 30;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const r = await db.query.resources.findFirst({ where: eq(resources.slug, slug) });
  if (!r) return { title: "未找到" };
  return { title: r.title, description: r.descriptionMd.slice(0, 160) };
}

export default async function ResourceDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const r = await db.query.resources.findFirst({
    where: eq(resources.slug, slug),
    with: { files: true, uploader: true },
  });
  if (!r || r.status === "takedown") notFound();

  const session = await getSession();
  const canEdit =
    !!session?.user &&
    (session.user.id === r.uploaderId ||
      session.user.role === "moderator" ||
      session.user.role === "admin");

  const commentRows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      parentId: comments.parentId,
      userId: comments.userId,
      userName: users.name,
      userImage: users.image,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.resourceId, r.id))
    .orderBy(desc(comments.createdAt))
    .limit(200);

  const avg = r.ratingCount ? (r.ratingSum / r.ratingCount).toFixed(2) : "—";

  let favored = false;
  if (session?.user?.id) {
    const [row] = await db
      .select()
      .from(favorites)
      .where(and(eq(favorites.resourceId, r.id), eq(favorites.userId, session.user.id)))
      .limit(1);
    favored = !!row;
  }

  return (
    <article className="container mx-auto grid gap-8 px-4 py-8 lg:grid-cols-[1fr_340px]">
      <div>
        <div className="overflow-hidden rounded-2xl border bg-card/80 backdrop-blur">
          <div className="aspect-[16/9] bg-gradient-to-br from-accent/40 to-muted">
            {r.coverKey ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={publicUrl(r.coverKey)} alt={r.title} className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge>{r.category}</Badge>
              {r.circle && <span>社团：{r.circle}</span>}
              {r.author && <span>作者：{r.author}</span>}
              {r.eventName && <span>· {r.eventName}</span>}
              {r.language && <span>· {r.language}</span>}
            </div>
            <h1 className="mt-3 text-3xl font-semibold">{r.title}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <UserIcon className="size-4" /> {r.uploader?.name ?? "匿名"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-4" />
                {new Date(r.createdAt).toLocaleDateString("zh-CN")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Tag className="size-4" /> {avg} · {r.ratingCount} 评分
              </span>
              {canEdit && (
                <Button asChild variant="outline" size="sm" className="ml-auto">
                  <Link href={`/resources/${r.slug}/edit`}><Edit3 className="size-4" />编辑</Link>
                </Button>
              )}
            </div>
            <div className="prose prose-sm dark:prose-invert mt-6 max-w-none whitespace-pre-wrap">
              {r.descriptionMd || <span className="text-muted-foreground">（无简介）</span>}
            </div>
          </div>
        </div>

        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">评论</h2>
          <CommentSection
            resourceId={r.id}
            comments={commentRows}
            currentUserId={session?.user?.id ?? null}
          />
        </section>
      </div>

      <aside className="space-y-4">
        <div className="space-y-3 rounded-2xl border bg-card/80 p-5 backdrop-blur">
          <div className="text-sm text-muted-foreground">评分 / {avg}</div>
          <RatingStars resourceId={r.id} loggedIn={!!session?.user} />
          <div className="text-xs text-muted-foreground">
            共 {r.ratingCount} 人评分 · 下载 {r.downloads} 次
          </div>
          <FavoriteButton resourceId={r.id} initial={favored} loggedIn={!!session?.user} />
          <div className="flex justify-end">
            <ReportDialog resourceId={r.id} />
          </div>
        </div>

        <div className="rounded-2xl border bg-card/80 p-5 backdrop-blur">
          <div className="mb-3 text-sm font-medium">文件 ({r.files.length})</div>
          <DownloadList
            resourceId={r.id}
            files={r.files.map((f) => ({
              id: f.id,
              name: f.name,
              size: f.size,
              sizeLabel: formatBytes(f.size),
            }))}
          />
          {r.externalLinks && r.externalLinks.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <div className="mb-2 text-xs text-muted-foreground">外链</div>
              <ul className="space-y-1 text-sm">
                {r.externalLinks.map((l, i) => (
                  <li key={i}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline"
                    >
                      {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </article>
  );
}
