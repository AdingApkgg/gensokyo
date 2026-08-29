import Link from "next/link";
import { ArrowRight, Upload, Music, Gamepad2, Image as ImageIcon, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResourceGrid } from "@/components/resource-grid";
import { db, resources } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

export const revalidate = 60;

const categories = [
  { slug: "music", label: "同人音乐", Icon: Music },
  { slug: "game", label: "同人游戏", Icon: Gamepad2 },
  { slug: "cg", label: "CG / 插画", Icon: ImageIcon },
  { slug: "doujinshi", label: "同人志", Icon: BookOpen },
];

export default async function HomePage() {
  let latest: Awaited<ReturnType<typeof db.query.resources.findMany>> = [];
  try {
    latest = await db.query.resources.findMany({
      where: eq(resources.status, "public"),
      orderBy: [desc(resources.createdAt)],
      limit: 12,
    });
  } catch {
    latest = [];
  }

  return (
    <div className="container mx-auto px-4">
      <section className="relative py-20 md:py-28 text-center">
        <h1 className="text-balance text-4xl md:text-6xl font-bold tracking-tight">
          幻想乡的
          <span className="bg-gradient-to-r from-pink-500 via-rose-400 to-red-500 bg-clip-text text-transparent">
            一切资源
          </span>
          ，都在这里
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-muted-foreground md:text-lg">
          免费开放的东方Project 同人资源社区 — 音乐、游戏、CG、同人志、MMD。上传、编辑、评分，全由你掌控。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="gap-2">
            <Link href="/resources">浏览资源 <ArrowRight className="size-4" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="gap-2">
            <Link href="/upload"><Upload className="size-4" />上传资源</Link>
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {categories.map(({ slug, label, Icon }) => (
          <Link
            key={slug}
            href={`/resources?category=${slug}`}
            className="group rounded-2xl border bg-card/80 p-5 backdrop-blur transition hover:border-primary/40 hover:bg-card"
          >
            <Icon className="size-6 text-primary" />
            <div className="mt-3 font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">查看全部 →</div>
          </Link>
        ))}
      </section>

      <section className="mt-16">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-2xl font-semibold">最新上传</h2>
          <Link href="/resources" className="text-sm text-muted-foreground hover:text-foreground">
            查看全部 →
          </Link>
        </div>
        {latest.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
            还没有资源，成为第一个上传者吧。
          </div>
        ) : (
          <ResourceGrid resources={latest} />
        )}
      </section>
    </div>
  );
}
