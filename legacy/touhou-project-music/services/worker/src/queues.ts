import { Queue } from 'bullmq';
import { connection } from './redis';

export interface DownloadJob {
  trackId: string;
  provider: 'netease' | 'tencent' | 'kugou' | 'bilibili' | 'local';
  externalId: string;
}

export interface CrawlJob {
  source: 'thbwiki';
  title: string;
}

export const downloadQueue = new Queue<DownloadJob>('download', { connection });
export const crawlQueue = new Queue<CrawlJob>('crawl', { connection });
