"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  resource: {
    id: string;
    slug: string;
    title: string;
    category: string;
    circle: string;
    author: string;
    description: string;
    externalLinks: { label: string; url: string }[];
  };
};

export function EditForm({ resource }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(resource.title);
  const [category, setCategory] = useState(resource.category);
  const [circle, setCircle] = useState(resource.circle);
  const [author, setAuthor] = useState(resource.author);
  const [description, setDescription] = useState(resource.description);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const res = await fetch(`/api/resources/${resource.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, category, circle, author, description }),
    });
    setPending(false);
    if (!res.ok) return toast.error("保存失败");
    toast.success("已保存");
    router.push(`/resources/${resource.slug}`);
    router.refresh();
  }

  async function remove() {
    if (!confirm("确认删除这个资源？此操作不可恢复。")) return;
    const res = await fetch(`/api/resources/${resource.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("删除失败");
    toast.success("已删除");
    router.push("/resources");
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="space-y-2">
        <Label>标题</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>分类</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["music","game","cg","doujinshi","mmd","video","wallpaper","tool","other"].map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>社团</Label>
          <Input value={circle} onChange={(e) => setCircle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>作者</Label>
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>简介</Label>
        <Textarea rows={8} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex justify-between">
        <Button variant="destructive" onClick={remove}>删除</Button>
        <Button onClick={save} disabled={pending}>{pending ? "保存中…" : "保存"}</Button>
      </div>
    </div>
  );
}
