import type { MusicSource, Provider, ResolvedAudio, SearchHit, Lyric } from '../types';

const METING_API = process.env.METING_API_URL ?? 'http://localhost:58080';

type MetingServer = 'netease' | 'tencent' | 'kugou';

interface MetingSearchItem {
  id: string | number;
  name: string;
  artist: string[] | string;
  album?: string;
  pic_id?: string;
  url_id?: string | number;
  lyric_id?: string | number;
  source: MetingServer;
}

async function metingFetch<T>(params: Record<string, string>): Promise<T> {
  const url = `${METING_API}/?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Meting ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function providerOf(s: MetingServer): Provider {
  return s;
}

function makeSource(server: MetingServer): MusicSource {
  return {
    provider: providerOf(server),
    async search(q, limit = 20) {
      const items = await metingFetch<MetingSearchItem[]>({
        server,
        type: 'search',
        id: q,
      });
      return items.slice(0, limit).map<SearchHit>((it) => ({
        provider: providerOf(server),
        externalId: String(it.url_id ?? it.id),
        title: it.name,
        artist: Array.isArray(it.artist) ? it.artist.join(' / ') : it.artist,
        album: it.album,
        coverId: it.pic_id,
      }));
    },
    async resolve(externalId): Promise<ResolvedAudio | null> {
      const res = await metingFetch<{ url?: string; br?: number; size?: number }>({
        server,
        type: 'url',
        id: externalId,
      });
      if (!res.url) return null;
      return { url: res.url, bitrate: res.br };
    },
    async cover(externalId, hint): Promise<string | null> {
      let picId = hint;
      if (!picId) {
        const song = await metingFetch<MetingSearchItem[] | MetingSearchItem>({
          server,
          type: 'song',
          id: externalId,
        });
        const one = Array.isArray(song) ? song[0] : song;
        picId = one?.pic_id;
      }
      if (!picId) return null;
      const pic = await metingFetch<{ url?: string }>({ server, type: 'pic', id: picId });
      return pic.url ?? null;
    },
    async lyric(externalId): Promise<Lyric | null> {
      const res = await metingFetch<{ lyric?: string; tlyric?: string }>({
        server,
        type: 'lyric',
        id: externalId,
      });
      if (!res.lyric) return null;
      return { lrc: res.lyric, tlyric: res.tlyric };
    },
  };
}

export const neteaseSource = makeSource('netease');
export const tencentSource = makeSource('tencent');
export const kugouSource = makeSource('kugou');
