// Pure scheduling logic (no DOM): unit limits, partial-quarter detection,
// meeting grouping and date-aware conflict detection.

import { WEEKDAYS, meetingDates, toMinutes, fmtDate, fmtTimeRange } from './time.js';

export function noClassSet(data) {
  return new Set((data.meta.calendar.noClassDates || []).map((d) => d.date));
}

/* ---------------- units ---------------- */

export function unitStatus(picks, rules) {
  const elective = picks.reduce((sum, c) => sum + c.units, 0);
  const total = rules.requiredUnits + elective;
  const electiveOver = Math.max(0, elective - rules.electiveUnitsMax);
  const totalOver = Math.max(0, total - rules.totalUnitsMax);
  let message = '';
  if (electiveOver && totalOver) {
    message = `Over the limit: ${elective} elective units (max ${rules.electiveUnitsMax}) puts you at ${total} total units (max ${rules.totalUnitsMax}). Drop ${Math.max(electiveOver, totalOver)} ${Math.max(electiveOver, totalOver) === 1 ? 'unit' : 'units'}.`;
  } else if (electiveOver) {
    message = `Over the ${rules.electiveUnitsMax}-unit elective limit by ${electiveOver}.`;
  } else if (totalOver) {
    message = `Over the ${rules.totalUnitsMax}-unit total limit by ${totalOver}.`;
  }
  return { elective, total, electiveOver, totalOver, over: electiveOver > 0 || totalOver > 0, message };
}

/* ---------------- meeting groups ---------------- */

/**
 * A course's meetings collapsed into slots: one slot per (day, start, end),
 * carrying every real class date for that slot. Business Leadership's six
 * single-date Thursday meetings become one Thursday slot with 6 dates.
 */
export function courseSlots(course, data) {
  const nc = noClassSet(data);
  const cal = data.meta.calendar;
  const map = new Map();
  for (const m of course.meetings) {
    const key = `${m.day}|${m.start}|${m.end}`;
    if (!map.has(key)) map.set(key, { day: m.day, start: m.start, end: m.end, meetings: [], dates: [] });
    const slot = map.get(key);
    slot.meetings.push(m);
    slot.dates.push(...meetingDates(m, nc));
  }
  const slots = [...map.values()];
  for (const s of slots) {
    s.dates = [...new Set(s.dates)].sort();
    s.meetings.sort((a, b) => a.startDate.localeCompare(b.startDate));
    s.partial = s.meetings.length > 1 || s.meetings.some((m) => m.startDate > cal.firstDay || m.endDate < cal.lastDay);
    s.dateLabel = s.partial ? slotDateLabel(s) : '';
  }
  slots.sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || a.start.localeCompare(b.start));
  return slots;
}

function slotDateLabel(slot) {
  if (!slot.dates.length) return 'no class dates';
  if (slot.meetings.length === 1) {
    const first = slot.dates[0];
    const last = slot.dates[slot.dates.length - 1];
    return first === last ? fmtDate(first) : `${fmtDate(first)}–${fmtDate(last)}`;
  }
  return `${slot.dates.length} dates`;
}

export function isPartialCourse(course, data) {
  return courseSlots(course, data).some((s) => s.partial);
}

/**
 * Human summary of when a course meets, e.g.
 * "Tue, Thu 11:10 AM–12:40 PM" or "Thu 4:15–7:15 PM (Jan 7–Feb 11)".
 * Slots with the same time and dates are joined across days.
 */
export function meetingSummary(course, data) {
  const slots = courseSlots(course, data);
  const groups = [];
  for (const s of slots) {
    const key = `${s.start}|${s.end}|${s.partial ? s.dates.map((d) => d.slice(5)).join(',') : 'weekly'}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.days.push(s.day);
    else groups.push({ key, days: [s.day], slot: s });
  }
  return groups.map((g) => ({
    text: `${g.days.join(', ')} ${fmtTimeRange(g.slot.start, g.slot.end)}`,
    partial: g.slot.partial,
    dateLabel: g.slot.dateLabel,
  }));
}

/* ---------------- conflicts ---------------- */

/**
 * Date-aware overlap between two courses. Two slots conflict only when they
 * share a real class date and their times overlap (back-to-back is fine).
 * Returns [] if no conflict, else [{day, start, end, dates, every}].
 */
export function conflictsBetween(a, b, data) {
  const out = [];
  const sa = courseSlots(a, data);
  const sb = courseSlots(b, data);
  for (const x of sa) {
    for (const y of sb) {
      if (x.day !== y.day) continue;
      const start = Math.max(toMinutes(x.start), toMinutes(y.start));
      const end = Math.min(toMinutes(x.end), toMinutes(y.end));
      if (start >= end) continue;
      const ySet = new Set(y.dates);
      const dates = x.dates.filter((d) => ySet.has(d));
      if (!dates.length) continue;
      out.push({
        day: x.day,
        start: x.start > y.start ? x.start : y.start,
        end: x.end < y.end ? x.end : y.end,
        dates,
        every: !x.partial && !y.partial,
      });
    }
  }
  return out;
}

/** All conflicting pairs among a list of courses (required + picks). */
export function findConflicts(courses, data) {
  const pairs = [];
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const overlaps = conflictsBetween(courses[i], courses[j], data);
      if (overlaps.length) pairs.push({ a: courses[i], b: courses[j], overlaps });
    }
  }
  return pairs;
}

export function describeOverlap(o) {
  const when = `${o.day} ${fmtTimeRange(o.start, o.end)}`;
  if (o.every) return `${when}, every week`;
  const weekly = o.dates.every((d, i) => i === 0 || (Date.parse(d) - Date.parse(o.dates[i - 1])) === 7 * 86400000);
  if (o.dates.length > 6 && weekly) {
    return `${when}, weekly ${fmtDate(o.dates[0])}–${fmtDate(o.dates[o.dates.length - 1])} (${o.dates.length} classes)`;
  }
  return `${when} on ${o.dates.map(fmtDate).join(', ')}`;
}
