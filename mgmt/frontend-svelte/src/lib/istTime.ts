// Every time the portal SHOWS or PRINTS is Indian Standard Time (Asia/Kolkata),
// whatever timezone the viewing device happens to be set to.
//
// Timestamps are still STORED as UTC ISO strings (`new Date().toISOString()`); only
// display/print goes through here. IST has no daylight saving, so the fixed +05:30
// offset used for datetime-local inputs is always correct.

export const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

// Date | epoch ms | ISO string -> Date (or null). A string without a zone is read
// as UTC, because that is what the backend writes.
export function parseStamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const raw = value.toString().trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T') + 'Z');
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// Date + time in IST, same en-IN look as before, e.g. "12/10/2026, 9:30:15 am".
// An unparseable value is returned unchanged rather than hidden.
export function formatIST(value: unknown = new Date()): string {
  const d = parseStamp(value);
  if (!d) return value ? String(value) : '';
  return d.toLocaleString('en-IN', { timeZone: IST_TIME_ZONE });
}

// Date only in IST, e.g. "12/10/2026".
export function formatISTDate(value: unknown = new Date()): string {
  const d = parseStamp(value);
  if (!d) return value ? String(value) : '';
  return d.toLocaleDateString('en-IN', { timeZone: IST_TIME_ZONE });
}

function istParts(d: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d)) parts[p.type] = p.value;
  return parts;
}

// Today's date in IST as YYYY-MM-DD. `toISOString().slice(0, 10)` is the UTC date,
// which is still YESTERDAY in India until 05:30 IST.
export function todayIST(now: Date = new Date()): string {
  const p = istParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

// ISO/Date -> "YYYY-MM-DDTHH:mm" in IST, for <input type="datetime-local">.
export function toISTInputValue(value: unknown): string {
  const d = parseStamp(value);
  if (!d) return '';
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "YYYY-MM-DDTHH:mm[:ss]" typed as IST -> UTC ISO string ('' if invalid).
export function fromISTInputValue(local: unknown): string {
  if (!local) return '';
  const s = local.toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return '';
  const d = new Date(s + IST_OFFSET);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// The current calendar year in India.
export function currentYearIST(now: Date = new Date()): number {
  return parseInt(istParts(now).year, 10);
}

// "YYYYMMDD-HHMMSS" in IST, for file names.
export function istFileStamp(now: Date = new Date()): string {
  const p = istParts(now);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}
