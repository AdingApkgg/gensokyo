import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { parseBuffer } from 'music-metadata';
import type { Lyric, MusicSource, ResolvedAudio, SearchHit } from '../types';

const ROOT = process.env.LOCAL_LIBRARY_DIR ?? './storage/local-library';
const AUDIO_EXT = new Set(['.flac', '.mp3', '.wav', '.m4a', '.ogg', '.opus', '.ape']);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function ext(path: string) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}

export interface LocalTrackMeta {
  path: string;
  relPath: string;
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  circle?: string;
}

export async function scanLocalLibrary(root = ROOT): Promise<LocalTrackMeta[]> {
  const out: LocalTrackMeta[] = [];
  try {
    await stat(root);
  } catch {
    return out;
  }
  for await (const file of walk(root)) {
    if (!AUDIO_EXT.has(ext(file))) continue;
    const rel = relative(root, file);
    const parts = rel.split(sep);
    const pathCircle = parts.length >= 3 ? parts[0] : undefined;
    const pathAlbum = parts.length >= 3 ? parts[1] : undefined;
    try {
      const buf = await readFile(file);
      const meta = await parseBuffer(buf, undefined, { duration: true, skipCovers: true });
      out.push({
        path: file,
        relPath: rel,
        title: meta.common.title ?? parts[parts.length - 1]!.replace(/\.[^.]+$/, ''),
        artist: meta.common.artist ?? meta.common.albumartist,
        album: meta.common.album ?? pathAlbum,
        durationSec: meta.format.duration ? Math.round(meta.format.duration) : undefined,
        circle: meta.common.albumartist ?? pathCircle,
      });
    } catch {
      out.push({
        path: file,
        relPath: rel,
        title: parts[parts.length - 1]!.replace(/\.[^.]+$/, ''),
        album: pathAlbum,
        circle: pathCircle,
      });
    }
  }
  return out;
}

export const localSource: MusicSource = {
  provider: 'local',
  async search(q, limit = 20) {
    const all = await scanLocalLibrary();
    const needle = q.toLowerCase();
    return all
      .filter((t) =>
        [t.title, t.artist, t.album, t.circle].some((f) => f?.toLowerCase().includes(needle)),
      )
      .slice(0, limit)
      .map<SearchHit>((t) => ({
        provider: 'local',
        externalId: t.relPath,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationSec: t.durationSec,
      }));
  },
  async resolve(relPath): Promise<ResolvedAudio | null> {
    const path = join(ROOT, relPath);
    try {
      await stat(path);
      return { url: `/api/music/stream?path=${encodeURIComponent(relPath)}`, format: ext(path).slice(1) };
    } catch {
      return null;
    }
  },
  async cover(relPath): Promise<string | null> {
    const dir = dirname(join(ROOT, relPath));
    for (const name of ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png']) {
      try {
        await stat(join(dir, name));
        const rel = relative(ROOT, join(dir, name));
        return `/api/music/cover-img?path=${encodeURIComponent(rel)}`;
      } catch {
        // try next
      }
    }
    return null;
  },
  async lyric(relPath): Promise<Lyric | null> {
    const full = join(ROOT, relPath);
    const lrcPath = full.replace(/\.[^.]+$/, '.lrc');
    try {
      const lrc = await readFile(lrcPath, 'utf8');
      return { lrc };
    } catch {
      return null;
    }
  },
};
