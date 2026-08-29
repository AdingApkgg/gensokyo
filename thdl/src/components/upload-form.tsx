"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBytes } from "@/lib/utils";

const MULTIPART_THRESHOLD = 20 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;

type UploadedFile = { name: string; size: number; contentType: string; key: string };

async function uploadSingle(file: File, signal: AbortSignal, onProgress: (p: number) => void) {
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", kind: "file" }),
  });
  if (!presignRes.ok) throw new Error("presign failed");
  const { key, url } = (await presignRes.json()) as { key: string; url: string };

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network error"));
    xhr.onabort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
  return key;
}

async function uploadMultipart(file: File, onProgress: (p: number) => void) {
  const start = await fetch("/api/upload/multipart?action=start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
  }).then((r) => r.json());
  const { key, uploadId } = start as { key: string; uploadId: string };

  const partCount = Math.ceil(file.size / PART_SIZE);
  const parts: { ETag: string; PartNumber: number }[] = [];
  for (let i = 0; i < partCount; i++) {
    const blob = file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE));
    const { url } = await fetch("/api/upload/multipart?action=part", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, uploadId, partNumber: i + 1 }),
    }).then((r) => r.json());
    const res = await fetch(url, { method: "PUT", body: blob });
    if (!res.ok) throw new Error(`part ${i + 1} failed`);
    const etag = res.headers.get("etag")?.replaceAll('"', "") ?? "";
    parts.push({ ETag: etag, PartNumber: i + 1 });
    onProgress((i + 1) / partCount);
  }
  await fetch("/api/upload/multipart?action=complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, uploadId, parts }),
  });
  return key;
}

export function UploadForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("music");
  const [circle, setCircle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [queue, setQueue] = useState<{ name: string; progress: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleCover(f: File) {
    const ctl = new AbortController();
    try {
      const presign = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: f.name, contentType: f.type, kind: "cover" }),
      }).then((r) => r.json());
      await fetch(presign.url, { method: "PUT", body: f, headers: { "content-type": f.type }, signal: ctl.signal });
      setCoverKey(presign.key);
      setCoverPreview(URL.createObjectURL(f));
      toast.success("封面已上传");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleFiles(list: FileList) {
    const arr = Array.from(list);
    for (const f of arr) {
      const idx = queue.length;
      setQueue((q) => [...q, { name: f.name, progress: 0 }]);
      try {
        const key =
          f.size >= MULTIPART_THRESHOLD
            ? await uploadMultipart(f, (p) => setQueue((q) => q.map((it, i) => (i === idx ? { ...it, progress: p } : it))))
            : await uploadSingle(f, new AbortController().signal, (p) =>
                setQueue((q) => q.map((it, i) => (i === idx ? { ...it, progress: p } : it)))
              );
        setFiles((prev) => [...prev, { name: f.name, size: f.size, contentType: f.type || "application/octet-stream", key }]);
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
  }

  async function submit() {
    if (!title.trim()) return toast.error("请填写标题");
    if (files.length === 0 && !coverKey) return toast.error("至少上传一个文件或封面");
    setSubmitting(true);
    const res = await fetch("/api/resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        circle: circle || undefined,
        author: author || undefined,
        description,
        coverKey,
        files,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.error ?? "提交失败");
    }
    const { slug } = (await res.json()) as { slug: string };
    toast.success("已发布");
    router.push(`/resources/${slug}`);
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="space-y-2">
        <Label>标题</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：蓬莱人形 Reimu Remix" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>分类</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="music">音乐</SelectItem>
              <SelectItem value="game">游戏</SelectItem>
              <SelectItem value="cg">CG</SelectItem>
              <SelectItem value="doujinshi">同人志</SelectItem>
              <SelectItem value="mmd">MMD</SelectItem>
              <SelectItem value="video">视频</SelectItem>
              <SelectItem value="wallpaper">壁纸</SelectItem>
              <SelectItem value="tool">工具</SelectItem>
              <SelectItem value="other">其他</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>社团 (可选)</Label>
          <Input value={circle} onChange={(e) => setCircle(e.target.value)} placeholder="例：上海アリス幻樂団" />
        </div>
        <div className="space-y-2">
          <Label>作者 (可选)</Label>
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>简介</Label>
        <Textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="支持简单 Markdown" />
      </div>

      <div className="space-y-2">
        <Label>封面</Label>
        <div className="flex items-center gap-3">
          <label className="relative flex h-28 w-28 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed bg-muted/40 text-xs text-muted-foreground hover:border-primary/40">
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="cover" className="h-full w-full object-cover" />
            ) : (
              <span>点击选择</span>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleCover(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <Label>文件</Label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground hover:border-primary/40">
          <Upload className="size-4" />
          点击或拖拽文件（支持多选，大文件自动分片上传）
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </label>
        {queue.length > 0 && (
          <ul className="space-y-1">
            {queue.map((q, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                {q.name} — {(q.progress * 100).toFixed(0)}%
                <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${q.progress * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded border bg-background/40 px-2 py-1">
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                <Button size="icon" variant="ghost" onClick={() => setFiles((p) => p.filter((_, ii) => ii !== i))}>
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={submitting} size="lg">
          {submitting ? "提交中…" : "发布"}
        </Button>
      </div>
    </div>
  );
}
