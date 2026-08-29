## 一、文件清单与角色

| 路径 | 角色 |
|---|---|
| `/Users/i/Code/th/legacy/thdl/src/lib/s3.ts` | 服务端唯一 S3 出口，导出 client + 6 个 helper |
| `/Users/i/Code/th/legacy/thdl/src/lib/s3-public.ts` | 客户端 bundle 专用的 `publicUrl`（避免把服务端 client 打进浏览器） |
| `/Users/i/Code/th/legacy/thdl/src/app/api/upload/presign/route.ts` | 单文件直传预签名 |
| `/Users/i/Code/th/legacy/thdl/src/app/api/upload/multipart/route.ts` | 分片上传，单路由 `?action=start\|part\|complete\|abort` |
| `/Users/i/Code/th/legacy/thdl/src/app/api/download/route.ts` | 签名下载 URL + 计数 |
| `/Users/i/Code/th/legacy/thdl/src/components/upload-form.tsx` | 客户端编排（阈值判断 / 切片 / 进度 / 提交） |
| `/Users/i/Code/th/legacy/thdl/src/components/download-list.tsx` | 下载按钮，`window.open` 签名 URL |
| `/Users/i/Code/th/legacy/thdl/src/app/api/resources/route.ts` | 落库，**接收客户端上报的 key** |

---

## 二、预签名直传流程（完整）

### 2.1 单文件路径（`size < 20MiB`）

```
浏览器                                 服务端                        B2
  │ POST /api/upload/presign            │                            │
  │  {filename, contentType, kind}      │                            │
  │────────────────────────────────────>│ getSession() → 401 gate    │
  │                                     │ zod parse                  │
  │                                     │ ext 白名单化 + UUID 生成 key│
  │                                     │ getSignedUrl(PutObject,600s)│
  │<────────── {key, url} ──────────────│                            │
  │ XHR PUT url, body=File, 带 content-type header ─────────────────>│
  │<───────────── 200 ──────────────────────────────────────────────│
  │ 收集 {name,size,contentType,key} 入本地 state                     │
  │ POST /api/resources {…, files:[{key,…}]} ──> 落 resource_files    │
```

服务端只做三件事：**鉴权、生成 key、签名**。它不接触文件字节，不记录"我签发过这个 key"。

key 构造（`presign/route.ts:19-21`）：

```ts
const ext = (filename.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
const safeExt = ext.slice(0, 8) || "bin";
const key = `${kind}/${session.user.id}/${crypto.randomUUID()}.${safeExt}`;
```

即 `cover/<userId>/<uuid>.<ext>` 或 `file/<userId>/<uuid>.<ext>`。原始文件名**不进 key**（只进 DB 的 `resource_files.name`）——这一点是对的，规避了路径穿越和 CJK 文件名签名歧义，M3 应保留。

客户端上传用 XHR 而非 fetch，**唯一理由是要 `upload.onprogress`**（`upload-form.tsx:28-38`）：

```ts
const xhr = new XMLHttpRequest();
xhr.open("PUT", url);
xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
xhr.onerror = () => reject(new Error("network error"));
xhr.onabort = () => reject(new Error("aborted"));
signal.addEventListener("abort", () => xhr.abort());
xhr.send(file);
```

### 2.2 分片路径（`size >= 20MiB`，片 8MiB）

阈值常量在 `upload-form.tsx:14-15`：`MULTIPART_THRESHOLD = 20 * 1024 * 1024`，`PART_SIZE = 8 * 1024 * 1024`。

协调方式：**服务端无状态**，`uploadId` 与 parts 数组全程由浏览器持有并回传。

```ts
// start：服务端生成 key（同单传规则，但 kind 硬编码为 "file"），返回 uploadId
const uploadId = await startMultipart(key, p.data.contentType);
return NextResponse.json({ key, uploadId });

// 客户端主循环（upload-form.tsx:50-64）—— 串行，每片两次往返
const partCount = Math.ceil(file.size / PART_SIZE);
const parts: { ETag: string; PartNumber: number }[] = [];
for (let i = 0; i < partCount; i++) {
  const blob = file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE));
  const { url } = await fetch("/api/upload/multipart?action=part", { … body: JSON.stringify({ key, uploadId, partNumber: i + 1 }) }).then(r => r.json());
  const res = await fetch(url, { method: "PUT", body: blob });
  if (!res.ok) throw new Error(`part ${i + 1} failed`);
  const etag = res.headers.get("etag")?.replaceAll('"', "") ?? "";
  parts.push({ ETag: etag, PartNumber: i + 1 });
  onProgress((i + 1) / partCount);
}
```

