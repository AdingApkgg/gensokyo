import { z } from 'zod'

/**
 * 启动时校验环境变量——缺配置应该在进程起来时就炸，
 * 而不是等到第一次有人上传文件。
 */
export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(16),
    BETTER_AUTH_URL: z.url(),
    PORT: z.coerce.number().int().default(3001),
  })
  .parse(process.env)

/**
 * B2 配置单独校验：dev 环境不配也能跑，只有真正用到存储时才要求。
 * 抛错时说清楚缺什么，不要留一个 undefined 传进 S3Client。
 */
export function storageEnv() {
  return z
    .object({
      B2_ENDPOINT: z.url(),
      B2_REGION: z.string().min(1),
      B2_ACCESS_KEY_ID: z.string().min(1),
      B2_SECRET_ACCESS_KEY: z.string().min(1),
      B2_BUCKET_PUBLIC: z.string().min(1),
      B2_BUCKET_PRIVATE: z.string().min(1),
    })
    .parse(process.env)
}
