import { bilibiliSource } from './bilibili';
import { localSource } from './local';
import { neteaseSource, tencentSource, kugouSource } from './meting';
import type { Lyric, MusicSource, Provider, SearchHit } from './types';

export * from './types';
export { neteaseSource, tencentSource, kugouSource } from './meting';
export { bilibiliSource } from './bilibili';
export { localSource, scanLocalLibrary } from './local';
export type { LocalTrackMeta } from './local';

export const allSources: Record<Provider, MusicSource> = {
  netease: neteaseSource,
  tencent: tencentSource,
  kugou: kugouSource,
  bilibili: bilibiliSource,
  local: localSource,
};

function splitTrackId(trackId: string): { source: MusicSource; externalId: string } | null {
  const [provider, ...rest] = trackId.split(':');
  const externalId = rest.join(':');
  const source = allSources[provider as Provider];
  if (!source || !externalId) return null;
  return { source, externalId };
}

export async function searchAll(query: string, perSource = 10): Promise<SearchHit[]> {
  const results = await Promise.allSettled(
    Object.values(allSources).map((s) => s.search(query, perSource)),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export async function resolvePlayableUrl(trackId: string): Promise<string | null> {
  const parts = splitTrackId(trackId);
  if (!parts) return null;
  const resolved = await parts.source.resolve(parts.externalId);
  return resolved?.url ?? null;
}

export async function fetchCover(trackId: string, hint?: string): Promise<string | null> {
  const parts = splitTrackId(trackId);
  if (!parts || !parts.source.cover) return null;
  return parts.source.cover(parts.externalId, hint);
}

export async function fetchLyric(trackId: string): Promise<Lyric | null> {
  const parts = splitTrackId(trackId);
  if (!parts || !parts.source.lyric) return null;
  return parts.source.lyric(parts.externalId);
}
