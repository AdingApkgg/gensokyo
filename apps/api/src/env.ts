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
