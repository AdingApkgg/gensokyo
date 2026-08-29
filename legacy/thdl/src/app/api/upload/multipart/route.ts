import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { startMultipart, presignPart, completeMultipart, abortMultipart } from "@/lib/s3";
import { z } from "zod";

const startBody = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
});
const partBody = z.object({
  key: z.string(),
  uploadId: z.string(),
  partNumber: z.number().int().min(1).max(10000),
});
const completeBody = z.object({
  key: z.string(),
  uploadId: z.string(),
  parts: z.array(z.object({ ETag: z.string(), PartNumber: z.number().int() })).min(1),
});
const abortBody = z.object({ key: z.string(), uploadId: z.string() });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const json = await req.json().catch(() => ({}));

  if (action === "start") {
    const p = startBody.safeParse(json);
    if (!p.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
    const ext = (p.data.filename.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const key = `file/${session.user.id}/${crypto.randomUUID()}.${ext}`;
    const uploadId = await startMultipart(key, p.data.contentType);
    return NextResponse.json({ key, uploadId });
  }
  if (action === "part") {
    const p = partBody.safeParse(json);
    if (!p.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
    const url = await presignPart(p.data.key, p.data.uploadId, p.data.partNumber);
    return NextResponse.json({ url });
  }
  if (action === "complete") {
    const p = completeBody.safeParse(json);
    if (!p.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
    await completeMultipart(p.data.key, p.data.uploadId, p.data.parts);
    return NextResponse.json({ ok: true });
  }
  if (action === "abort") {
    const p = abortBody.safeParse(json);
    if (!p.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
    await abortMultipart(p.data.key, p.data.uploadId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
