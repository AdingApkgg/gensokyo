import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { db, favorites } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const body = z.object({ resourceId: z.string().min(8) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { resourceId } = parsed.data;
  const userId = session.user.id;

  const existing = await db
    .select()
    .from(favorites)
    .where(and(eq(favorites.resourceId, resourceId), eq(favorites.userId, userId)))
    .limit(1);

  if (existing.length) {
    await db
      .delete(favorites)
      .where(and(eq(favorites.resourceId, resourceId), eq(favorites.userId, userId)));
    return NextResponse.json({ favorited: false });
  }
  await db.insert(favorites).values({ resourceId, userId });
  return NextResponse.json({ favorited: true });
}
