/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
 * Supports: *, lists (1,2,3), ranges (1-5), steps (* / 5, 10-20/2).
 */
function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    let range = part;
    let step = 1;
    const slash = part.split('/');
    if (slash.length === 2) {
      range = slash[0];
      step = parseInt(slash[1], 10) || 1;
    }
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const dash = range.split('-');
      lo = parseInt(dash[0], 10);
      hi = dash.length === 2 ? parseInt(dash[1], 10) : lo;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v === value) return true;
    }
  }
  return false;
}

/** True if the cron expression fires at the given date (second-granularity ignored). */
export function cronMatches(expr: string, date = new Date()): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, mon, dow] = fields;
  const dowVal = date.getDay(); // 0=Sun..6=Sat
  return (
    matchField(min, date.getMinutes(), 0, 59) &&
    matchField(hour, date.getHours(), 0, 23) &&
    matchField(dom, date.getDate(), 1, 31) &&
    matchField(mon, date.getMonth() + 1, 1, 12) &&
    // cron treats both 0 and 7 as Sunday
    (matchField(dow, dowVal, 0, 6) || (dowVal === 0 && matchField(dow, 7, 0, 7)))
  );
}

/** Validate a 5-field cron expression. */
export function isValidCron(expr: string): boolean {
  return typeof expr === 'string' && expr.trim().split(/\s+/).length === 5;
}
