import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { db, resources } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.enum(["music","game","cg","doujinshi","mmd","video","wallpaper","tool","other"]).optional(),
  circle: z.string().max(120).optional(),
  author: z.string().max(120).optional(),
  description: z.string().max(20000).optional(),
  status: z.enum(["public","hidden","takedown","pending"]).optional(),
});

async function canEdit(userId: string, role: string | undefined, resourceId: string) {
  const r = await db.query.resources.findFirst({ where: eq(resources.id, resourceId) });
  if (!r) return null;
  const staff = role === "admin" || role === "moderator";
  if (r.uploaderId !== userId && !staff) return null;
  return { r, staff };
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const check = await canEdit(session.user.id, session.user.role, id);
  if (!check) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = patchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const v = parsed.data;

  if (v.status && !check.staff) delete v.status;

  await db
    .update(resources)
    .set({
      ...(v.title ? { title: v.title } : {}),
      ...(v.category ? { category: v.category } : {}),
      ...(v.circle !== undefined ? { circle: v.circle } : {}),
      ...(v.author !== undefined ? { author: v.author } : {}),
      ...(v.description !== undefined ? { descriptionMd: v.description } : {}),
      ...(v.status ? { status: v.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(resources.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const check = await canEdit(session.user.id, session.user.role, id);
  if (!check) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(resources).where(eq(resources.id, id));
  return NextResponse.json({ ok: true });
}
