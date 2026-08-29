'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlayer } from '@/lib/player-store';
import { findCurrentIndex, parseLrc, type LrcLine } from '@/lib/lrc';
import { cn } from '@/lib/utils';

interface LyricsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function LyricsPanel({ open, onClose }: LyricsPanelProps) {
  const current = usePlayer((s) => s.current);
  const progress = usePlayer((s) => s.progress);
  const [lrc, setLrc] = useState<string | null>(null);
  const [tlyric, setTlyric] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !current) return;
    let aborted = false;
    setLoading(true);
    setLrc(null);
    setTlyric(null);
    fetch(`/api/music/lyric/${encodeURIComponent(current.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { lrc?: string; tlyric?: string }) => {
        if (aborted) return;
        setLrc(data.lrc ?? null);
        setTlyric(data.tlyric ?? null);
      })
      .catch(() => {
        if (!aborted) setLrc(null);
      })
      .finally(() => !aborted && setLoading(false));
    return () => {
      aborted = true;
    };
  }, [open, current?.id]);

  const lines: LrcLine[] = useMemo(
    () => (lrc ? parseLrc(lrc, tlyric ?? undefined) : []),
    [lrc, tlyric],
  );
  const idx = findCurrentIndex(lines, progress);

  useEffect(() => {
    if (idx < 0 || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [idx]);

  if (!open) return null;

  return (
    <div className="bg-background/95 fixed inset-0 bottom-20 z-40 flex flex-col backdrop-blur-lg">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{current?.title ?? '—'}</div>
          <div className="text-muted-foreground truncate text-xs">
            {current?.artist ?? ''}
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭">
          <X className="size-5" />
        </Button>
      </div>
      <div
        ref={containerRef}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-3 overflow-y-auto px-6 py-12 [scroll-padding-block:50%]"
      >
        {loading ? (
          <div className="text-muted-foreground text-sm">加载中...</div>
        ) : lines.length === 0 ? (
          <div className="text-muted-foreground text-sm">暂无歌词</div>
        ) : (
          lines.map((line, i) => (
            <div
              key={`${line.time}-${i}`}
              data-idx={i}
              className={cn(
                'text-center text-base transition-all',
                i === idx
                  ? 'text-foreground scale-105 font-semibold'
                  : 'text-muted-foreground',
              )}
            >
              <div>{line.text}</div>
              {line.trans ? (
                <div
                  className={cn(
                    'mt-0.5 text-sm',
                    i === idx ? 'text-foreground/80' : 'text-muted-foreground/70',
                  )}
                >
                  {line.trans}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
