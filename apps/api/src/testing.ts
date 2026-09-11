import {
  cleanupTracked as cleanupDb,
  trackedResourceIds,
} from '@gensokyo/db/testing'
import { meiliFetch, SEARCH_INDEX } from './search'

export { trackResource, trackTopic, trackUser } from '@gensokyo/db/testing'

/**
 * api 测试的收尾入口。**测试文件一律从这里拿 `cleanupTracked`**，别直接引
 * `@gensokyo/db/testing`：db 那份只删库里的行，而测试里发布过的资源已经被
 * `syncResource` 推进了 Meili——不顺手删掉，开发索引每跑一次就多一批指向
 * 已删资源的僵尸文档，搜索的 total 会虚高（回库白名单挡得住行，挡不住计数）。
 */
export async function cleanupTracked(): Promise<void> {
  const ids = trackedResourceIds()
  await cleanupDb()
  if (ids.length === 0) return
  await meiliFetch(`/indexes/${SEARCH_INDEX}/documents/delete-batch`, {
    method: 'POST',
    body: JSON.stringify(ids),
  }).catch((err) => {
    console.error('[search] 测试收尾删文档失败', err)
  })
}
