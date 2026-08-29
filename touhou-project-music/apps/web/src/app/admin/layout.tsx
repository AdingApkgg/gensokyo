import Link from 'next/link';
import type { ReactNode } from 'react';
import { ClipboardList } from 'lucide-react';

const NAV = [{ href: '/admin/submissions', label: '投稿审核', icon: ClipboardList }] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr] pb-24">
      <aside className="bg-muted/40 border-r">
        <div className="px-5 py-4 text-sm font-semibold">管理后台</div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:bg-accent hover:text-accent-foreground inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="overflow-auto p-6">{children}</div>
    </div>
  );
}
