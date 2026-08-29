import Link from "next/link";
import { db, resources } from "@/lib/db";
import { desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { ModerateActions } from "@/components/moderate-actions";

export const metadata = { title: "后台 · 资源管理" };

export default async function DashResources() {
  let list: Awaited<ReturnType<typeof db.query.resources.findMany>> = [];
  try {
    list = await db.query.resources.findMany({ orderBy: [desc(resources.createdAt)], limit: 100 });
  } catch {}
  return (
    <div>
      <h1 className="text-2xl font-semibold">资源管理</h1>
      <div className="mt-6 overflow-hidden rounded-2xl border bg-card/80 backdrop-blur">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2">标题</th>
              <th className="px-4 py-2">分类</th>
              <th className="px-4 py-2">状态</th>
              <th className="px-4 py-2">下载</th>
              <th className="px-4 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2">
                  <Link href={`/resources/${r.slug}`} className="hover:underline">{r.title}</Link>
                </td>
                <td className="px-4 py-2"><Badge variant="secondary">{r.category}</Badge></td>
                <td className="px-4 py-2">
                  <Badge variant={r.status === "public" ? "default" : "destructive"}>{r.status}</Badge>
                </td>
                <td className="px-4 py-2">{r.downloads}</td>
                <td className="px-4 py-2"><ModerateActions id={r.id} status={r.status} /></td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td className="px-4 py-6 text-center text-muted-foreground" colSpan={5}>暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
