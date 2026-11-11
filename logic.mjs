// Logic tests, runnable without Node using macOS's built-in JavaScriptCore:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/logic.mjs > /tmp/out.json
// (run from the project root). Prints one JSON object; tests/oracle.py checks it.
// In a browser, tests/index.html imports runLogic() from here instead.

import { unitStatus, findConflicts, conflictsBetween } from '../js/rules.js';
import { buildIcs, foldLine, escapeText } from '../js/ics.js';
import { fmtTimeRange, fmtDateTime, zonedToEpoch, meetingDates } from '../js/time.js';

export function runLogic(data) {
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  const rules = data.meta.rules;
  const E = data.electives;

  /* --- units: every combination of up to 5 electives --- */
  let combos = 0;
  const idx = [];
  const rec = (start, sum) => {
    if (idx.length) {
      combos++;
      const picks = idx.map((i) => E[i]);
      const st = unitStatus(picks, rules);
      const expElective = sum;
      const expTotal = rules.requiredUnits + sum;
      const expOver = expElective > rules.electiveUnitsMax || expTotal > rules.totalUnitsMax;
      if (st.elective !== expElective || st.total !== expTotal || st.over !== expOver || (st.message !== '') !== expOver) {
        failures.push(`units: ${idx.map((i) => E[i].id).join('+')} -> ${JSON.stringify(st)}`);
      }
    }
    if (idx.length === 5) return;
    for (let i = start; i < E.length; i++) {
      idx.push(i);
      rec(i + 1, sum + E[i].units);
      idx.pop();
    }
  };
  rec(0, 0);
  const minUnits = Math.min(...E.map((c) => c.units));
  check(minUnits * 6 > rules.electiveUnitsMax, 'six picks could fit under the elective cap; extend the exhaustive test');
  check(!unitStatus([], rules).over, 'empty selection should not be over');

  /* --- formatting spot checks --- */
  check(fmtTimeRange('11:10', '12:40') === '11:10 AM–12:40 PM', 'fmtTimeRange AM/PM');
  check(fmtTimeRange('16:15', '19:15') === '4:15–7:15 PM', 'fmtTimeRange PM/PM');
  check(fmtTimeRange('08:30', '09:40') === '8:30–9:40 AM', 'fmtTimeRange AM/AM');
  check(fmtDateTime('2026-11-16T23:59') === 'Nov 16, 11:59 PM', 'fmtDateTime');
  check(fmtDateTime('2026-12-02T17:30') === 'Dec 2, 5:30 PM', 'fmtDateTime 2');
  check(zonedToEpoch('2026-11-16T23:59', 'America/Los_Angeles') === Date.UTC(2026, 10, 17, 7, 59), 'Pacific -> UTC (PST)');
  check(zonedToEpoch('2027-07-01T12:00', 'America/Los_Angeles') === Date.UTC(2027, 6, 1, 19, 0), 'Pacific -> UTC (PDT)');

  /* --- ics helpers --- */
  check(escapeText('a,b;c\\d\ne') === 'a\\,b\\;c\\\\d\\ne', 'escapeText');
  const long = 'SUMMARY:' + 'Negotiation §01 – '.repeat(10);
  const folded = foldLine(long).split('\r\n');
  const bytes = (s) => unescape(encodeURIComponent(s)).length;
  check(folded.every((l) => bytes(l) <= 75), 'folded lines exceed 75 octets');
  check(folded.slice(1).every((l) => l.startsWith(' ')), 'continuation lines must start with a space');
  check(folded.map((l, i) => (i ? l.slice(1) : l)).join('') === long, 'folding must be lossless');

  /* --- conflicts: all pairs (electives + required) --- */
  const all = [...data.required, ...E];
  const conflicts = findConflicts(all, data).map((p) => ({
    a: p.a.id, b: p.b.id,
    overlaps: p.overlaps.map((o) => ({ day: o.day, start: o.start, end: o.end, dates: o.dates })),
  }));
  for (const p of findConflicts(all, data)) {
    const back = conflictsBetween(p.b, p.a, data);
    check(back.length === p.overlaps.length, `conflict symmetry ${p.a.id}/${p.b.id}`);
  }

  /* --- expanded dates per meeting (for the oracle to compare) --- */
  const nc = new Set((data.meta.calendar.noClassDates || []).map((d) => d.date));
  const dates = {};
  for (const c of all) dates[c.id] = c.meetings.map((m) => ({ day: m.day, start: m.start, end: m.end, dates: meetingDates(m, nc) }));

  const ics = buildIcs(all, data, Date.UTC(2026, 10, 10, 20, 0, 0));
  const icsPicks = buildIcs([...data.required, ...E.filter((c) => c.title.startsWith('Fintech') || c.title.startsWith('Business Leadership'))], data, Date.UTC(2026, 10, 10, 20, 0, 0));

  return { combos, failures, conflicts, dates, ics, icsPicks };
}

// JavaScriptCore shell entry point
if (typeof readFile === 'function' && typeof document === 'undefined') {
  const data = JSON.parse(readFile('courses.json'));
  print(JSON.stringify(runLogic(data)));
}
