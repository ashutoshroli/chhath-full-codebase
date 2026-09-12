
const DEFAULT_WIDTH = 1600;

const ID_PATTERNS = [
  /\/file\/d\/([A-Za-z0-9_-]{10,})/,
  /lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})/,
  /[?&]id=([A-Za-z0-9_-]{10,})/,
  /\/d\/([A-Za-z0-9_-]{10,})/,
];

export function driveFileId(url) {
  const s = (url === undefined || url === null) ? '' : url.toString();
  if (!s) return null;
  for (const re of ID_PATTERNS) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}

export function driveImageUrl(url, width = DEFAULT_WIDTH) {
  const id = driveFileId(url);
  if (!id) return url;
  return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
}

export function driveImageFallbackUrl(url, width = DEFAULT_WIDTH) {
  const id = driveFileId(url);
  if (!id) return null;
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
}

export function driveImgOnError(originalUrl, width = DEFAULT_WIDTH) {
  return (e) => {
    const img = e.currentTarget;
    if (img.dataset.driveFallbackTried === '1') return;
    const fb = driveImageFallbackUrl(originalUrl, width);
    if (!fb || fb === img.src) return;
    img.dataset.driveFallbackTried = '1';
    img.src = fb;
  };
}
