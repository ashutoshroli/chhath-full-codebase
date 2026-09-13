/**
 * Google Drive image helpers — ported from Public/frontend-v3/script.js so popup
 * / document thumbnails resolve identically to the existing portals.
 */

export function driveFileId(url: unknown): string | null {
  const s = url === undefined || url === null ? '' : url.toString();
  if (!s) return null;
  const pats = [
    /\/file\/d\/([A-Za-z0-9_-]{10,})/,
    /lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})/,
    /[?&]id=([A-Za-z0-9_-]{10,})/,
    /\/d\/([A-Za-z0-9_-]{10,})/
  ];
  for (const p of pats) {
    const m = p.exec(s);
    if (m) return m[1];
  }
  return null;
}

export function driveImageUrl(url: unknown): string {
  const id = driveFileId(url);
  return id ? `https://lh3.googleusercontent.com/d/${id}=w1600` : (url ?? '').toString();
}

export function driveImageFallbackUrl(url: unknown): string {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : '';
}
