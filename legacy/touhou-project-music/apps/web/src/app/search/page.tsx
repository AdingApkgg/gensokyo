import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { searchAll } from '@thm/music-sources';
import { SearchBox } from '@/components/search-box';
import { TrackRow } from '@/components/track-row';
import { Skeleton } from '@/components/ui/skeleton';

export const dynamic = 'force-dynamic';

async function Results({ q }: { q: string }) {
  const results = await searchAll(q, 8);
  if (results.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">没有结果。换个关键词试试？</p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {results.map((hit, i) => (
        <TrackRow key={`${hit.provider}-${hit.externalId}-${i}`} hit={hit} />
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-md" />
      ))}
    </div>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6 pb-32">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" /> 首页
      </Link>
      <SearchBox />
      {q ? (
        <Suspense key={q} fallback={<ResultsSkeleton />}>
          <Results q={q} />
        </Suspense>
      ) : (
        <p className="text-muted-foreground text-sm">输入关键词开始搜索。</p>
      )}
    </main>
  );
}
