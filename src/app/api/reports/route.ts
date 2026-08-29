import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { db, reports } from "@/lib/db";
import { z } from "zod";

const body = z.object({
  resourceId: z.string().min(8),
  reason: z.string().min(2).max(2000),
});

export async function POST(req: Request) {
  const session = await getSession();
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { resourceId, reason } = parsed.data;
  await db.insert(reports).values({
    resourceId,
    reporterId: session?.user?.id ?? null,
    reason,
  });
  return NextResponse.json({ ok: true });
}
