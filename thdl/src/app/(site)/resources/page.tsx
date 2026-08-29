import { db, resources } from "@/lib/db";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { ResourceGrid } from "@/components/resource-grid";
import { ResourceFilters } from "@/components/resource-filters";

export const revalidate = 30;

type SP = Promise<{ q?: string; category?: string; sort?: string; page?: string }>;

export default async function ResourcesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const cat = sp.category;
  const sort = sp.sort ?? "new";
  const page = Math.max(1, Number(sp.page ?? 1));
  const perPage = 24;

  const where = and(
    eq(resources.status, "public"),
    q ? ilike(resources.title, `%${q}%`) : undefined,
    cat ? eq(resources.category, cat as "music") : undefined
  );

  const orderBy =
    sort === "popular"
      ? [desc(resources.downloads)]
      : sort === "rating"
      ? [desc(sql`case when ${resources.ratingCount} = 0 then 0 else ${resources.ratingSum}::float / ${resources.ratingCount} end`)]
      : [desc(resources.createdAt)];

  let list: Awaited<ReturnType<typeof db.query.resources.findMany>> = [];
  try {
    list = await db.query.resources.findMany({
      where,
      orderBy,
      limit: perPage,
      offset: (page - 1) * perPage,
    });
  } catch {
    list = [];
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold">资源库</h1>
      <ResourceFilters />
      <div className="mt-6">
        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
            没找到匹配的资源。
          </div>
        ) : (
          <ResourceGrid resources={list} />
        )}
      </div>
    </div>
  );
}
