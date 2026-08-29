export interface LrcLine {
  time: number;
  text: string;
  trans?: string;
}

const TIME_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

function parseOne(src: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of src.split(/\r?\n/)) {
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const m of line.matchAll(TIME_RE)) {
      const min = parseInt(m[1]!, 10);
      const sec = parseFloat(m[2]!);
      const t = min * 60 + sec;
      if (!Number.isFinite(t)) continue;
      map.set(t, text);
    }
  }
  return map;
}

export function parseLrc(lrc: string, tlyric?: string): LrcLine[] {
  const main = parseOne(lrc);
  const trans = tlyric ? parseOne(tlyric) : null;
  return [...main.entries()]
    .map(([time, text]) => ({ time, text, trans: trans?.get(time) }))
    .sort((a, b) => a.time - b.time);
}

export function findCurrentIndex(lines: LrcLine[], progress: number): number {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.time <= progress) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