注意 `res.headers.get("etag")` —— **这要求 B2 的 CORS 配置里 `ExposeHeaders` 含 `ETag`**，否则跨源读到 `null`，parts 数组全是空 ETag，complete 必失败。legacy 仓库里没有 CORS 配置文件，说明这份配置是在 B2 控制台手工设的、**没有版本化**。M3 必须把 bucket CORS 规则写成 IaC 或至少写进文档。

### 2.3 失败处理（现状：基本没有）

- 单传：`uploadSingle` 抛错 → `handleFiles` catch → `toast.error`。B2 上留下的部分对象由 S3 语义自动丢弃（PUT 非原子失败不产生对象），无泄漏。
- 分片：**任一片失败直接 throw，客户端从不调用 `?action=abort`**。`abortMultipart` 写了、路由挂了、**没有任何调用点**（我 grep 过全仓）。后果是 B2 上堆积未完成的 multipart upload，已上传分片**持续计费且不可见**。M3 必须补：客户端 `try/finally` 调 abort + 服务端定时任务扫 `ListMultipartUploads` 清理超过 24h 的残留。
- **无分片重试、无并发**：8MiB 串行，1GB 文件 = 128 片 × (1 次 presign 往返 + 1 次上传)，任何一片网络抖动整个文件重来。
- **无断点续传**：`uploadId` 只活在组件 state 里，刷新页面即丢失。

---

## 三、下载签名 URL 与防盗链

`download/route.ts` 全文逻辑：

```ts
const [file] = await db.select().from(resourceFiles)
  .where(and(eq(resourceFiles.id, fileId), eq(resourceFiles.resourceId, resourceId))).limit(1);
if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

const [r] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
if (!r || r.status === "takedown") return NextResponse.json({ error: "unavailable" }, { status: 403 });

const session = await getSession();
const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

const signed = await presignGet(file.s3Key, 600);

await db.transaction(async (tx) => {
  await tx.insert(downloadLogs).values({ resourceId, userId: session?.user?.id ?? null, ip });
  await tx.update(resources).set({ downloads: sql`${resources.downloads} + 1` }).where(eq(resources.id, resourceId));
});

return NextResponse.json({ url: signed });
```

生成方式：`GetObjectCommand` + `getSignedUrl`，TTL 600s，返回 JSON，前端 `window.open(url, "_blank", "noopener,noreferrer")`。

**防盗链考虑：实质为零。** 逐条：

1. **无鉴权**：`getSession()` 只用来记 log，`null` 也照发 URL。匿名可下载。
2. **无限速**：没有 Redis 令牌桶，没有 IP 频次限制。`REDIS_URL` 在 `.env.example` 里但 `ioredis` 在下载链路完全没用上。
3. **状态门槛只挡 `takedown`**：枚举是 `["public","pending","hidden","takedown"]`，所以**待审（pending）和已隐藏（hidden）的资源仍可下载**。M3 的"先发后审"机制下这是直接的漏洞——审核队列里的东西已经在分发了。
4. **计数在签发时 +1，不是在实际下载时**：`GET /api/download` 空跑即刷量，`downloads` 和 `download_logs` 都可无限灌水。M3 若要做排行榜/热度，必须换成 B2 访问日志回流或至少加 `(userId|ip, fileId)` 去重窗口。
5. **签名 URL 可转发**：600s 内任何人拿到该 URL 都能下载，无 IP 绑定。S3 SigV4 本身不支持 IP 绑定（CloudFront signed URL 才支持），这是选型层面的限制。
6. **最致命的一条 —— 私有签名其实是装饰**：`.env.example` 里 `B2_PUBLIC_BASE_URL=https://f005.backblazeb2.com/file/thdl-resources`，而 `s3-public.ts` 的封面直接拼 `${base}/${key}`。B2 的 `/file/<bucket>/` 原生下载 URL **只对 public bucket 生效**，且 B2 的 public/private 是**整桶级别**的。也就是说：为了让封面能显示，桶必须是 public；桶是 public，则 `file/<uid>/<uuid>.zip` 同样能被 `${PUBLIC_BASE}/${key}` 匿名直取，presignGet 提供的保护为 0。key 里的 UUID 是唯一的"防线"，而这个 key **明文存在 `resource_files.s3_key`，并且会随任何泄露 DB 的接口一起暴露**。

   → **M3 必须双桶**：`gensokyo-assets`（public，封面/缩略图，走 CDN）+ `gensokyo-files`（private，资源本体，只走签名 URL）。这是架构级决策，不是补丁。

