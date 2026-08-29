import { NextResponse } from 'next/server';
import { fetchCover } from '@thm/music-sources';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const hint = new URL(req.url).searchParams.get('hint') ?? undefined;
  const url = await fetchCover(trackId, hint);
  if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ url });
}
