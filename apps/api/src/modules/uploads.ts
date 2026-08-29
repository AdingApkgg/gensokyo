import { Hono } from 'hono'
import { fail } from '../errors'
import { requireAuth } from '../middleware/require'
import type { AppEnv } from '../middleware/session'
import { putImage } from '../storage'

/**
 * 图片上传。只服务封面与头像这类小图；大型资源用外链镜像，不经过这里。
 * 走 multipart 代理而非预签名——对象与响应在同一个请求里产生，
 * 失败即无痕，不会留下需要 GC 的孤儿。
 */
export const uploads = new Hono<AppEnv>().post(
  '/image',
  requireAuth,
  async (c) => {
    const form = await c.req.parseBody()
    const file = form.file
    const purposeRaw = form.purpose

    if (!(file instanceof File))
      return fail(c, 'validation_failed', 400, ['file'])
    const purpose = purposeRaw === 'avatar' ? 'avatar' : 'cover'

    const result = await putImage(purpose, file)
    if (!result.ok) {
      if (result.reason === 'size') return fail(c, 'file_too_large', 413)
      return fail(c, 'validation_failed', 400, ['file'])
    }

    return c.json({ url: result.url, size: result.size })
  },
)
