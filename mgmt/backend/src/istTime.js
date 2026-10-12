// The Worker runs in UTC, so a bare `new Date().toLocaleString('en-IN')` here prints
// UTC — 5h30m behind what anyone in India sees on their clock. Every time the portal
// SHOWS or PRINTS (PDF "Generated at", WhatsApp reports) goes through these helpers
// so it is Indian Standard Time. Stored timestamps stay UTC ISO strings.

export const IST_TIME_ZONE = 'Asia/Kolkata';

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const raw = value.toString().trim();
  // "YYYY-MM-DD HH:mm[:ss]" with no zone is what SQLite's datetime() writes, and it is UTC.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T') + 'Z');
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Date + time in IST, e.g. "12/10/2026, 9:30:15 am". Unparseable input is returned as-is. */
export function formatIST(value = new Date()) {
  const d = toDate(value);
  if (!d) return value ? String(value) : '';
  return d.toLocaleString('en-IN', { timeZone: IST_TIME_ZONE });
}

/** The current calendar year in India (UTC is still on 31 Dec until 05:30 IST on 1 Jan). */
export function currentYearIST(now = new Date()) {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: IST_TIME_ZONE, year: 'numeric' }).format(now), 10);
}
