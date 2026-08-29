import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MEILI_HOST: z.string().url(),
  MEILI_MASTER_KEY: z.string().min(1),
  METING_API_URL: z.string().url(),
  AUTH_SECRET: z.string().min(16),
  AUDIO_CACHE_DIR: z.string().default('./storage/audio'),
  LOCAL_LIBRARY_DIR: z.string().default('./storage/local-library'),
  BILIBILI_SESSDATA: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
