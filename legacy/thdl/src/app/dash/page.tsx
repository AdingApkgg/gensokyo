import { db, resources, reports, users } from "@/lib/db";
import { sql } from "drizzle-orm";

export const metadata = { title: "后台 · 概览" };

async function safeCount<T extends { count: number }>(p: Promise<T[]>) {
  try {
    const r = await p;
    return r[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

export default async function DashPage() {
  const [rCount, uCount, reportCount] = await Promise.all([
    safeCount(db.select({ count: sql<number>`count(*)::int` }).from(resources)),
    safeCount(db.select({ count: sql<number>`count(*)::int` }).from(users)),
    safeCount(db.select({ count: sql<number>`count(*) filter (where not resolved)::int` }).from(reports)),
  ]);
  const cards = [
    { label: "资源数", value: rCount },
    { label: "用户数", value: uCount },
    { label: "未处理举报", value: reportCount },
  ];
  return (
    <div>
      <h1 className="text-2xl font-semibold">概览</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border bg-card/80 p-5 backdrop-blur">
            <div className="text-sm text-muted-foreground">{c.label}</div>
            <div className="mt-2 text-3xl font-semibold">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
