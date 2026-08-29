"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Star, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Resource } from "@/lib/db/schema";
import { publicUrl } from "@/lib/s3-public";

const categoryLabel: Record<string, string> = {
  music: "音乐",
  game: "游戏",
  cg: "CG",
  doujinshi: "同人志",
  mmd: "MMD",
  video: "视频",
  wallpaper: "壁纸",
  tool: "工具",
  other: "其他",
};

export function ResourceCard({ r, index = 0 }: { r: Resource; index?: number }) {
  const avg = r.ratingCount ? (r.ratingSum / r.ratingCount).toFixed(1) : "—";
  const cover = r.coverKey ? publicUrl(r.coverKey) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }}
      whileHover={{ y: -4 }}
      className="group"
    >
      <Link
        href={`/resources/${r.slug}`}
        className="block overflow-hidden rounded-2xl border bg-card/80 backdrop-blur transition hover:border-primary/40 hover:shadow-lg"
      >
        <div className="aspect-[4/3] overflow-hidden bg-gradient-to-br from-accent/40 to-muted relative">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={r.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              无封面
            </div>
          )}
          <Badge variant="secondary" className="absolute left-2 top-2 backdrop-blur">
            {categoryLabel[r.category] ?? r.category}
          </Badge>
        </div>
        <div className="p-4">
          <h3 className="line-clamp-1 font-medium">{r.title}</h3>
          <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            {r.circle || r.author || "匿名"}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5 text-amber-500" />
              {avg}
            </span>
            <span className="inline-flex items-center gap-1">
              <Download className="size-3.5" />
              {r.downloads}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
