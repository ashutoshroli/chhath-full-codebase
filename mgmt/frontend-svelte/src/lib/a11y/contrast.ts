// ============ WCAG CONTRAST, COMPUTED (audit PR-39) ============
//
// Colour contrast is one of the few accessibility properties that is arithmetic rather than
// judgement, so it can be checked in CI instead of guessed at. Everything here is WCAG 2.1
// section 1.4.3 / 1.4.11, verbatim:
//
//   relative luminance  L = 0.2126 R + 0.7152 G + 0.0722 B, each channel linearised
//   contrast ratio      (L_lighter + 0.05) / (L_darker + 0.05)
//
// Thresholds: 4.5 for body text, 3.0 for large text (>=18.66px bold or >=24px) and for
// non-text things that carry meaning — borders, focus rings, icons (1.4.11).
//
// This is deliberately dependency-free and framework-free: it is used by a test, and pulling
// a colour library in for twelve lines of arithmetic would be the larger risk.

export interface Rgb { r: number; g: number; b: number; }

/** Parses `#abc`, `#aabbcc`, `rgb(1,2,3)` and `rgb(1 2 3)`. Returns null for anything else. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    }
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  // `rgb(255 255 255)` (the Tailwind token style used by the public app) and `rgb(255,255,255)`.
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };

  // Bare `255 255 255`, which is how the surface tokens are stored so Tailwind can add an alpha.
  const bare = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(s);
  if (bare) return { r: +bare[1], g: +bare[2], b: +bare[3] };

  return null;
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The WCAG contrast ratio between two colours, 1..21. Order does not matter. */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const ca = typeof a === 'string' ? parseColor(a) : a;
  const cb = typeof b === 'string' ? parseColor(b) : b;
  if (!ca || !cb) throw new Error(`unparseable colour: ${JSON.stringify([a, b])}`);
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded down to 2dp, so a value printed as 4.5 is genuinely >= 4.5. */
export const ratio2dp = (n: number) => Math.floor(n * 100) / 100;

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_NON_TEXT = 3;
