import { h, extLink, fill } from './dom.js';
import { loadData, validate } from './data.js';
import { fmtDateTime, zonedToEpoch } from './time.js';
import { findConflicts } from './rules.js';
import { createCalendar } from './calendar.js';
import { createFinder } from './finder.js';
import { createSelected } from './selected.js';
import { loadPicks, savePicks } from './store.js';

const $ = (sel) => document.querySelector(sel);

/** "now", overridable for testing with ?now=2026-11-17T00:00 (Pacific). */
function nowMs(tz) {
  const p = new URLSearchParams(location.search).get('now');
  return p && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p) ? zonedToEpoch(p, tz) : Date.now();
}

/** Spotlight only the single next upcoming deadline. */
function renderSpotlight(el, meta) {
  const now = nowMs(meta.timezone);
  const next = (meta.deadlines || [])
    .map((d) => ({ ...d, at: zonedToEpoch(d.date, meta.timezone) }))
    .filter((d) => d.at > now)
    .sort((a, b) => a.at - b.at)[0];
  if (!next) { el.hidden = true; return; }
  fill(el,
    h('span', { class: 'spot-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'spot-text' },
      h('span', { class: 'spot-label' }, next.label),
      h('time', { datetime: next.date, class: 'spot-date' }, `${fmtDateTime(next.date)} PT`)));
  if (next.detail) el.title = next.detail;
  el.hidden = false;
}

function renderFooter(el, meta) {
  // Two parts: (1) the unofficial-site notice, (2) the Doctrinal/Seminar caveat.
  // meta.disclaimer repeats the caveat sentence, so it's dropped from part 1 here
  // (courses.json itself is left as is).
  const td = meta.typeDefinitions;
  const siteNotice = td?.note ? meta.disclaimer.replace(td.note, '').replace(/\s{2,}/g, ' ').trim() : meta.disclaimer;
  fill(el,
    h('div', { class: 'foot-banner', id: 'disclaimer' },
      h('p', {}, siteNotice),
      td && h('p', { class: 'type-defs' },
        '* ', td.note, ' ', h('strong', {}, 'Doctrinal'), ': ', td.Doctrinal, ' ',
        h('strong', {}, 'Seminar'), ': ', td.Seminar),
      h('p', { class: 'contact' }, 'Please report any errors or concerns regarding this site or its data to ',
        h('a', { href: 'mailto:eesha@stanford.edu' }, 'eesha@stanford.edu'), '.')),
    h('ul', { class: 'foot-links' }, (meta.sources || []).map((s) => h('li', {}, extLink(s.url, s.label)))));
}

async function main() {
  let data;
  try {
    data = await loadData();
  } catch (e) {
    showFatal(e.message);
    return;
  }
  const { fatal, problems } = validate(data);
  if (fatal) { showFatal(fatal); return; }
  if (problems.length) {
    console.warn('courses.json problems:\n' + problems.join('\n'));
    const box = $('#data-problems');
    fill(box, h('strong', {}, `courses.json has ${problems.length} problem${problems.length === 1 ? '' : 's'}:`),
      h('ul', {}, problems.map((p) => h('li', {}, p))));
    box.hidden = false;
  }

  const meta = data.meta;
  document.title = meta.title;
  // "SLS 1L Winter Electives" on the first line, the year on the second
  const t = meta.title.match(/^(.*\S)\s+(\d{4}\s*[–-]\s*\d{2,4})$/);
  if (t) fill($('#title'), h('span', { class: 't-main' }, t[1]), ' ', h('span', { class: 't-year' }, t[2]));
  else $('#title').textContent = meta.title;
  renderSpotlight($('#spotlight'), meta);
  renderFooter($('#footer'), meta);

  const byId = new Map(data.electives.map((c) => [c.id, c]));
  let picks = loadPicks(new Set(byId.keys()));
  let previewId = null;

  const courses = () => picks.map((id) => byId.get(id));
  const conflictsNow = () => findConflicts([...data.required, ...courses()], data);

  const setPicks = (ids) => {
    picks = ids;
    savePicks(picks);
    previewId = null;
    calendar.closePop();
    const cs = courses();
    const conflicts = conflictsNow();
    finder.update(cs);
    calendar.render(cs, null, conflicts);
    selected.render(cs, conflicts);
  };
  const toggle = (id) => setPicks(picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id]);
  const remove = (id) => setPicks(picks.filter((p) => p !== id));

  let previewTimer = 0;
  const preview = (id) => {
    clearTimeout(previewTimer);
    // small delay on leave so moving between rows doesn't flicker
    previewTimer = setTimeout(() => {
      const next = id && !picks.includes(id) ? id : null;
      if (next === previewId) return;
      previewId = next;
      calendar.render(courses(), next ? byId.get(next) : null, conflictsNow());
    }, id ? 0 : 60);
  };

  const calendar = createCalendar($('#calendar'), data, { onRemove: remove });
  const finder = createFinder($('#finder'), data, { onToggle: toggle, onPreview: preview });
  const selected = createSelected($('#picked'), data, { onRemove: remove });
  setPicks(picks);

  $('#loading').remove();
  $('#main').hidden = false;
  $('#picked').hidden = false;
  document.body.dataset.ready = '1';
}

function showFatal(msg) {
  const el = $('#loading');
  el.className = 'fatal';
  el.textContent = `Couldn’t load the course list. ${msg}`;
  document.body.dataset.ready = 'error';
}

main();
