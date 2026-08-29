export type Provider = 'netease' | 'tencent' | 'kugou' | 'bilibili' | 'local';

export interface SearchHit {
  provider: Provider;
  externalId: string;
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  coverUrl?: string;
  coverId?: string;
}

export interface ResolvedAudio {
  url: string;
  format?: string;
  bitrate?: number;
  expiresAt?: Date;
}

export interface Lyric {
  lrc?: string;
  tlyric?: string;
}

export interface MusicSource {
  readonly provider: Provider;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  resolve(externalId: string): Promise<ResolvedAudio | null>;
  cover?(externalId: string, hint?: string): Promise<string | null>;
  lyric?(externalId: string): Promise<Lyric | null>;
}
