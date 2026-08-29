import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { db, comments } from "@/lib/db";
import { z } from "zod";

const body = z.object({
  resourceId: z.string().min(8),
  body: z.string().min(1).max(4000),
  parentId: z.number().int().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { resourceId, body: text, parentId } = parsed.data;
  const [row] = await db
    .insert(comments)
    .values({ resourceId, userId: session.user.id, body: text, parentId: parentId ?? null })
    .returning();
  return NextResponse.json({ ok: true, id: row.id });
}
