export type ImagePurpose = 'post' | 'cover'

/**
 * 上传一张图到 /api/uploads/image，resolve 为它的公开 URL。
 *
 * 用 XMLHttpRequest 而不是 fetch：**fetch 没有上传进度事件**，而上限 5 MB 的图
 * 在慢网上要传十几秒。同源请求，cookie 自动带上，与 fetch 一致。
 *
 * onProgress 收 0..1；lengthComputable 为 false 的浏览器不回调（进度条停在 0，
 * 文案仍是「上传中…」，信息不丢）。
 */
export function uploadImage(
  file: File,
  purpose: ImagePurpose,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads/image')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`upload failed: ${xhr.status}`))
        return
      }
      try {
        resolve((JSON.parse(xhr.responseText) as { url: string }).url)
      } catch (err) {
        reject(err)
      }
    }
    xhr.onerror = () => reject(new Error('upload failed'))
    const fd = new FormData()
    fd.append('file', file)
    fd.append('purpose', purpose)
    xhr.send(fd)
  })
}
