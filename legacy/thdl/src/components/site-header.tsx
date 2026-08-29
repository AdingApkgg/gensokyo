import Link from "next/link";
import { Sparkles, Upload, LayoutDashboard, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { getSession } from "@/lib/get-session";

export async function SiteHeader() {
  const session = await getSession();
  const role = session?.user?.role;
  const isStaff = role === "admin" || role === "moderator";
  return (
    <header className="sticky top-0 z-40 border-b bg-background/70 backdrop-blur-xl">
      <div className="container mx-auto flex h-14 items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-5 text-primary" />
          <span>东方资源站</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 text-sm md:flex">
          <Link href="/resources" className="px-3 py-1.5 rounded-md hover:bg-accent">
            资源
          </Link>
          <Link href="/resources?category=music" className="px-3 py-1.5 rounded-md hover:bg-accent">
            音乐
          </Link>
          <Link href="/resources?category=game" className="px-3 py-1.5 rounded-md hover:bg-accent">
            游戏
          </Link>
          <Link href="/resources?category=cg" className="px-3 py-1.5 rounded-md hover:bg-accent">
            CG
          </Link>
          <Link href="/resources?category=doujinshi" className="px-3 py-1.5 rounded-md hover:bg-accent">
            同人志
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/resources" aria-label="搜索"><Search className="size-4" /></Link>
          </Button>
          {session?.user && (
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/upload">
                <Upload className="size-4" />
                上传
              </Link>
            </Button>
          )}
          {isStaff && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dash">
                <LayoutDashboard className="size-4" />
                后台
              </Link>
            </Button>
          )}
          <ThemeToggle />
          <UserMenu user={session?.user ?? null} />
        </div>
      </div>
    </header>
  );
}
