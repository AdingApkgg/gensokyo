import { z } from 'zod'

/**
 * 启动时校验环境变量——缺配置应该在进程起来时就炸，
 * 而不是等到第一次有人上传文件。
 *
 * ⚠️ **只在 index.ts 里 import 它**，别在 app.ts 里。测试导入的是 app，
 * 测试环境不该因为少一个生产变量就整套跑不起来；而生产进程必须炸。
 *
 * 这份校验曾经是死代码——文件在、全仓无人 import，「启动即炸」的承诺
 * 从未生效。现在 index.ts 顶部 import 它，缺配置会在监听端口之前抛出。
 *
 * **不收 PORT。** api 的端口是 3001，这是 Caddy、compose healthcheck、
 * web 的 API_URL 与 vite proxy 四处共同依赖的契约。读 PORT 的话，
 * 预览工具给 web 导出的 PORT=3000 会被 api 一并读到，两个进程抢同一个口——
 * 实际发生过：api 占了 3000，vite 退到 3001，所有 /api 请求打到 vite 的代理上。
 */
export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(16),
    /** 同时是外链禁令判定「本站 origin」的依据（rate.ts 的 ownOrigins） */
    BETTER_AUTH_URL: z.url(),
    /**
     * 图床对外基址。rate.ts 用它把自建 MinIO 的图片 URL 判成站内，
     * gc-images 用它派生白名单。缺了它前者会把用户刚上传的截图判成站外链接，
     * 后者会拒绝执行——两种都不该等到运行时才发现。
     */
    S3_PUBLIC_BASE_URL: z.url(),
  })
  .parse(process.env)
