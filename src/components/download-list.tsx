"use client";

import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function DownloadList({
  resourceId,
  files,
}: {
  resourceId: string;
  files: { id: number; name: string; size: number; sizeLabel: string }[];
}) {
  async function dl(fileId: number) {
    const res = await fetch(`/api/download?resource=${resourceId}&file=${fileId}`);
    if (!res.ok) return toast.error("获取下载链接失败");
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener,noreferrer");
  }
  if (files.length === 0)
    return <p className="text-sm text-muted-foreground">暂无附件</p>;
  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 rounded-lg border bg-background/40 px-3 py-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{f.name}</div>
            <div className="text-xs text-muted-foreground">{f.sizeLabel}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => dl(f.id)}>
            <Download className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
