// Browser tests: loads the real page in an iframe and checks what a user sees.
// Serve the project root (python3 -m http.server) and open /tests/.

import { runLogic } from './logic.mjs';

const out = document.getElementById('out');
const results = [];
const log = (ok, msg) => {
  results.push({ ok, msg });
  const li = document.createElement('li');
  li.textContent = `${ok ? 'PASS' : 'FAIL'}  ${msg}`;
  li.className = ok ? 'pass' : 'fail';
  out.append(li);
};
const eq = (a, b, msg) => log(a === b, a === b ? msg : `${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Independent formatters (not imported from the site).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt12 = (t) => { const [H, M] = t.split(':').map(Number); return `${H % 12 || 12}:${String(M).padStart(2, '0')}`; };
const fmtDT = (s) => {
  const [d, t] = s.split('T'); const [, m, day] = d.split('-').map(Number); const [H] = t.split(':').map(Number);
  return `${MON[m - 1]} ${day}, ${fmt12(t)} ${H >= 12 ? 'PM' : 'AM'}`;
};

const KEY = 'sls1l-winter2027-picks-v1';
const frame = document.getElementById('frame');

async function load(w, hgt, query = '') {
  frame.style.width = `${w}px`;
  frame.style.height = `${hgt}px`;
  frame.src = `../index.html?${query}${query ? '&' : ''}t=${Date.now()}`;
  await new Promise((r) => { frame.onload = r; });
  for (let i = 0; i < 100 && !frame.contentDocument?.body?.dataset.ready; i++) await sleep(50);
  return frame.contentDocument;
}

async function main() {
  const data = await (await fetch('../courses.json', { cache: 'no-store' })).json();
  const E = data.electives;

  /* ---------- logic (same suite as the jsc run) ---------- */
  const logic = runLogic(data);
  log(logic.failures.length === 0, `logic: ${logic.combos.toLocaleString()} unit combinations + helpers${logic.failures.length ? ' — ' + logic.failures.slice(0, 3).join(' | ') : ''}`);
  eq(logic.conflicts.length, 135, 'logic: conflicting pairs across all 48 courses (oracle: 135)');

  localStorage.removeItem(KEY);
  let doc = await load(1440, 900);
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => [...r.querySelectorAll(s)];
  const txt = (el) => (el ? el.textContent : null);
  const toggle = (id) => $(`.row[data-id="${CSS.escape(id)}"] .add`).click();
  const clearPicks = () => $$('.add[aria-pressed="true"]').forEach((b) => b.click());
  const strays = () => /\b(null|undefined|NaN)\b/.test(doc.body.innerText);
  const stat = () => txt($('.stat-elective')) + ($('.stat-total') ? ' | total shown' : '');
  const S = (e) => `${e} / 5 elective units`;

  eq(doc.body.dataset.ready, '1', 'page loaded');
  eq(txt($('#title')), data.meta.title, 'title');
  log(!strays(), 'no "null"/"undefined" text');

  /* ---------- footer ---------- */
  const TDn = data.meta.typeDefinitions.note;
  eq(txt($('#footer p')), data.meta.disclaimer.replace(TDn, '').replace(/\s{2,}/g, ' ').trim(), 'unofficial-site notice in footer (disclaimer minus the type caveat)');
  log(!txt($('#footer p')).includes('doctrinal or seminar'), 'type caveat not repeated in the site notice');
  log($('#disclaimer .contact a')?.getAttribute('href') === 'mailto:eesha@stanford.edu', 'contact notice in the banner');
  log(!$('.foot-meta') && !txt($('#footer')).includes('Data as of'), 'no separate data-as-of line');
  const src = $$('#footer .foot-links a');
  log(src.length === data.meta.sources.length && src.every((a, i) => a.textContent === data.meta.sources[i].label && a.href === data.meta.sources[i].url), 'footer source labels + URLs');

  /* ---------- deadline spotlight: exactly one, the next upcoming ---------- */
  eq(txt($('#spotlight .spot-label')), data.meta.deadlines[0].label, 'spotlight = Nov 16 deadline label');
  eq(txt($('#spotlight .spot-date')), `${fmtDT(data.meta.deadlines[0].date)} PT`, 'spotlight date/time');
  eq($$('#spotlight time').length, 1, 'only one deadline spotlighted');

  /* ---------- course list ---------- */
  const rows = () => $$('#course-list .row');
  eq(rows().length, E.length, 'all 45 electives in the list');
  log(E.every((c) => { const r = $(`.row[data-id="${CSS.escape(c.id)}"]`); return r && r.querySelector('.row-name').textContent === c.shortTitle && r.querySelector('.row-name').title === c.title; }), 'list names = shortTitle (full title on hover)');
  const listTitles = rows().map((r) => r.querySelector('.row-name').title);
  log(listTitles.every((t, i) => i === 0 || listTitles[i - 1].localeCompare(t, 'en', { sensitivity: 'base', numeric: true }) <= 0), 'list sorted A–Z');

  /* keyword search (expectations computed independently) */
  const q = $('#q');
  const search = (s) => { q.value = s; q.dispatchEvent(new Event('input')); return rows().map((r) => r.dataset.id).sort(); };
  const fieldsHave = (c, w) => [c.title, c.shortTitle, ...c.professors, c.type, c.grading, c.assessment, c.enrollment.method].join(' ').toLowerCase().includes(w);
  const ids = (f) => E.filter(f).map((c) => c.id).sort();
  const cases = [
    ['seminar', ids((c) => fieldsHave(c, 'seminar'))],
    ['paper', ids((c) => fieldsHave(c, 'paper'))],
    ['lottery', ids((c) => fieldsHave(c, 'lottery'))],
    ['3 units', ids((c) => c.units === 3)],
    ['1 unit', ids((c) => c.units === 1)],
    ['zambrano', ids((c) => fieldsHave(c, 'zambrano'))],
    ['thu paper', ids((c) => c.meetings.some((m) => m.day === 'Thu') && fieldsHave(c, 'paper'))],
    ['doctrinal 3u exam', ids((c) => c.type === 'Doctrinal' && c.units === 3 && fieldsHave(c, 'exam'))],
    ['pass/fail', ids((c) => fieldsHave(c, 'pass/fail'))],
  ];
  for (const [s, exp] of cases) {
    const got = search(s);
    log(JSON.stringify(got) === JSON.stringify(exp) && exp.length > 0, `search "${s}" → ${got.length} (expected ${exp.length})`);
  }
  search('');

  /* ---------- picks, calendar, table ---------- */
  eq(stat(), S(0), 'status starts at 0/5, 9/14');
  eq(txt($('.units')), '0 / 5 units', 'unit count beside the course list');
  log(!$('.sel-empty').hidden && $('table.sel').hidden, 'empty state before picks');
  eq($$('.blk.req').length, data.required.reduce((n, c) => n + c.meetings.length, 0), 'required courses on calendar');
  const calH = $('.cal-panel').getBoundingClientRect().height;
  const finH = $('.finder-panel').getBoundingClientRect().height;
  log(Math.abs(calH - finH) < 2, `course list is exactly as tall as the calendar (${Math.round(calH)} / ${Math.round(finH)}px)`);

  toggle('fintech-innovation-and-law');
  toggle('business-leadership-for-lawyers-in-the-age-of-ai');
  eq(stat(), S(4), 'Fintech + Business Leadership counts');
  log($$('.warn').length === 1 && txt($('.warn')).includes('Jan 21, Jan 28, Feb 4'), 'conflict names exactly the 3 shared dates');
  eq($$('.blk.conflict').length, 2, 'both conflicting blocks outlined');
  eq($$('.blk.partial').length, 2, 'partial-quarter blocks distinguished');
  log(!$('.row[data-id="evidence"] .clash').hidden, 'list tags Evidence as a clash');
  log($('.row[data-id="corruption"] .clash').hidden, 'no clash tag for Corruption (Mon)');
  eq(rows().slice(0, 2).map((r) => r.dataset.id).sort().join(), ['business-leadership-for-lawyers-in-the-age-of-ai', 'fintech-innovation-and-law'].join(), 'picks pinned to top of list');

  // hover preview
  $('.row[data-id="evidence"]').dispatchEvent(new MouseEvent('mouseenter'));
  await sleep(30);
  eq($$('.blk.ghost').length, 2, 'hover shows Evidence preview (2 meetings)');
  log($$('.blk.ghost.conflict').length === 1, 'preview marks the Thursday clash');
  $('.row[data-id="evidence"]').dispatchEvent(new MouseEvent('mouseleave'));
  await sleep(150);
  eq($$('.blk.ghost').length, 0, 'preview clears on leave');

  toggle('advanced-civil-procedure');
  eq(stat(), S(7), 'over-limit counts');
  log($('#picked').classList.contains('is-over') && $$('.warn')[0].textContent.includes('Over the limit') && $('.stat-elective').classList.contains('over') && $('.units').classList.contains('over'), 'over-limit warning shown');
  log(!strays(), 'no "null" text with picks + conflicts');

  // persistence
  doc = await load(1440, 900);
  eq($$('.add[aria-pressed="true"]').length, 3, 'picks persist after reload');
  eq($$('table.sel tbody tr').length, 3, 'table shows only picked courses');

  // remove via table ×
  $('table.sel tbody tr .x').click();
  eq($$('table.sel tbody tr').length, 2, 'remove from table');
  clearPicks();
  eq($$('table.sel tbody tr').length, 0, 'clear all');

  /* ---------- 1280px: nothing overflows sideways ---------- */
  doc = await load(1280, 800);
  log(doc.documentElement.scrollWidth <= 1280, `1280px: no horizontal scroll (${doc.documentElement.scrollWidth})`);

  /* ---------- every elective's table values = courses.json ---------- */
  const bad = [];
  for (const c of E) {
    toggle(c.id);
    const r = $(`table.sel tr[data-id="${CSS.escape(c.id)}"]`);
    const chk = (cond, what) => { if (!cond) bad.push(`${c.id}: ${what}`); };
    if (!r) { bad.push(`${c.id}: no table row`); continue; }
    const link = $('a.course-link', r);
    chk(link?.textContent === c.title, 'title');
    chk(link?.href === c.url, 'url');
    chk(txt($('.c-prof', r)) === c.professors.join(', '), 'professors');
    chk(txt($('.c-units .num', r)) === String(c.units), 'units');
    chk(txt($('.c-type .val', r)) === c.type, 'type');
    if (c.typeNote) chk(txt($('.c-type .disc-body p', r)) === c.typeNote, 'typeNote');
    else chk(!$('.c-type .disc', r), 'unexpected typeNote');
    chk(txt($('.c-grading .val', r)) === c.grading, 'grading');
    chk(txt($('.c-assess .val', r)) === c.assessment, 'assessment');
    chk(txt($('.c-assess .disc-body p', r)) === c.assessmentDetail, 'assessmentDetail');
    const e = c.enrollment;
    chk(txt($('.method', r)) === e.method, 'method');
    chk(e.seats === null ? !$('.seats', r) : txt($('.seats', r)) === ` · ${e.seats} seats`, 'seats');
    const expDate = e.deadline ? `Due ${fmtDT(e.deadline)}` : null;
    chk(expDate === null ? !$('.enroll-date', r) : txt($('.enroll-date', r)) === expDate, `deadline/opens ${txt($('.enroll-date', r))}`);
    chk(txt($('.how', r)) === e.howToApply, 'howToApply');
    chk($('a.apply', r)?.href === e.applyUrl, 'applyUrl');
    chk(JSON.stringify($$('.flag-list li', r).map((li) => li.textContent)) === JSON.stringify(c.flags), 'flags');
    const when = txt($('.c-when', r));
    for (const m of c.meetings) chk(when.includes(m.day) && when.includes(fmt12(m.start)) && when.includes(fmt12(m.end)), `meeting ${m.day} ${m.start}`);
    chk(!r.textContent.includes(c.courseNumber), 'courseNumber should not be shown');
  }
  eq($$('table.sel tbody tr').length, E.length, 'all 45 can be added to the table');
  log(bad.length === 0, `all ${E.length} electives' table values match courses.json exactly${bad.length ? ': ' + bad.slice(0, 6).join('; ') : ''}`);
  const TD = data.meta.typeDefinitions;
  log(!$('.type-note') && $('th .star').getAttribute('href') === '#disclaimer' && $('#footer #disclaimer'), 'Type* links to the footer disclaimer (no second copy under the table)');
  eq(txt($('#disclaimer .type-defs')), `* ${TD.note} Doctrinal: ${TD.Doctrinal} Seminar: ${TD.Seminar}`, 'Doctrinal/Seminar caveat + definitions in the footer banner');
  clearPicks();

  /* ---------- spotlight rolls forward / disappears ---------- */
  doc = await load(1440, 900, 'now=2026-11-17T00:00');
  eq(txt($('#spotlight .spot-label')), data.meta.deadlines[1].label, 'after Nov 16 the spotlight rolls to Nov 30');
  doc = await load(1440, 900, 'now=2027-02-01T00:00');
  log($('#spotlight').hidden, 'no spotlight once every deadline has passed');

  /* ---------- phone ---------- */
  doc = await load(390, 844);
  log(doc.documentElement.scrollWidth <= 390, `390px: no horizontal scroll (${doc.documentElement.scrollWidth})`);
  const calBottom = doc.querySelector('.cal-panel').getBoundingClientRect().bottom;
  log(calBottom <= 844, `390×844: whole calendar on the first screen (ends at ${Math.round(calBottom)}px)`);
  log(!strays(), '390px: no "null" text');

  const failed = results.filter((r) => !r.ok).length;
  document.title = failed ? `FAIL ${failed}` : 'ALL PASS';
  document.getElementById('summary').textContent = failed ? `${failed} of ${results.length} checks failed` : `All ${results.length} checks passed`;
  document.body.dataset.done = failed ? 'fail' : 'pass';
}

main().catch((e) => { log(false, `test crashed: ${e.stack || e}`); document.title = 'CRASH'; document.body.dataset.done = 'fail'; });
