/**
 * env 与 app 都在监听端口之前求值完（ESM 静态 import）。env.ts 里的 zod
 * 在模块求值期就 parse，缺配置会直接抛出、进程起不来——这正是要的：
 * 别等到第一个上传请求才发现 S3_PUBLIC_BASE_URL 没配。
 *
 * 端口写死 3001，不读 PORT：见 env.ts 顶部。
 */
import { app } from './app'
import './env'
import { ensureIndex } from './search'

/**
 * 新部署的 Meili 从零起也要拿到带 filterable 设置的空索引，否则第一次带筛选
 * 的搜索会因「属性不可过滤」报错而全部降级。失败只记日志：搜索有 ILIKE 兜底，
 * 不该因为 Meili 没起来而让 api 起不来。
 */
void ensureIndex().catch((err) => console.error('[search] 索引初始化失败', err))

export default {
  port: 3001,
  fetch: app.fetch,
  /**
   * 上传是全站唯一的大体请求（≤5MB 图片 + multipart 开销）。Bun 默认 128MB，
   * 那让任何登录用户每次都能让 api 吞 128MB 再被拒。
   */
  maxRequestBodySize: 6 * 1024 * 1024,
}
