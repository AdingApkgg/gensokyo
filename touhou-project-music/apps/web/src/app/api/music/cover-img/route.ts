import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { NextResponse } from 'next/server';

const ROOT = resolve(process.env.LOCAL_LIBRARY_DIR ?? './storage/local-library');
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function GET(req: Request) {
  const rel = new URL(req.url).searchParams.get('path');
  if (!rel) return NextResponse.json({ error: 'missing_path' }, { status: 400 });
  const full = normalize(join(ROOT, rel));
  if (!full.startsWith(ROOT + '/') && full !== ROOT) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    await stat(full);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const buf = await readFile(full);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
