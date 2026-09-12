import { useEffect, useRef, useState } from 'react';
import { driveImageUrl, driveImgOnError } from '../driveUrl.js';


const DEFAULT_DURATION_MS = 5000;
function clampDurationMs(ms) {
  const n = parseInt(ms, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MS;
  if (n < 1000) return 1000;
  if (n > 60000) return 60000;
  return n;
}

function norm(s) {
  return {
    imageUrl: s.image_url || s.imageUrl || '',
    text: s.text || '',
    linkUrl: s.link_url || s.linkUrl || '',
    linkText: s.link_text || s.linkText || '',
    durationMs: clampDurationMs(s.duration_ms != null ? s.duration_ms : s.durationMs),
  };
}

function isHttpUrl(u) {
  try {
    const parsed = new URL(u, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function PopupSlideshow({ slides }) {
  const list = (slides || []).map(norm);
  const [index, setIndex] = useState(0);
  const pausedRef = useRef(false);
  const timerRef = useRef(null);

  const count = list.length;
  const safeIndex = count ? Math.min(index, count - 1) : 0;

  useEffect(() => {
    if (count <= 1) return undefined;
    if (pausedRef.current) return undefined;
    const ms = list[safeIndex] ? list[safeIndex].durationMs : DEFAULT_DURATION_MS;
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1) % count);
    }, ms);
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  }, [safeIndex, count]);

  if (!count) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No slides to preview.</div>;
  }

  const slide = list[safeIndex];

  const pause = () => {
    pausedRef.current = true;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };
  const resume = () => {
    pausedRef.current = false;
    setIndex((i) => i);
  };
  const prev = () => { pause(); setIndex((i) => (i - 1 + count) % count); pausedRef.current = false; };
  const next = () => { pause(); setIndex((i) => (i + 1) % count); pausedRef.current = false; };

  return (
    <div
      onMouseEnter={pause}
      onMouseLeave={resume}
      style={{
        background: '#fff', borderRadius: 14, maxWidth: 420, width: '100%',
        margin: '0 auto', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
      }}
    >
      {slide.imageUrl && isHttpUrl(driveImageUrl(slide.imageUrl)) && (
        <img
          src={driveImageUrl(slide.imageUrl)}
          alt=""
          style={{ width: '100%', height: 'auto', display: 'block', background: '#f3f4f6' }}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.dataset.driveFallbackTried !== '1') {
              driveImgOnError(slide.imageUrl)(e);
              if (img.dataset.driveFallbackTried === '1') return;
            }
            img.style.display = 'none';
          }}
        />
      )}
      {slide.text && (
        <div style={{ padding: 16, fontSize: '0.9rem', color: '#333', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {slide.text}
        </div>
      )}
      {slide.linkUrl && isHttpUrl(slide.linkUrl) && (
        <a
          href={slide.linkUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block', margin: '0 16px 16px', padding: '8px 16px', borderRadius: 8,
            background: 'var(--primary-saffron)', color: '#fff', textDecoration: 'none',
            fontWeight: 600, fontSize: '0.85rem', overflowWrap: 'anywhere',
          }}
        >
          {slide.linkText || 'Learn more'}
        </a>
      )}
      {count > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 0 12px' }}>
          <button
            type="button" onClick={prev} aria-label="Previous"
            style={{ background: 'none', border: '1px solid #ddd', borderRadius: '50%', width: 32, height: 32, fontSize: '1.1rem', cursor: 'pointer', color: 'var(--primary-saffron)' }}
          >&#8249;</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{safeIndex + 1} / {count}</span>
          <button
            type="button" onClick={next} aria-label="Next"
            style={{ background: 'none', border: '1px solid #ddd', borderRadius: '50%', width: 32, height: 32, fontSize: '1.1rem', cursor: 'pointer', color: 'var(--primary-saffron)' }}
          >&#8250;</button>
        </div>
      )}
    </div>
  );
}
