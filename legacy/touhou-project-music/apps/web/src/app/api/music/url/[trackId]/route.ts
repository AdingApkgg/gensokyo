import { NextResponse } from 'next/server';
import { resolvePlayableUrl } from '@thm/music-sources';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const { trackId } = await params;
  const url = await resolvePlayableUrl(trackId);
  if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ url });
}
