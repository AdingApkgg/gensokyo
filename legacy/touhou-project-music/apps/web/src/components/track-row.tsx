'use client';

import { Download, Play } from 'lucide-react';
import type { SearchHit } from '@thm/music-sources';
import { Button } from '@/components/ui/button';
import { usePlayer } from '@/lib/player-store';
import { cn } from '@/lib/utils';

const PROVIDER_LABEL: Record<SearchHit['provider'], string> = {
  netease: '网易云',
  tencent: 'QQ',
  kugou: '酷狗',
  bilibili: 'B 站',
  local: '本地',
};

const PROVIDER_COLOR: Record<SearchHit['provider'], string> = {
  netease: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  tencent: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  kugou: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  bilibili: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  local: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
};

export function TrackRow({ hit }: { hit: SearchHit }) {
  const play = usePlayer((s) => s.play);
  const trackId = `${hit.provider}:${hit.externalId}`;
  const download = `/api/music/download?id=${encodeURIComponent(trackId)}`;

  return (
    <div className="hover:bg-muted flex items-center gap-3 rounded-md border px-3 py-2.5 transition">
      <Button
        size="icon"
        variant="ghost"
        onClick={() =>
          play({
            id: trackId,
            title: hit.title,
            artist: hit.artist,
            cover: hit.coverUrl,
            coverHint: hit.coverId,
          })
        }
        aria-label="播放"
      >
        <Play className="size-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{hit.title}</div>
        <div className="text-muted-foreground truncate text-xs">
          {hit.artist ?? '未知艺术家'}
          {hit.album ? <> · {hit.album}</> : null}
        </div>
      </div>
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-[10px] font-medium',
          PROVIDER_COLOR[hit.provider],
        )}
      >
        {PROVIDER_LABEL[hit.provider]}
      </span>
      <Button size="icon" variant="ghost" asChild aria-label="下载">
        <a href={download} download>
          <Download className="size-4" />
        </a>
      </Button>
    </div>
  );
}
