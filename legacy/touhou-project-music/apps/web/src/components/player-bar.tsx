'use client';

import { useEffect, useRef } from 'react';
import {
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { LyricsPanel } from '@/components/lyrics-panel';
import { usePlayer } from '@/lib/player-store';
import { cn } from '@/lib/utils';
import { useState } from 'react';

function fmt(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function PlayerBar() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const current = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const duration = usePlayer((s) => s.duration);
  const progress = usePlayer((s) => s.progress);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);

  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const setDuration = usePlayer((s) => s.setDuration);
  const setProgress = usePlayer((s) => s.setProgress);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const setCover = usePlayer((s) => s.setCover);

  const [lyricsOpen, setLyricsOpen] = useState(false);

  // Fetch cover on track change when missing
  useEffect(() => {
    if (!current || current.cover) return;
    let aborted = false;
    const qs = current.coverHint ? `?hint=${encodeURIComponent(current.coverHint)}` : '';
    fetch(`/api/music/cover/${encodeURIComponent(current.id)}${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { url?: string } | null) => {
        if (aborted || !data?.url) return;
        setCover(current.id, data.url);
      })
      .catch(() => void 0);
    return () => {
      aborted = true;
    };
  }, [current?.id, current?.cover, current?.coverHint, setCover]);

  // Resolve new track to actual URL and set audio src
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    let aborted = false;
    (async () => {
      const res = await fetch(`/api/music/url/${encodeURIComponent(current.id)}`);
      if (aborted) return;
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      if (aborted) return;
      audio.src = url;
      audio.load();
      if (isPlaying) audio.play().catch(() => void 0);
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Sync play/pause state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.play().catch(() => void 0);
    else audio.pause();
  }, [isPlaying]);

  // Sync volume / mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  if (!current) return null;

  return (
    <>
      <LyricsPanel open={lyricsOpen} onClose={() => setLyricsOpen(false)} />
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur">
      <audio
        ref={audioRef}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onEnded={() => next()}
      />
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="bg-muted size-12 shrink-0 overflow-hidden rounded">
            {current.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.cover} alt="" className="size-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{current.title}</div>
            <div className="text-muted-foreground truncate text-xs">
              {current.artist ?? '未知艺术家'}
            </div>
          </div>
        </div>

        <div className="flex flex-[2] flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleShuffle}
              className={cn(shuffle && 'text-primary')}
              aria-label="随机"
            >
              <Shuffle className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={prev} aria-label="上一首">
              <SkipBack className="size-4" />
            </Button>
            <Button
              size="icon"
              onClick={toggle}
              aria-label={isPlaying ? '暂停' : '播放'}
              className="size-10"
            >
              {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={next} aria-label="下一首">
              <SkipForward className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={cycleRepeat}
              className={cn(repeat !== 'off' && 'text-primary')}
              aria-label="循环"
            >
              {repeat === 'one' ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
            </Button>
          </div>
          <div className="flex w-full items-center gap-2">
            <span className="text-muted-foreground w-10 text-right text-[10px] tabular-nums">
              {fmt(progress)}
            </span>
            <Slider
              value={[progress]}
              max={duration || 1}
              step={0.1}
              onValueChange={([v]) => {
                const audio = audioRef.current;
                if (audio && typeof v === 'number') {
                  audio.currentTime = v;
                  setProgress(v);
                }
              }}
              className="flex-1"
            />
            <span className="text-muted-foreground w-10 text-[10px] tabular-nums">
              {fmt(duration)}
            </span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLyricsOpen((v) => !v)}
            className={cn(lyricsOpen && 'text-primary')}
            aria-label="歌词"
          >
            <Mic2 className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={toggleMute} aria-label="静音">
            {muted || volume === 0 ? (
              <VolumeX className="size-4" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </Button>
          <Slider
            value={[muted ? 0 : volume * 100]}
            max={100}
            step={1}
            onValueChange={([v]) => typeof v === 'number' && setVolume(v / 100)}
            className="w-24"
          />
        </div>
      </div>
      </div>
    </>
  );
}
