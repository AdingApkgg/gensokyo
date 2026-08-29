import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/get-session";
import { db, resources, favorites } from "@/lib/db";
import { desc, eq, inArray } from "drizzle-orm";
import { ResourceGrid } from "@/components/resource-grid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = { title: "个人中心" };

type SP = Promise<{ tab?: string }>;

export default async function MePage({ searchParams }: { searchParams: SP }) {
  const session = await getSession();
  if (!session?.user) redirect("/login?callbackUrl=/me");
  const sp = await searchParams;
  const tab = sp.tab === "favorites" ? "favorites" : "uploads";

  const mine = await db.query.resources.findMany({
    where: eq(resources.uploaderId, session.user.id),
    orderBy: [desc(resources.createdAt)],
    limit: 60,
  });

  const favRows = await db
    .select({ rid: favorites.resourceId })
    .from(favorites)
    .where(eq(favorites.userId, session.user.id));
  const favIds = favRows.map((f) => f.rid);
  const favList = favIds.length
    ? await db.query.resources.findMany({
        where: inArray(resources.id, favIds),
        orderBy: [desc(resources.createdAt)],
        limit: 60,
      })
    : [];

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold">个人中心</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {session.user.name} · {session.user.email}
      </p>
      <Tabs defaultValue={tab} className="mt-6">
        <TabsList>
          <TabsTrigger value="uploads" asChild>
            <Link href="/me">我的上传 ({mine.length})</Link>
          </TabsTrigger>
          <TabsTrigger value="favorites" asChild>
            <Link href="/me?tab=favorites">收藏 ({favList.length})</Link>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="uploads" className="mt-6">
          {mine.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
              还没上传资源。
            </div>
          ) : (
            <ResourceGrid resources={mine} />
          )}
        </TabsContent>
        <TabsContent value="favorites" className="mt-6">
          {favList.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
              还没收藏任何资源。
            </div>
          ) : (
            <ResourceGrid resources={favList} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
