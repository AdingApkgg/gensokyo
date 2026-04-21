"use client";

import { useCallback, useEffect, useState } from "react";

type ImageData = {
  id: number;
  md5: string;
  url: string;
  author: string;
  tags: string;
};

const JSON_API = "https://img.paulzzh.com/touhou/random?type=json";

function webpUrl(md5: string) {
  return `https://img.paulzzh.com/touhou/webp/${md5.slice(0, 2)}/${md5}.webp`;
}

export function RandomBackground() {
  const [data, setData] = useState<ImageData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fetching, setFetching] = useState(false);

  const load = useCallback(async () => {
    setFetching(true);
    setLoaded(false);
    try {
      const res = await fetch(`${JSON_API}&_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ImageData);
    } catch {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 -z-10 overflow-hidden bg-zinc-900"
      >
        {data && (
          <img
            key={data.id}
            src={webpUrl(data.md5)}
            alt=""
            onLoad={() => {
              setLoaded(true);
              setFetching(false);
            }}
            onError={() => setFetching(false)}
            className={`h-full w-full object-cover transition-opacity duration-700 ${
              loaded ? "opacity-70" : "opacity-0"
            }`}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/60" />
      </div>

      <div className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/50 px-4 py-2 text-xs text-white/90 shadow-lg backdrop-blur-md">
        {data ? (
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-[50vw] truncate hover:text-white"
            title={`${data.author} — ${data.tags}`}
          >
            {data.author || "unknown"} · #{data.id}
          </a>
        ) : (
          <span className="text-white/60">Loading…</span>
        )}
        <button
          type="button"
          onClick={load}
          disabled={fetching}
          className="shrink-0 whitespace-nowrap rounded-full bg-white/15 px-3 py-1 transition hover:bg-white/25 disabled:cursor-wait disabled:opacity-50"
        >
          {fetching ? "…" : "换一张"}
        </button>
      </div>
    </>
  );
}