---

## 四、SDK / API 具体清单

**依赖**（`package.json`）：
```json
"@aws-sdk/client-s3": "^3.1033.0",
"@aws-sdk/s3-request-presigner": "^3.1033.0"
```
`pnpm-lock.yaml` 实锁 `3.1033.0`（传递依赖 `@smithy/*` 4.x、`@aws-sdk/core@3.974.2` 等，共约 50 个包）。**没有装 `@aws-sdk/lib-storage`**（`Upload` 高层封装），分片是手写的。

**用到的 Command（全部 6 个，都在 `s3.ts` 顶部一次性 import）**：
`PutObjectCommand` · `GetObjectCommand` · `CreateMultipartUploadCommand` · `UploadPartCommand` · `CompleteMultipartUploadCommand` · `AbortMultipartUploadCommand`（后者 import 了、导出了 helper、**无调用点**）。

**未用到但 M3 会需要**：`HeadObjectCommand`（上传后校验真实 size/contentType）、`DeleteObjectCommand`（下架/清理）、`ListMultipartUploadsCommand`（残留清理）、`ListObjectsV2Command`（对账）。

**客户端构造（`s3.ts:14-25`，逐字）**：

```ts
export const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION ?? "us-east-005",
  credentials: {
    accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "",
  },
  forcePathStyle: true,
});

export const BUCKET = process.env.B2_BUCKET ?? "thdl-resources";
export const PUBLIC_BASE = process.env.B2_PUBLIC_BASE_URL ?? "";
```

`forcePathStyle: true` 是 B2 必需（B2 不支持 virtual-hosted-style）。`?? ""` 的凭据兜底意味着**缺环境变量不会启动即失败，而是在第一次签名时给出一个签名错误的 URL** —— M3 用 zod 在启动时校验 env。

**presign 调用（逐字）**：

```ts
export async function presignPut(key: string, contentType: string, expiresIn = 600) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn }
  );
}

export async function presignGet(key: string, expiresIn = 600) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}
```

**multipart 三段（逐字）**：

```ts
export async function startMultipart(key: string, contentType: string) {
  const out = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  );
  return out.UploadId!;
}

export async function presignPart(key: string, uploadId: string, partNumber: number) {
  return getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: 3600 }
  );
}

export async function completeMultipart(
  key: string, uploadId: string, parts: { ETag: string; PartNumber: number }[]
) {
  return s3.send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts },
  }));
}
```

---

## 五、⚠️ 实测发现：presign 会签进一个错误的 CRC32（迁移前必须处理）

我在本机用 Bun 1.3.14 装了**锁文件里的确切版本 3.1033.0** 跑了探针，把 legacy 的 client 配置原样复现：

```
PutObject  -> X-Amz-Content-Sha256=UNSIGNED-PAYLOAD | x-amz-checksum-crc32=AAAAAA== | x-amz-sdk-checksum-algorithm=CRC32 | x-id=PutObject
UploadPart -> X-Amz-Content-Sha256=UNSIGNED-PAYLOAD | partNumber=1 | uploadId=U | x-amz-checksum-crc32=AAAAAA== | x-amz-sdk-checksum-algorithm=CRC32
GetObject  -> X-Amz-Content-Sha256=UNSIGNED-PAYLOAD | x-amz-checksum-mode=ENABLED | x-id=GetObject
```

`AAAAAA==` 是**空 body 的 CRC32**（预签名时没有 body，flexible-checksums 中间件照样算了一个），而且它被写进 query string 参与了签名，客户端无法剔除。真实 S3 会以 checksum mismatch 拒绝；B2 目前大概率是忽略这个未知参数才让 legacy 能跑通 —— 换句话说 **legacy 是在依赖 B2 的宽容度，不是在正确使用 SDK**。

实测修复（同一版本，加两个 client 选项后参数干净了）：

```ts
const s3 = new S3Client({
  endpoint, region, credentials, forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",   // ← 去掉 x-amz-checksum-crc32 / x-amz-sdk-checksum-algorithm
  responseChecksumValidation: "WHEN_REQUIRED",   // ← 去掉 x-amz-checksum-mode
});
// 结果：PutObject -> X-Amz-Content-Sha256 | x-id      SignedHeaders: host
```

