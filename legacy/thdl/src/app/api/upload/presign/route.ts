import { NextResponse } from "next/server";
import { getSession } from "@/lib/get-session";
import { presignPut } from "@/lib/s3";
import { z } from "zod";

const body = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  kind: z.enum(["cover", "file"]).default("file"),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const { filename, contentType, kind } = parsed.data;

  const ext = (filename.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeExt = ext.slice(0, 8) || "bin";
  const key = `${kind}/${session.user.id}/${crypto.randomUUID()}.${safeExt}`;
  const url = await presignPut(key, contentType, 600);
  return NextResponse.json({ key, url });
}
