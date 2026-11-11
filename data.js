// Loads courses.json and runs light checks so a typo made while correcting a
// course shows up as a clear message instead of a silently broken page.

const DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function loadData(url = 'courses.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`${url} is not valid JSON: ${e.message}`);
  }
  return data;
}

/** Returns { fatal: string|null, problems: string[] } */
export function validate(data) {
  const problems = [];
  if (!data || typeof data !== 'object') return { fatal: 'courses.json is empty.', problems };
  const meta = data.meta;
  if (!meta) return { fatal: 'courses.json has no "meta" section.', problems };
  if (!Array.isArray(data.electives)) return { fatal: 'courses.json has no "electives" list.', problems };
  if (!Array.isArray(data.required)) return { fatal: 'courses.json has no "required" list.', problems };
  if (!meta.calendar || !DATE.test(meta.calendar.firstDay || '') || !DATE.test(meta.calendar.lastDay || '')) {
    return { fatal: 'meta.calendar.firstDay / lastDay are missing or not YYYY-MM-DD.', problems };
  }
  if (!meta.rules) return { fatal: 'meta.rules is missing.', problems };
  for (const k of ['requiredUnits', 'electiveUnitsMax', 'totalUnitsMax']) {
    if (typeof meta.rules[k] !== 'number') problems.push(`meta.rules.${k} should be a number.`);
  }
  if (meta.timezone !== 'America/Los_Angeles') {
    problems.push(`meta.timezone is "${meta.timezone}"; the calendar export assumes America/Los_Angeles.`);
  }
  for (const d of meta.deadlines || []) {
    if (!DATETIME.test(d.date || '')) problems.push(`Deadline "${d.label}": date should look like 2026-11-16T23:59.`);
  }
  for (const d of meta.calendar.noClassDates || []) {
    if (!DATE.test(d.date || '')) problems.push(`noClassDates entry "${d.reason}": date should be YYYY-MM-DD.`);
  }

  const requiredSum = data.required.reduce((s, c) => s + (Number(c.units) || 0), 0);
  if (typeof meta.rules.requiredUnits === 'number' && requiredSum !== meta.rules.requiredUnits) {
    problems.push(`Required courses add up to ${requiredSum} units but meta.rules.requiredUnits is ${meta.rules.requiredUnits}.`);
  }

  const ids = new Set();
  const check = (c, where) => {
    const name = c.title || c.id || where;
    if (!c.id) problems.push(`${where}: missing "id".`);
    else if (ids.has(c.id)) problems.push(`Duplicate id "${c.id}".`);
    ids.add(c.id);
    if (typeof c.units !== 'number') problems.push(`${name}: "units" should be a number.`);
    if (!Array.isArray(c.meetings) || !c.meetings.length) problems.push(`${name}: no meetings.`);
    for (const m of c.meetings || []) {
      if (!DAYS.has(m.day)) problems.push(`${name}: meeting day "${m.day}" should be Mon–Fri.`);
      if (!TIME.test(m.start || '') || !TIME.test(m.end || '')) problems.push(`${name}: meeting times should be HH:MM (24-hour).`);
      else if (m.start >= m.end) problems.push(`${name}: a meeting ends before it starts.`);
      if (!DATE.test(m.startDate || '') || !DATE.test(m.endDate || '')) problems.push(`${name}: meeting dates should be YYYY-MM-DD.`);
      else if (m.startDate > m.endDate) problems.push(`${name}: a meeting's endDate is before its startDate.`);
    }
  };
  data.required.forEach((c, i) => check(c, `required[${i}]`));
  data.electives.forEach((c, i) => {
    check(c, `electives[${i}]`);
    const name = c.title || c.id || `electives[${i}]`;
    for (const k of ['title', 'url', 'type', 'grading', 'assessment']) {
      if (typeof c[k] !== 'string' || !c[k]) problems.push(`${name}: missing "${k}".`);
    }
    if (!Array.isArray(c.professors)) problems.push(`${name}: "professors" should be a list.`);
    if (!Array.isArray(c.flags)) problems.push(`${name}: "flags" should be a list (use [] for none).`);
    if (!c.enrollment || typeof c.enrollment.method !== 'string') problems.push(`${name}: missing enrollment.method.`);
  });
  return { fatal: null, problems };
}
