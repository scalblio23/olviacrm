/**
 * Smart date parser that handles multiple common date formats.
 * Returns a Date object or null if the value cannot be parsed.
 *
 * Supported formats (in priority order):
 *   DD/MM/YYYY  (Australian / UK)
 *   D/M/YYYY
 *   DD-MM-YYYY
 *   D-M-YYYY
 *   YYYY-MM-DD  (ISO 8601 date)
 *   YYYY/MM/DD
 *   M/D/YYYY    (US)
 *   ISO 8601 datetime (native JS)
 *   Natural language ("September 12, 2025")
 */
export function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // DD/MM/YYYY or D/M/YYYY  (two or four digit year)
  const dmySlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmySlash) {
    const [, d, m, y] = dmySlash;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(year, Number(m) - 1, Number(d));
    if (!isNaN(dt.getTime())) return dt;
  }

  // DD-MM-YYYY or D-M-YYYY
  const dmyDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dmyDash) {
    const [, d, m, y] = dmyDash;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(year, Number(m) - 1, Number(d));
    if (!isNaN(dt.getTime())) return dt;
  }

  // YYYY-MM-DD (ISO date only, no time)
  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const [, y, m, d] = isoDate;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(dt.getTime())) return dt;
  }

  // YYYY/MM/DD
  const ymdSlash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) {
    const [, y, m, d] = ymdSlash;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(dt.getTime())) return dt;
  }

  // Full ISO 8601 datetime (native JS handles these correctly)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt;
  }

  // Natural language / US format — fall back to native Date.parse
  // but only accept if the result is a plausible year (1900-2100)
  const native = new Date(s);
  if (!isNaN(native.getTime())) {
    const year = native.getFullYear();
    if (year >= 1900 && year <= 2100) return native;
  }

  return null;
}
