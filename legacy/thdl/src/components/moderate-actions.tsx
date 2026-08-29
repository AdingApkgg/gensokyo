"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ModerateActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  async function setStatus(s: string) {
    const res = await fetch(`/api/resources/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    if (!res.ok) return toast.error("操作失败");
    toast.success("已更新");
    router.refresh();
  }
  return (
    <div className="flex gap-2">
      {status !== "public" && <Button size="sm" variant="outline" onClick={() => setStatus("public")}>上架</Button>}
      {status !== "hidden" && <Button size="sm" variant="outline" onClick={() => setStatus("hidden")}>下架</Button>}
      {status !== "takedown" && <Button size="sm" variant="destructive" onClick={() => setStatus("takedown")}>移除</Button>}
    </div>
  );
}
