import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'bullmq';
import { allSources } from '@thm/music-sources';
import { connection } from './redis';
import type { DownloadJob, CrawlJob } from './queues';

const CACHE_DIR = process.env.AUDIO_CACHE_DIR ?? './storage/audio';

async function cachePath(trackId: string, ext: string) {
  const hash = createHash('sha1').update(trackId).digest('hex');
  const dir = join(CACHE_DIR, hash.slice(0, 2));
  await mkdir(dir, { recursive: true });
  return join(dir, `${hash}.${ext}`);
}

new Worker<DownloadJob>(
  'download',
  async (job) => {
    const { provider, externalId, trackId } = job.data;
    const source = allSources[provider];
    if (!source) throw new Error(`unknown provider ${provider}`);
    const resolved = await source.resolve(externalId);
    if (!resolved) throw new Error(`cannot resolve ${trackId}`);
    if (provider === 'local') return { cached: resolved.url };
    const res = await fetch(resolved.url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const ext = resolved.format ?? 'mp3';
    const path = await cachePath(trackId, ext);
    await writeFile(path, buf);
    return { cached: path, size: buf.byteLength };
  },
  { connection, concurrency: 4 },
);

new Worker<CrawlJob>(
  'crawl',
  async (job) => {
    const { fetchAlbumByTitle } = await import('@thm/crawler');
    if (job.data.source === 'thbwiki') return fetchAlbumByTitle(job.data.title);
    throw new Error(`unknown crawl source ${job.data.source}`);
  },
  { connection, concurrency: 2 },
);

console.log('[worker] ready');
