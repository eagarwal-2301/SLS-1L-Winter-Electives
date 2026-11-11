// "Your courses": details for picked courses only, unit status, conflicts,
// the Doctrinal/Seminar caveat, and the .ics download.

import { h, fill, extLink } from './dom.js';
import { fmtDateTime } from './time.js';
import { unitStatus, meetingSummary, describeOverlap } from './rules.js';
import { buildIcs } from './ics.js';

let uid = 0;

/** Inline disclosure (button + panel); buttons stay inline in Safari, <details> doesn't. */
function disclosure(cls, summary, body, label) {
  const id = `d${++uid}`;
  const panel = h('div', { class: 'disc-body', id, hidden: true }, body);
  const btn = h('button', {
    type: 'button', class: 'disc-btn', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': label || null,
    onclick: () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      wrap.classList.toggle('open', open);
    },
  }, summary);
  const wrap = h('span', { class: `disc ${cls}` }, btn, panel);
  return wrap;
}

const chev = () => h('span', { class: 'chev', 'aria-hidden': 'true' });

function row(c, data, onRemove) {
  const e = c.enrollment;
  const when = e.deadline ? `Due ${fmtDateTime(e.deadline)}` : '';  // only application deadlines; Open courses just say "Open"
  return h('tr', { dataset: { id: c.id } },
    h('td', { class: 'c-course', 'data-label': 'Course' },
      extLink(c.url, c.title, { class: 'course-link' }),
      h('span', { class: 'c-line' },
        h('span', { class: 'c-when' }, meetingSummary(c, data).map((g, i) => [i ? '; ' : '', g.text, g.partial ? ` (${g.dateLabel})` : ''])),
        c.flags.length
        ? disclosure('flag', [h('span', { 'aria-hidden': 'true' }, '⚑ '), c.flags.length === 1 ? 'Note' : `${c.flags.length} notes`],
          h('ul', { class: 'flag-list' }, c.flags.map((f) => h('li', {}, f))), `Notes about ${c.title}`)
          : null)),
    h('td', { class: 'c-prof', 'data-label': 'Professor' }, c.professors.join(', ')),
    h('td', { class: 'c-units', 'data-label': 'Units' }, h('span', { class: 'num' }, String(c.units)), h('span', { class: 'unit-word' }, c.units === 1 ? ' unit' : ' units')),
    h('td', { class: 'c-type', 'data-label': 'Type*' },
      c.typeNote
        ? disclosure('type', [h('span', { class: 'val' }, c.type), h('span', { class: 'star-m', 'aria-hidden': 'true' }, '*'), chev()], h('p', {}, c.typeNote), `${c.type}, show note`)
        : [h('span', { class: 'val' }, c.type), h('span', { class: 'star-m', 'aria-hidden': 'true' }, '*')]),
    h('td', { class: 'c-grading', 'data-label': 'Grading' }, h('span', { class: 'val' }, c.grading)),
    h('td', { class: 'c-assess', 'data-label': 'Exam / paper' },
      disclosure('assess', [h('span', { class: 'val' }, c.assessment), chev()], h('p', {}, c.assessmentDetail), `${c.assessment}, show details`)),
    h('td', { class: 'c-enroll', 'data-label': 'How to get in' },
      disclosure('enroll', [
        h('span', { class: 'method' }, c.enrollment.method),
        e.seats !== null && e.seats !== undefined ? h('span', { class: 'seats' }, ` · ${e.seats} seats`) : null,
        when ? h('span', { class: 'enroll-date' }, when, chev()) : chev(),
      ], [h('p', { class: 'how' }, e.howToApply), e.applyUrl ? extLink(e.applyUrl, 'Apply / enroll ↗', { class: 'apply' }) : null])),
    h('td', { class: 'c-x' },
      h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${c.title}`, onclick: () => onRemove(c.id) }, '×')));
}

export function createSelected(root, data, { onRemove }) {
  const rules = data.meta.rules;

  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const warns = h('div', { class: 'warns', 'aria-live': 'polite' });
  const hint = h('p', { class: 'hint', hidden: true },
    'Google Calendar: import on a computer (Settings → Import & export). iPhone: open the file, then Add All.');
  const dl = h('button', { type: 'button', class: 'btn', onclick: download }, 'Download .ics');
  const tbody = h('tbody');
  const table = h('table', { class: 'sel' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Course'),
      h('th', { scope: 'col' }, 'Professor(s)'),
      h('th', { scope: 'col', class: 'c-units' }, 'Units'),
      h('th', { scope: 'col' }, 'Type', h('a', { href: '#disclaimer', class: 'star', 'aria-label': 'About Doctrinal and Seminar labels (see note at the bottom)' }, '*')),
      h('th', { scope: 'col' }, 'Grading'),
      h('th', { scope: 'col' }, 'Exam / paper'),
      h('th', { scope: 'col' }, 'How to get in'),
      h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Remove')))),
    tbody);
  const empty = h('p', { class: 'sel-empty' }, 'Add courses from the list to see their details here.');

  fill(root,
    h('div', { class: 'sel-head' },
      h('div', { class: 'sel-title' }, h('h2', { id: 'picked-h' }, 'Your courses'), status),
      h('div', { class: 'sel-actions' }, dl, hint)),
    warns,
    h('div', { class: 'card sel-card' }, table, empty));

  let current = [];

  function download() {
    const ics = buildIcs([...data.required, ...current], data);
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = h('a', { href: url, download: 'sls-1l-winter-2027.ics' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    hint.hidden = false;
  }

  return {
    render(picks, conflicts) {
      current = picks;
      const st = unitStatus(picks, rules);
      fill(status,
        h('span', { class: `stat stat-elective${st.electiveOver ? ' over' : ''}` }, h('b', {}, String(st.elective)), ` / ${rules.electiveUnitsMax} elective units`));
      root.classList.toggle('is-over', st.over);
      const items = [
        st.over ? h('li', { class: 'warn' }, st.message) : null,
        ...conflicts.map((p) => h('li', { class: 'warn' },
          h('strong', {}, `${p.a.shortTitle} and ${p.b.shortTitle} overlap`), ` — ${p.overlaps.map(describeOverlap).join('; ')}`)),
      ].filter(Boolean);
      fill(warns, items.length ? h('ul', { class: 'alert' }, items) : null);
      fill(tbody, picks.map((c) => row(c, data, onRemove)));
      table.hidden = picks.length === 0;
      empty.hidden = picks.length > 0;
      return st;
    },
  };
}
