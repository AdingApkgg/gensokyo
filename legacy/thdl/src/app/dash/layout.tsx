import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/get-session";
import { SiteHeader } from "@/components/site-header";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const role = session?.user?.role;
  if (!session?.user || (role !== "admin" && role !== "moderator")) redirect("/");
  return (
    <>
      <SiteHeader />
      <div className="container mx-auto grid gap-6 px-4 py-8 md:grid-cols-[200px_1fr]">
        <aside className="space-y-1">
          <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">后台</div>
          <Link href="/dash" className="block rounded-md px-3 py-2 text-sm hover:bg-accent">概览</Link>
          <Link href="/dash/resources" className="block rounded-md px-3 py-2 text-sm hover:bg-accent">资源管理</Link>
          <Link href="/dash/reports" className="block rounded-md px-3 py-2 text-sm hover:bg-accent">举报</Link>
        </aside>
        <section>{children}</section>
      </div>
    </>
  );
}
