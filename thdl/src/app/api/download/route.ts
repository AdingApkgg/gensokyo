import { NextResponse } from "next/server";
import { db, resources, resourceFiles, downloadLogs } from "@/lib/db";
import { eq, sql, and } from "drizzle-orm";
import { presignGet } from "@/lib/s3";
import { getSession } from "@/lib/get-session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const resourceId = url.searchParams.get("resource");
  const fileId = Number(url.searchParams.get("file"));
  if (!resourceId || !fileId) return NextResponse.json({ error: "bad params" }, { status: 400 });

  const [file] = await db
    .select()
    .from(resourceFiles)
    .where(and(eq(resourceFiles.id, fileId), eq(resourceFiles.resourceId, resourceId)))
    .limit(1);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [r] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  if (!r || r.status === "takedown") return NextResponse.json({ error: "unavailable" }, { status: 403 });

  const session = await getSession();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const signed = await presignGet(file.s3Key, 600);

  await db.transaction(async (tx) => {
    await tx.insert(downloadLogs).values({ resourceId, userId: session?.user?.id ?? null, ip });
    await tx
      .update(resources)
      .set({ downloads: sql`${resources.downloads} + 1` })
      .where(eq(resources.id, resourceId));
  });

  return NextResponse.json({ url: signed });
}
