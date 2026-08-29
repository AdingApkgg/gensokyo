import { NextResponse } from 'next/server';
import { resolvePlayableUrl } from '@thm/music-sources';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  const url = await resolvePlayableUrl(id);
  if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }

  const safeName = id.replace(/[^\w.-]+/g, '_');
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'Content-Disposition': `attachment; filename="${safeName}.mp3"`,
      'Cache-Control': 'no-store',
    },
  });
}