另两个实测结论：

- **`X-Amz-SignedHeaders` 恒为 `host`** —— `PutObjectCommand` 的 `ContentType` 既没进签名头、也没进 query。所以 `presignPut(key, contentType)` 的 contentType 参数**对签名无任何约束力**：对象最终的 Content-Type 取决于浏览器 PUT 时发的 header，服务端管不住。想约束必须改用 POST Policy（`@aws-sdk/s3-presigned-post`），顺带还能限 `content-length-range`（见下）。
- `GetObjectCommand` 的 `ResponseContentDisposition` **可用**，实测能签出 `response-content-disposition=attachment; filename="album.zip"`。legacy 没用 —— 所以用户下载到的文件名是 `<uuid>.zip` 而不是真实名。**M3 必须加上**，这是资源站的基本体验。

---

## 六、Bun + hono 移植注意事项

### 6.1 Bun 对 aws-sdk 的兼容性（实测，非推测）

Bun 1.3.14 下 `@aws-sdk/client-s3@3.1033.0` 与 `3.1121.0` **都能正常 import、构造 client、`getSignedUrl` 出正确 SigV4 URL、`s3.send()` 发出真实 HTTP 请求**（我起了本地 Bun.serve 假 S3 端点，抓到了 `POST /b/k.zip?uploads=` 和 `POST /b/k.zip?uploadId=UID123`，请求头无异常）。所以 aws-sdk 路线**可行**，不是阻塞项。

代价：`bun add` 拉进 **54 个包**只为签个 URL。冷启动和镜像体积都不划算。

### 6.2 强烈建议：改用 Bun 原生 `Bun.S3Client`（但需混合方案）

实测 Bun 1.3.14 原生 API 对 B2 完全可用：

```ts
const c = new Bun.S3Client({ accessKeyId, secretAccessKey, bucket, region: "us-east-005",
  endpoint: "https://s3.us-east-005.backblazeb2.com" });
c.presign("file/u1/abc.zip", { method: "PUT", expiresIn: 600 });  // 同步返回，零依赖
c.presign("file/u1/abc.zip", { expiresIn: 600 });                  // GET
```
签出的 URL 是标准 path-style SigV4，`SignedHeaders=host`，**且不带那个错误的 CRC32**。可用方法：`presign / file / write / delete / exists / size / stat / list / unlink`，`S3File` 还有 `slice / writer / stream`。

**但有两个硬缺口，决定了必须混合：**

1. **Bun 原生不暴露 multipart 的 create/uploadPart/complete 三段**。`S3File.writer()` 做的是**服务端流式分片**（字节过我们的服务器），不是浏览器直传所需的"给我一个 UploadPart 预签名 URL"。实测 `presign(key, { partNumber, uploadId })` 这些额外参数被**静默忽略**，签出来的 URL 里根本没有 `partNumber`/`uploadId`。
2. **Bun 原生 presign 不支持 `responseContentDisposition`**。实测传了没反应；它的 `type` 选项映射成的是 `response-content-type`，不是 disposition。而下载文件名对香霖堂是刚需。

**结论 —— M3 推荐分工：**

| 场景 | 用什么 |
|---|---|
| 封面/小文件单传 presign PUT | `Bun.S3Client.presign`（零依赖，同步） |
| 资源文件下载签名 GET（要带 filename） | `@aws-sdk` `GetObjectCommand` + `ResponseContentDisposition` |
| 分片 create / part / complete / abort | `@aws-sdk` 四个 Command |
| 服务端侧对账（Head/List/Delete） | `Bun.S3Client`（`stat` / `list` / `delete`）够用 |

若要彻底去掉 aws-sdk，剩下的两个缺口都可以手写 SigV4 query 签名解决（`Bun.CryptoHasher("sha256")` + HMAC 链，约 60 行）—— 这是一个干净的 `packages/storage` 包，值得单独评估。**建议 M3 先用混合方案跑通，把手写 SigV4 列为后续优化**，不要在里程碑关键路径上赌自研签名。

### 6.3 Next.js route handler → hono handler 的逐项差异

