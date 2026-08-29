"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function FavoriteButton({
  resourceId,
  initial,
  loggedIn,
}: {
  resourceId: string;
  initial: boolean;
  loggedIn: boolean;
}) {
  const [fav, setFav] = useState(initial);
  const [, start] = useTransition();
  const router = useRouter();

  async function toggle() {
    if (!loggedIn) return toast.error("请先登录");
    const optimistic = !fav;
    setFav(optimistic);
    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId }),
    });
    if (!res.ok) {
      setFav(!optimistic);
      return toast.error("操作失败");
    }
    const data = (await res.json()) as { favorited: boolean };
    setFav(data.favorited);
    start(() => router.refresh());
  }

  return (
    <Button variant={fav ? "default" : "outline"} className="w-full gap-2" onClick={toggle}>
      <Heart className={`size-4 ${fav ? "fill-current" : ""}`} />
      {fav ? "已收藏" : "收藏"}
    </Button>
  );
}
