'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [pending, start] = useTransition();

  return (
    <form
      className="flex w-full max-w-2xl gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        if (!query) return;
        start(() => router.push(`/search?q=${encodeURIComponent(query)}`));
      }}
    >
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索曲名 / 社团 / 原曲名..."
        className="h-11"
      />
      <Button type="submit" size="lg" disabled={pending}>
        <Search className="size-4" /> 搜索
      </Button>
    </form>
  );
}
