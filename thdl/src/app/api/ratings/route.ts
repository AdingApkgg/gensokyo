import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { db, resources, ratings } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

const body = z.object({ resourceId: z.string().uuid().or(z.string().min(8)), score: z.number().int().min(1).max(5) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { resourceId, score } = parsed.data;

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ score: ratings.score })
      .from(ratings)
      .where(and(eq(ratings.resourceId, resourceId), eq(ratings.userId, session.user!.id)))
      .limit(1);
    if (existing.length) {
      const delta = score - existing[0].score;
      await tx
        .update(ratings)
        .set({ score })
        .where(and(eq(ratings.resourceId, resourceId), eq(ratings.userId, session.user!.id)));
      await tx
        .update(resources)
        .set({ ratingSum: sql`${resources.ratingSum} + ${delta}` })
        .where(eq(resources.id, resourceId));
    } else {
      await tx.insert(ratings).values({ resourceId, userId: session.user!.id, score });
      await tx
        .update(resources)
        .set({
          ratingSum: sql`${resources.ratingSum} + ${score}`,
          ratingCount: sql`${resources.ratingCount} + 1`,
        })
        .where(eq(resources.id, resourceId));
    }
  });

  return NextResponse.json({ ok: true });
}
