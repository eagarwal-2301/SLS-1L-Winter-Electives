// Searchable course list. Every typed word must match somewhere in the
// course's title, professors, type, grading, assessment, enrollment method,
// meeting days or units ("3 units", "1 unit", "3u").

import { h, fill } from './dom.js';
import { fmtTime } from './time.js';
import { meetingSummary, conflictsBetween } from './rules.js';

const DAY_NAMES = { Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday' };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Turn a query into tokens; "3 units" / "3 unit" / "3u" become one units token. */
export function queryTokens(q) {
  return norm(q)
    .replace(/\b(\d)\s*(units?|u)\b/g, ' ~u$1~ ')
    .split(/\s+/)
    .filter(Boolean);
}

export function haystack(c) {
  const days = [...new Set(c.meetings.map((m) => m.day))];
  return norm([
    c.title, c.shortTitle, ...c.professors, c.type, c.grading, c.assessment, c.enrollment.method,
    ...days, ...days.map((d) => DAY_NAMES[d]), `~u${c.units}~`,
  ].join(' | '));
}

export function matches(tokens, hay) {
  return tokens.every((t) => hay.includes(t));
}

/** "Tue Thu 11:10–12:40 · 3U · Doctrinal" (+ " · Jan 7–Feb 11" if not every week). */
function metaLine(c, data) {
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const byTime = new Map();
  for (const m of c.meetings) {
    const key = `${m.start}-${m.end}`;
    if (!byTime.has(key)) byTime.set(key, new Set());
    byTime.get(key).add(m.day);
  }
  const when = [...byTime.entries()].map(([k, ds]) => {
    const [s, e] = k.split('-');
    return `${order.filter((d) => ds.has(d)).join(', ')} ${fmtTime(s, false)}–${fmtTime(e, false)}`;
  }).join(' / ');
  const partial = meetingSummary(c, data).find((g) => g.partial);
  return [when, `${c.units} ${c.units === 1 ? 'unit' : 'units'}`, c.type, partial ? partial.dateLabel.replace(/ /g, '\u00a0') : null].filter(Boolean).join(' · ');
}

export function createFinder(root, data, { onToggle, onPreview }) {
  const rules = data.meta.rules;
  const items = data.electives.map((c) => ({ c, hay: haystack(c), meta: metaLine(c, data) }));
  items.sort((a, b) => COLLATOR.compare(a.c.title, b.c.title));

  const input = h('input', {
    type: 'search', id: 'q', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Search courses or professors',
    'aria-controls': 'course-list',
  });
  const count = h('span', { class: 'count' });
  const units = h('span', { class: 'units', role: 'status', 'aria-live': 'polite' });
  const list = h('ul', { class: 'list', id: 'course-list', 'aria-label': 'Electives' });
  const empty = h('p', { class: 'list-empty', hidden: true }, 'No matches.');

  fill(root,
    h('div', { class: 'finder-head' },
      h('div', { class: 'finder-title' }, h('h2', {}, 'Add electives'), units),
      h('div', { class: 'search' },
        h('label', { for: 'q', class: 'sr-only' }, 'Search electives'),
        input),
      h('p', { class: 'finder-hint' }, count, ' · try “seminar”, “paper”, “Thu”, “3 units”')),
    list, empty);

  const rows = new Map();
  for (const it of items) {
    const btn = h('button', {
      type: 'button', class: 'add', 'aria-pressed': 'false',
      onclick: () => onToggle(it.c.id),
    }, h('span', { 'aria-hidden': 'true', class: 'add-i' }, '+'));
    const clash = h('span', { class: 'clash', hidden: true }, 'Clashes');
    const li = h('li', {
      class: 'row', dataset: { id: it.c.id },
      onmouseenter: () => onPreview(it.c.id),
      onmouseleave: () => onPreview(null),
      onfocusin: () => onPreview(it.c.id),
      onfocusout: () => onPreview(null),
    },
    btn,
    h('div', { class: 'row-text' },
      h('span', { class: 'row-name', title: it.c.title }, it.c.shortTitle),
      h('span', { class: 'row-meta' }, it.meta)),
    clash);
    rows.set(it.c.id, { li, btn, clash, it });
  }

  let picked = new Set();

  function apply() {
    const tokens = queryTokens(input.value);
    const shown = items.filter((it) => matches(tokens, it.hay));
    shown.sort((a, b) => (picked.has(b.c.id) - picked.has(a.c.id)) || COLLATOR.compare(a.c.title, b.c.title));
    list.replaceChildren(...shown.map((it) => rows.get(it.c.id).li));
    count.textContent = tokens.length ? `${shown.length} of ${items.length} courses` : `${items.length} courses`;
    empty.hidden = shown.length > 0;
  }
  input.addEventListener('input', apply);

  return {
    /** Update pressed state and clash tags for the current picks. */
    update(pickedCourses) {
      picked = new Set(pickedCourses.map((c) => c.id));
      const u = pickedCourses.reduce((n, c) => n + c.units, 0);
      units.textContent = `${u} / ${rules.electiveUnitsMax} units`;
      units.classList.toggle('over', u > rules.electiveUnitsMax || rules.requiredUnits + u > rules.totalUnitsMax);
      const occupied = [...data.required, ...pickedCourses];
      for (const { btn, clash, li, it } of rows.values()) {
        const on = picked.has(it.c.id);
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${it.c.title}`);
        btn.firstChild.textContent = on ? '✓' : '+';
        li.classList.toggle('on', on);
        const with_ = on ? [] : occupied.filter((o) => conflictsBetween(it.c, o, data).length);
        clash.hidden = with_.length === 0;
        clash.title = with_.length ? `Clashes with ${with_.map((o) => o.shortTitle).join(', ')}` : '';
      }
      apply();
    },
    setQuery(q) { input.value = q; apply(); },
  };
}
