'use client';

import { create } from 'zustand';

export interface PlayerTrack {
  id: string;
  title: string;
  artist?: string;
  cover?: string;
  coverHint?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  queue: PlayerTrack[];
  currentIndex: number;
  current: PlayerTrack | null;
  isPlaying: boolean;
  duration: number;
  progress: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  play: (track: PlayerTrack) => void;
  enqueue: (track: PlayerTrack) => void;
  setQueue: (tracks: PlayerTrack[], startIndex?: number) => void;
  next: () => void;
  prev: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  setProgress: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  setCover: (id: string, cover: string) => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  currentIndex: -1,
  current: null,
  isPlaying: false,
  duration: 0,
  progress: 0,
  volume: 0.8,
  muted: false,
  repeat: 'off',
  shuffle: false,

  play: (track) =>
    set((s) => {
      const existing = s.queue.findIndex((t) => t.id === track.id);
      if (existing >= 0) {
        return { currentIndex: existing, current: s.queue[existing]!, isPlaying: true, progress: 0 };
      }
      const queue = [...s.queue, track];
      return {
        queue,
        currentIndex: queue.length - 1,
        current: track,
        isPlaying: true,
        progress: 0,
      };
    }),

  enqueue: (track) =>
    set((s) => (s.queue.some((t) => t.id === track.id) ? s : { queue: [...s.queue, track] })),

  setQueue: (tracks, startIndex = 0) =>
    set(() => ({
      queue: tracks,
      currentIndex: tracks.length ? Math.min(startIndex, tracks.length - 1) : -1,
      current: tracks[startIndex] ?? null,
      isPlaying: tracks.length > 0,
      progress: 0,
    })),

  next: () => {
    const { queue, currentIndex, repeat, shuffle } = get();
    if (queue.length === 0) return;
    if (repeat === 'one') {
      set({ progress: 0, isPlaying: true });
      return;
    }
    let ni: number;
    if (shuffle) {
      ni = Math.floor(Math.random() * queue.length);
    } else {
      ni = currentIndex + 1;
      if (ni >= queue.length) {
        if (repeat === 'all') ni = 0;
        else return set({ isPlaying: false, progress: 0 });
      }
    }
    set({ currentIndex: ni, current: queue[ni]!, progress: 0, isPlaying: true });
  },

  prev: () => {
    const { queue, currentIndex, progress } = get();
    if (queue.length === 0) return;
    if (progress > 3) return set({ progress: 0 });
    const ni = currentIndex - 1 < 0 ? queue.length - 1 : currentIndex - 1;
    set({ currentIndex: ni, current: queue[ni]!, progress: 0, isPlaying: true });
  },

  toggle: () => set((s) => ({ isPlaying: s.current ? !s.isPlaying : false })),
  seek: (seconds) => set({ progress: seconds }),
  setDuration: (seconds) => set({ duration: seconds }),
  setProgress: (seconds) => set({ progress: seconds }),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: v === 0 }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  setCover: (id: string, cover: string) =>
    set((s) => {
      if (!s.current || s.current.id !== id) return s;
      return {
        current: { ...s.current, cover },
        queue: s.queue.map((t) => (t.id === id ? { ...t, cover } : t)),
      };
    }),
}));
