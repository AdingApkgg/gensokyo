import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { db, resources, resourceFiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { slugify } from "@/lib/utils";

const body = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(["music", "game", "cg", "doujinshi", "mmd", "video", "wallpaper", "tool", "other"]),
  circle: z.string().max(120).optional(),
  author: z.string().max(120).optional(),
  description: z.string().max(20000).optional(),
  coverKey: z.string().nullable().optional(),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        size: z.number().int().nonnegative(),
        contentType: z.string().max(120),
        key: z.string().min(1),
      })
    )
    .default([]),
  externalLinks: z.array(z.object({ label: z.string().max(60), url: z.string().url() })).default([]),
});

async function uniqueSlug(base: string) {
  let slug = base;
  let i = 1;
  while (true) {
    const hit = await db.query.resources.findFirst({ where: eq(resources.slug, slug) });
    if (!hit) return slug;
    slug = `${base}-${i++}`;
    if (i > 50) return `${base}-${Date.now().toString(36)}`;
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const v = parsed.data;

  const slug = await uniqueSlug(slugify(v.title));

  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(resources)
      .values({
        slug,
        title: v.title,
        category: v.category,
        descriptionMd: v.description ?? "",
        coverKey: v.coverKey ?? null,
        circle: v.circle,
        author: v.author,
        uploaderId: session.user!.id,
        status: "public",
        externalLinks: v.externalLinks,
      })
      .returning();
    if (v.files.length) {
      await tx.insert(resourceFiles).values(
        v.files.map((f) => ({
          resourceId: row.id,
          name: f.name,
          s3Key: f.key,
          size: f.size,
          contentType: f.contentType,
        }))
      );
    }
    return row;
  });

  return NextResponse.json({ ok: true, id: inserted.id, slug: inserted.slug });
}
