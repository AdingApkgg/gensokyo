import { NextResponse } from 'next/server';
import { searchAll } from '@thm/music-sources';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ results: [] });
  const results = await searchAll(q);
  return NextResponse.json({ results });
}
