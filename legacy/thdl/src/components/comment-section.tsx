"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type Row = {
  id: number;
  body: string;
  createdAt: Date;
  parentId: number | null;
  userId: string;
  userName: string | null;
  userImage: string | null;
};

export function CommentSection({
  resourceId,
  comments,
  currentUserId,
}: {
  resourceId: string;
  comments: Row[];
  currentUserId: string | null;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  async function submit() {
    if (!currentUserId) return toast.error("请先登录");
    if (!body.trim()) return;
    const res = await fetch("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId, body }),
    });
    if (!res.ok) return toast.error("发送失败");
    setBody("");
    start(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card/80 p-4 backdrop-blur">
        <Textarea
          placeholder={currentUserId ? "说点什么…" : "登录后评论"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={!currentUserId}
          rows={3}
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={submit} disabled={!currentUserId || !body.trim() || pending}>
            发送
          </Button>
        </div>
      </div>
      <ul className="space-y-3">
        {comments.length === 0 && (
          <li className="text-sm text-muted-foreground">还没有评论，来抢沙发。</li>
        )}
        {comments.map((c) => (
          <li key={c.id} className="flex gap-3 rounded-xl border bg-card/60 p-4">
            <Avatar className="size-8">
              <AvatarFallback>{(c.userName ?? "?").slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{c.userName ?? "匿名"}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
