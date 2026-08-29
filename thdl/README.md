# THDL · 东方资源站

灵感来自 [inarigal.com](https://inarigal.com) 的东方Project 同人资源分享社区。用户可自主注册、上传、编辑资源，打分、评论；先发后审，管理员在 `/dash` 下架。

## 技术栈

- Next.js 16 (App Router, RSC) · React 19 · TypeScript · Tailwind v4
- shadcn/ui · Radix · Lucide · Framer Motion · next-themes
- Three.js + React Three Fiber（樱花粒子背景）
- better-auth · Drizzle ORM · PostgreSQL
- Backblaze B2（S3 兼容）预签名 PUT / Multipart 分片上传
- systemd + Caddy（`output: standalone`）

## 目录

```
src/app/(site)/   用户页面
src/app/dash/     管理后台
src/app/api/      REST 路由
src/components/   UI 组件
src/lib/db/       Drizzle schema / 客户端
src/lib/auth.ts   better-auth (服务端)
src/lib/auth-client.ts  better-auth React 客户端
src/lib/get-session.ts  auth.api.getSession 包装
src/lib/s3.ts     B2 客户端 + 预签名
deploy/           systemd + Caddy
```

## 本地开发

```bash
cp .env.example .env.local
pnpm install
pnpm db:push
pnpm dev
```

`.env` 需要：`DATABASE_URL` · `BETTER_AUTH_SECRET` · `BETTER_AUTH_URL` · `B2_ENDPOINT/REGION/BUCKET/ACCESS/SECRET` · `B2_PUBLIC_BASE_URL` · 可选 `AUTH_GITHUB_*` / `AUTH_GOOGLE_*`。

生成 secret：`openssl rand -base64 32`

### B2

- Bucket 开启 S3 兼容 API，`B2_ENDPOINT` 形如 `https://s3.us-east-005.backblazeb2.com`
- **CORS**：允许来自站点域名的 `PUT`（浏览器直传）
- 下载走 `/api/download` 签名 URL，计数后 302 到预签名地址

### 首个管理员

```sql
update users set role = 'admin' where email = 'you@example.com';
```

## 部署（自托管 / systemd）

```bash
# 服务器
sudo useradd -r -s /usr/sbin/nologin thdl
sudo mkdir -p /var/www/thdl /var/log/thdl /etc/thdl
sudo chown -R thdl:thdl /var/www/thdl /var/log/thdl

# 构建 & 同步 standalone 产物
pnpm build
rsync -a .next/standalone/ server:/var/www/thdl/
rsync -a .next/static       server:/var/www/thdl/.next/
rsync -a public             server:/var/www/thdl/

# env + systemd + Caddy
sudo cp .env.production /etc/thdl/thdl.env && sudo chmod 600 /etc/thdl/thdl.env
sudo cp deploy/thdl.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now thdl
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

## 路线图

- [x] 认证 · 主题 · 站点骨架
- [x] 资源 CRUD · 列表 / 详情 · 搜索 / 分类 / 排序
- [x] B2 预签名单文件 + Multipart 分片上传 + 封面
- [x] 五星评分 · 评论 · 下载计数
- [x] `/dash` 审核 · 下架 · 举报视图
- [x] Three.js 樱花 · Framer Motion 卡片过渡
- [ ] 收藏 + 举报提交 UI
- [ ] Meilisearch 中文全文检索
- [ ] Serwist PWA 离线缓存
- [ ] i18n (zh/ja/en)
- [ ] ClamAV 病毒扫描 worker
