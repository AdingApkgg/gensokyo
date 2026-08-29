export function publicUrl(key: string) {
  const base = process.env.NEXT_PUBLIC_B2_BASE_URL ?? process.env.B2_PUBLIC_BASE_URL ?? "";
  if (!base) return `/api/files/${encodeURIComponent(key)}`;
  return `${base}/${key}`;
}