| Next.js（legacy） | hono（目标） |
|---|---|
| `export async function POST(req: Request)` | 挂在链式 `.post(path, handler)` 上，**必须保持链式**否则 `hc` RPC 类型断裂 |
| `NextResponse.json(x, { status: 401 })` | `c.json(x, 401)` |
| `new URL(req.url).searchParams.get("action")` | `c.req.query("action")`；但**更该做的是拆成 4 条独立路由** |
| `await req.json().catch(() => ({}))` + `safeParse` | `zValidator('json', schema)` 中间件 + `c.req.valid('json')`，schema 从 `@gensokyo/shared` 引 |
| `getSession()` 内部 `await headers()`（隐式 async context） | hono 里显式 `c.req.raw.headers` → `auth.api.getSession({ headers })`，做成 middleware 挂 `c.set('user', …)` |
| `req.headers.get("x-forwarded-for")` | 同样可用，但 hono 有 `getConnInfo`；生产在反代后仍需读 XFF，且**必须只信任最后一跳** |
| 文件路由即 URL | 路由字符串显式声明；已有 `app.ts` 的 `.basePath('/api')` |

**具体到这几条路由，建议的 hono 形状**（配合 `apps/api/src/app.ts` 已有的 `.route('/kourindou', kourindou)`）：

```
POST /api/kourindou/uploads/presign        单文件
POST /api/kourindou/uploads/multipart      → start，返回 {key, uploadId, partUrls[]}  ← 一次性批量签所有片
POST /api/kourindou/uploads/multipart/:uploadId/complete
POST /api/kourindou/uploads/multipart/:uploadId/abort
GET  /api/kourindou/files/:fileId/download
```

把 `?action=` 拆开的收益不只是美观：**`hc` 无法为 query 分支收窄返回类型**，legacy 那个单路由在 RPC 下会退化成四种响应的联合类型，前端每次都要窄化。拆成四条路由才能拿到目标技术栈想要的端到端类型推导。

**批量签片**（`partUrls[]` 一次返回）能把 128 片文件的往返从 258 次降到 3 次，是 M3 值得直接做掉的改进。

### 6.4 React Router v8 framework mode 特有的两点

1. **`s3-public.ts` 的双文件拆分依然需要，但机制变了**。Next.js 靠 `NEXT_PUBLIC_` 前缀做编译期替换；RRv8/Vite 用 `import.meta.env.VITE_*`。而且 RRv8 是 SSR，`loader` 在服务端跑 —— **更好的做法是不要在客户端拼 URL**，直接在 loader 里把 `coverUrl` 算好塞进 loader data，客户端组件不再需要任何 env。这样 `s3-public.ts` 这个文件在 M3 可以直接不存在。
2. **上传必须走 client fetch，不能走 `action`**。RRv8 的 `action` 收 FormData 会让文件字节过服务器，正好抵消直传的意义。上传编排保持在客户端组件里（`useFetcher` 只用来提交最后那份 metadata JSON）。

### 6.5 Bun 运行时其他注意点

- `crypto.randomUUID()` 在 Bun 全局可用，key 生成逻辑可原样搬。
- legacy 用 `xhr.upload.onprogress` 拿进度 —— 这是**浏览器侧**代码，与 Bun 无关，可原样保留。若想改用 fetch + `ReadableStream` 上传进度，注意浏览器端 request streaming 需要 HTTP/2 且 Safari 支持不全，**建议继续用 XHR**。
- Bun 的 `S3Client` 凭据可从 `Bun.env` 自动读 `S3_ACCESS_KEY_ID` 等标准名；但我们用 `B2_*` 前缀，必须显式传。
- 启动时用 zod 校验 env（legacy 的 `?? ""` 兜底会把配置错误推迟到运行时签名失败，很难排查）。

---

## 七、移植时必须一并修掉的缺陷（按严重度）

