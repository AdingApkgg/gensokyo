import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t bg-background/60 backdrop-blur">
      <div className="container mx-auto px-4 py-10 text-sm text-muted-foreground">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} 东方资源站 · 本站内容为用户上传，仅供学习交流</p>
          <div className="flex gap-4">
            <Link href="/about" className="hover:text-foreground">关于</Link>
            <Link href="/terms" className="hover:text-foreground">条款</Link>
            <Link href="/dmca" className="hover:text-foreground">版权投诉</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
