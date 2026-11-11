// Date/time helpers. All course times in courses.json are Pacific wall-clock
// times ("HH:MM", "YYYY-MM-DD", "YYYY-MM-DDTHH:MM"). We never convert them for
// display; we only convert to real instants when comparing with "now" or
// writing UTC values into the .ics file.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_MS = 86400000;

/** "YYYY-MM-DD" -> ms at 00:00 UTC (used only for calendar arithmetic). */
export function ymdToUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** ms at 00:00 UTC -> "YYYY-MM-DD" */
export function utcToYmd(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function weekdayOf(ymd) {
  return new Date(ymdToUTC(ymd)).getUTCDay();
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Every real class date for one meeting: each date from startDate to endDate
 * (inclusive) that falls on meeting.day, minus the no-class dates.
 */
export function meetingDates(meeting, noClassSet) {
  const target = DAY_INDEX[meeting.day];
  const out = [];
  const end = ymdToUTC(meeting.endDate);
  let t = ymdToUTC(meeting.startDate);
  while (new Date(t).getUTCDay() !== target) t += DAY_MS;
  for (; t <= end; t += 7 * DAY_MS) {
    const ymd = utcToYmd(t);
    if (!noClassSet.has(ymd)) out.push(ymd);
  }
  return out;
}

/** Same as meetingDates but without removing no-class dates. */
export function meetingPatternDates(meeting) {
  return meetingDates(meeting, new Set());
}

/* ---------- display formatting (no time-zone conversion) ---------- */

export function fmtTime(hhmm, withMeridiem = true) {
  let [h, m] = hhmm.split(':').map(Number);
  const mer = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${withMeridiem ? ' ' + mer : ''}`;
}

/** "11:10 AM–12:40 PM", "4:15–7:15 PM" */
export function fmtTimeRange(start, end) {
  const sm = toMinutes(start) >= 720 ? 'PM' : 'AM';
  const em = toMinutes(end) >= 720 ? 'PM' : 'AM';
  return sm === em
    ? `${fmtTime(start, false)}–${fmtTime(end)}`
    : `${fmtTime(start)}–${fmtTime(end)}`;
}

/** "2027-01-21" -> "Jan 21" */
export function fmtDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2026-11-10" -> "Nov 10, 2026" */
export function fmtDateLong(ymd) {
  const [y] = ymd.split('-');
  return `${fmtDate(ymd)}, ${y}`;
}

/** "2026-11-16T23:59" -> "Nov 16, 11:59 PM" */
export function fmtDateTime(local) {
  const [d, t] = local.split('T');
  return t ? `${fmtDate(d)}, ${fmtTime(t)}` : fmtDate(d);
}

/* ---------- real instants ---------- */

function tzOffsetMinutes(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUTC - utcMs) / 60000);
}

/**
 * Wall-clock time in `tz` ("YYYY-MM-DDTHH:MM[:SS]" or "YYYY-MM-DD") -> epoch ms.
 * Falls back to Pacific Standard Time if the browser lacks time-zone data.
 */
export function zonedToEpoch(local, tz) {
  const [d, t = '00:00'] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s = 0] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi, s);
  try {
    const off1 = tzOffsetMinutes(guess, tz);
    let ts = guess - off1 * 60000;
    const off2 = tzOffsetMinutes(ts, tz);
    if (off2 !== off1) ts = guess - off2 * 60000;
    return ts;
  } catch {
    return guess + 8 * 3600000;
  }
}

/** epoch ms -> "YYYYMMDDTHHMMSSZ" */
export function epochToIcsUTC(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
