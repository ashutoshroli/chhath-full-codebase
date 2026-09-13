// Festival card surface — a warm card with a soft accent-2 (gold) border + a
// tinted shadow. Uses theme tokens (--accent-2 / --accent / --surface-bg) so the
// SAME festival skin renders each theme's own palette (festival = maroon+gold,
// heritage-serif = green+antique-gold).
export const CARD =
  'rounded-2xl border bg-[rgb(var(--surface-bg))] ' +
  'border-[rgb(var(--accent-2)/0.5)] ' +
  'shadow-[0_8px_24px_-14px_rgb(var(--accent)/0.35)]';
