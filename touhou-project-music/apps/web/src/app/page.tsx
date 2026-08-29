import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">东方同人音乐站</h1>
      <p className="text-muted-foreground text-center">
        聚合网易云 / QQ / 酷狗 / Bilibili / 本地音源，在线试听与下载
      </p>
      <div className="flex gap-3">
        <Link
          href="/search"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm"
        >
          搜索
        </Link>
        <Link href="/circles" className="rounded-md border px-4 py-2 text-sm">
          社团列表
        </Link>
      </div>
    </main>
  );
}
