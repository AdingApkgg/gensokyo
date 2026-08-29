import { db, reports, resources } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

export const metadata = { title: "后台 · 举报" };

export default async function DashReports() {
  let list: { id: number; reason: string; resolved: boolean; createdAt: Date; slug: string; title: string }[] = [];
  try {
    list = await db
      .select({
        id: reports.id,
        reason: reports.reason,
        resolved: reports.resolved,
        createdAt: reports.createdAt,
        slug: resources.slug,
        title: resources.title,
      })
      .from(reports)
      .leftJoin(resources, eq(resources.id, reports.resourceId))
      .orderBy(desc(reports.createdAt))
      .limit(100) as typeof list;
  } catch {}
  return (
    <div>
      <h1 className="text-2xl font-semibold">举报</h1>
      <div className="mt-6 space-y-3">
        {list.length === 0 && <p className="text-muted-foreground text-sm">暂无举报。</p>}
        {list.map((r) => (
          <div key={r.id} className="rounded-xl border bg-card/80 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <Link href={`/resources/${r.slug}`} className="font-medium hover:underline">{r.title}</Link>
              <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            <p className="mt-1 text-sm">{r.reason}</p>
            {r.resolved && <span className="mt-2 inline-block text-xs text-muted-foreground">已处理</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
