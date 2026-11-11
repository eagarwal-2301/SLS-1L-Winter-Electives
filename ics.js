// .ics (RFC 5545) export. One VEVENT per meeting in courses.json:
//  - weekly meetings -> RRULE:FREQ=WEEKLY with UNTIL at the end of endDate
//  - no-class dates that would have been a class -> EXDATE
//  - a meeting with a single real date -> a plain one-off event
// All local times carry TZID=America/Los_Angeles with an embedded VTIMEZONE.

import { meetingDates, meetingPatternDates, zonedToEpoch, epochToIcsUTC } from './time.js';
import { noClassSet } from './rules.js';

const VTIMEZONE_LA = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'X-LIC-LOCATION:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const BYDAY = { Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR' };

export function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const utf8Len = (ch) => {
  const c = ch.codePointAt(0);
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
};

/** Fold a content line to <= 75 octets per physical line, never splitting a UTF-8 character. */
export function foldLine(line) {
  const out = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = utf8Len(ch);
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const local = (ymd, hhmm) => `${ymd.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;

function slug(s) {
  return s.replace(/[^A-Za-z0-9]/g, '');
}

export function buildIcs(courses, data, now = Date.now()) {
  const tz = data.meta.timezone;
  const nc = noClassSet(data);
  const stamp = epochToIcsUTC(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SLS 1L Electives (unofficial)//Winter 2027//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(data.meta.term)}`,
    `X-WR-TIMEZONE:${tz}`,
    ...VTIMEZONE_LA,
  ];

  for (const course of courses) {
    const desc = [];
    if (course.professors && course.professors.length) desc.push(course.professors.join(', '));
    if (course.url) desc.push(course.url);

    for (const m of course.meetings) {
      const dates = meetingDates(m, nc);
      if (!dates.length) continue;
      const first = dates[0];
      const uid = `${course.id}-${m.day}${slug(m.start)}-${slug(m.startDate)}-${slug(m.endDate)}@sls-1l-electives`;
      const ev = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${tz}:${local(first, m.start)}`,
        `DTEND;TZID=${tz}:${local(first, m.end)}`,
      ];
      if (dates.length > 1) {
        // UNTIL is inclusive and must be UTC when DTSTART has a TZID.
        const until = epochToIcsUTC(zonedToEpoch(`${m.endDate}T23:59:59`, tz));
        ev.push(`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[m.day]};UNTIL=${until}`);
        const real = new Set(dates);
        const skipped = meetingPatternDates(m).filter((d) => d > first && !real.has(d));
        for (const d of skipped) ev.push(`EXDATE;TZID=${tz}:${local(d, m.start)}`);
      }
      ev.push(`SUMMARY:${escapeText(course.title)}`);
      if (desc.length) ev.push(`DESCRIPTION:${escapeText(desc.join('\n'))}`);
      if (course.url) ev.push(`URL:${course.url}`);
      ev.push('TRANSP:OPAQUE', 'END:VEVENT');
      lines.push(...ev);
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
