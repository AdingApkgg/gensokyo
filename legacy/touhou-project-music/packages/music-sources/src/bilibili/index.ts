import type { MusicSource, ResolvedAudio, SearchHit } from '../types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

function headers(): HeadersInit {
  const h: Record<string, string> = { 'User-Agent': UA, Referer: 'https://www.bilibili.com' };
  const sess = process.env.BILIBILI_SESSDATA;
  if (sess) h['Cookie'] = `SESSDATA=${sess}`;
  return h;
}

export const bilibiliSource: MusicSource = {
  provider: 'bilibili',
  async search(q, limit = 20) {
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.searchParams.set('search_type', 'video');
    url.searchParams.set('keyword', q);
    const res = await fetch(url, { headers: headers(), cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { result?: Array<{ bvid: string; title: string; author: string; duration: string; pic: string }> };
    };
    const items = data.data?.result ?? [];
    return items.slice(0, limit).map<SearchHit>((it) => ({
      provider: 'bilibili',
      externalId: it.bvid,
      title: it.title.replace(/<[^>]+>/g, ''),
      artist: it.author,
      coverUrl: it.pic?.startsWith('//') ? `https:${it.pic}` : it.pic,
    }));
  },
  async resolve(bvid): Promise<ResolvedAudio | null> {
    const view = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      { headers: headers(), cache: 'no-store' },
    ).then((r) => r.json() as Promise<{ data?: { cid: number } }>);
    const cid = view.data?.cid;
    if (!cid) return null;
    const playUrl = new URL('https://api.bilibili.com/x/player/playurl');
    playUrl.searchParams.set('bvid', bvid);
    playUrl.searchParams.set('cid', String(cid));
    playUrl.searchParams.set('fnval', '16');
    const play = await fetch(playUrl, { headers: headers(), cache: 'no-store' }).then(
      (r) =>
        r.json() as Promise<{
          data?: { dash?: { audio?: Array<{ baseUrl: string; bandwidth: number }> } };
        }>,
    );
    const audios = play.data?.dash?.audio;
    if (!audios?.length) return null;
    const best = audios.reduce((a, b) => (a.bandwidth > b.bandwidth ? a : b));
    return { url: best.baseUrl, bitrate: Math.round(best.bandwidth / 1000), format: 'm4a' };
  },
  async cover(bvid): Promise<string | null> {
    const view = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      { headers: headers(), cache: 'no-store' },
    ).then((r) => r.json() as Promise<{ data?: { pic?: string } }>);
    const pic = view.data?.pic;
    if (!pic) return null;
    return pic.startsWith('//') ? `https:${pic}` : pic;
  },
};
