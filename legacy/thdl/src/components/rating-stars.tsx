"use client";

import { Star } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function RatingStars({ resourceId, loggedIn }: { resourceId: string; loggedIn: boolean }) {
  const [hover, setHover] = useState(0);
  const [value, setValue] = useState(0);
  const [, start] = useTransition();
  const router = useRouter();

  async function rate(score: number) {
    if (!loggedIn) {
      toast.error("请先登录后再评分");
      return;
    }
    setValue(score);
    const res = await fetch("/api/ratings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId, score }),
    });
    if (!res.ok) {
      toast.error("评分失败");
      return;
    }
    toast.success("感谢你的评分");
    start(() => router.refresh());
  }

  const shown = hover || value;
  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onClick={() => rate(n)}
          className="p-1 transition-transform hover:scale-110"
          aria-label={`${n}星`}
        >
          <Star
            className={`size-6 ${n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
          />
        </button>
      ))}
    </div>
  );
}
