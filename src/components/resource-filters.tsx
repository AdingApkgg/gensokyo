"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTransition } from "react";

const cats = [
  { v: "", label: "全部分类" },
  { v: "music", label: "音乐" },
  { v: "game", label: "游戏" },
  { v: "cg", label: "CG" },
  { v: "doujinshi", label: "同人志" },
  { v: "mmd", label: "MMD" },
  { v: "video", label: "视频" },
  { v: "wallpaper", label: "壁纸" },
  { v: "tool", label: "工具" },
  { v: "other", label: "其他" },
];

export function ResourceFilters() {
  const router = useRouter();
  const sp = useSearchParams();
  const [, start] = useTransition();

  function push(next: Record<string, string | undefined>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    start(() => router.push(`/resources?${p.toString()}`));
  }

  return (
    <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
      <Input
        placeholder="搜索标题…"
        defaultValue={sp.get("q") ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") push({ q: (e.target as HTMLInputElement).value });
        }}
        className="md:max-w-sm"
      />
      <Select
        value={sp.get("category") ?? ""}
        onValueChange={(v) => push({ category: v || undefined })}
      >
        <SelectTrigger className="md:w-44"><SelectValue placeholder="分类" /></SelectTrigger>
        <SelectContent>
          {cats.map((c) => (
            <SelectItem key={c.v || "all"} value={c.v || "all"}>{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={sp.get("sort") ?? "new"}
        onValueChange={(v) => push({ sort: v })}
      >
        <SelectTrigger className="md:w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="new">最新</SelectItem>
          <SelectItem value="popular">最热</SelectItem>
          <SelectItem value="rating">评分最高</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