1. **公私桶混用导致签名 URL 形同虚设**（第三节第 6 条）。架构级，M3 起手就要双桶。
2. **`/api/resources` 无条件信任客户端上报的 `key`**（`resources/route.ts:15-23` 的 zod 只校验 `key: z.string().min(1)`）。任意登录用户可提交 `file/<别人的userId>/<猜到的uuid>.zip`，把他人对象挂到自己的资源上；`/api/download` 全程不校验归属，照发签名 URL。**修法**：新建 `upload_intent` 表（`id, userId, key, contentType, declaredSize, status, createdAt`），presign 时落一行，创建资源时只接受 `status='uploaded'` 且 `userId` 匹配的 key，并用 `HeadObject` 回填真实 size/etag 到 `resource_files.checksum`（该列存在但**从未被写入**）。
3. **multipart 的 part/complete/abort 不校验 key 归属**（`multipart/route.ts:37-54`）。key 前缀里就有 userId，服务端只需 `key.startsWith(\`file/${session.user.id}/\`)` 就能挡住，legacy 没做。
4. **`abort` 从无调用点 → B2 残留分片持续计费**。客户端 `try/finally` + 服务端定时清理，两边都要。
5. **`pending` / `hidden` 状态的资源仍可下载**。M3 的先发后审直接踩这个坑，下载路由必须白名单 `status === 'published'`（外加上传者本人/审核员可预览的例外分支）。
6. **无任何文件大小上限**。presign 不约束 `content-length` → 有人能往桶里塞 100GB。改用 `@aws-sdk/s3-presigned-post` 的 `content-length-range` 条件，或在 `upload_intent` 里存 `declaredSize` 并在 `HeadObject` 回填时拒绝超限（后者是事后补救，会先产生流量费）。
7. **下载计数在签发时 +1**，可空跑刷量；无限速、无 Turnstile。`REDIS_URL` 和 `TURNSTILE_*` 在 `.env.example` 里但**下载链路完全没接**（全仓 grep `turnstile|rateLimit` 零命中）。
8. **`s3-public.ts` 的兜底路径 `/api/files/${key}` 指向一个不存在的路由**（`src/app/api/` 下只有 auth/comments/download/favorites/ratings/reports/resources/upload 八个）。env 缺失时封面静默 404。
9. **`upload-form.tsx:106` 的 `const idx = queue.length` 是 stale closure**：同一次多选的 N 个文件在同一渲染周期内拿到相同的 `idx`，进度条互相覆盖。改成 `crypto.randomUUID()` 作 key。
10. **`upload-form.tsx:112` 的 `new AbortController().signal` 在调用点即时构造**，controller 立刻被 GC，取消功能实际不存在（cover 上传同理，`ctl` 建了但没有任何 UI 能触发 `ctl.abort()`）。

---

## 八、M3 对象模型对存储层的额外要求（对照产品文档）

产品文档要求 `resource → version → file`，而 legacy 是 `resource → file`（`resource_files.version` 只是个 `varchar(32)` 自由文本字段，无独立版本表）。落到存储层的影响：

- **key 前缀应带版本维度**：`file/<resourceId>/<versionId>/<uuid>.<ext>`，而非 legacy 的 `file/<userId>/<uuid>`。但这会让 presign 时机变复杂（上传时 resource 还不存在）—— 建议保留 `staging/<userId>/<uuid>` 上传，创建版本时**不搬对象**（B2 复制要计费），只在 DB 记录归属。key 里的 userId 不再承担鉴权职责，改由 `upload_intent` 表承担。
- **"B2 对象 + 外链镜像混合"**：legacy 有 `resources.externalLinks: jsonb` 但它挂在 resource 上、且**下载路由完全不处理外链**。M3 应把 file 表设计成 `storage_kind: 'b2' | 'external_mirror'` 的判别联合，`b2` 分支有 `s3Key`，`external` 分支有 `url` —— 用 zod discriminated union 在 `packages/shared` 里定义一份，同时喂运行时校验和 drizzle 类型。
- **多语字段**：`resource_files.name` 是展示用文件名，日文社团的资源大概率有日文原名 + 中文译名。若要多语，`name` 也该进多语字段体系（虽然文件名多语的收益低于标题/社团名，可以列为可选）。
- **评论表预留**：与本次存储链路无关，但注意 `download_logs` 和未来的 `thread`/`post` 表都会以 resource 为中心增长，`download_logs` 只有 `dl_resource_idx` 一个索引，按时间做统计会全表扫 —— M3 建索引时一并考虑 `(resource_id, created_at)`。

---

**探针脚本**（可复现上述实测结论）留在 `/private/tmp/claude-501/-Users-i-Code-th/50ca2741-45ec-485d-81f6-10734be075ca/scratchpad/`：`s3probe.ts`（Bun 原生能力）、`s3probe2.ts`（Bun presign 参数）、`v1033.ts`（锁定版本 aws-sdk 的 CRC32 问题）、`fix.ts`（`WHEN_REQUIRED` 修复验证）、`capture.ts`（假 S3 端点抓 multipart 请求头）。