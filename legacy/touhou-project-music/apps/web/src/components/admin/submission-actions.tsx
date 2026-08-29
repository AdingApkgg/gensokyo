'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SubmissionActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');

  async function review(action: 'approve' | 'reject') {
    const res = await fetch(`/api/admin/submissions/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) {
      alert(`失败: ${res.status}`);
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder="审核备注（可选）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="h-9"
      />
      <Button
        size="sm"
        disabled={pending}
        onClick={() => review('approve')}
        className="shrink-0"
      >
        <Check className="size-4" /> 通过
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => review('reject')}
        className="shrink-0"
      >
        <X className="size-4" /> 拒绝
      </Button>
    </div>
  );
}
