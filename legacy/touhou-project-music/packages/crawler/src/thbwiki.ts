import * as cheerio from 'cheerio';

const THBWIKI = 'https://thwiki.cc';

export interface ThbwikiAlbum {
  title: string;
  catalogNo?: string;
  releaseEvent?: string;
  circle?: string;
  tracks: Array<{ trackNo?: number; title: string; originals?: string[] }>;
  sourceUrl: string;
}

export async function fetchAlbumByTitle(title: string): Promise<ThbwikiAlbum | null> {
  const url = `${THBWIKI}/wiki/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'thm-crawler/0.1' } });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  const pageTitle = $('#firstHeading').text().trim() || title;
  const tracks: ThbwikiAlbum['tracks'] = [];
  $('table.wikitable tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const trackNo = parseInt($(tds[0]).text().trim(), 10);
    const trackTitle = $(tds[1]).text().trim();
    if (!trackTitle) return;
    tracks.push({
      trackNo: Number.isFinite(trackNo) ? trackNo : undefined,
      title: trackTitle,
    });
  });
  return { title: pageTitle, tracks, sourceUrl: url };
}
