import { NextResponse } from 'next/server';
import { fetchLyric } from '@thm/music-sources';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const result = await fetchLyric(trackId);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}
