// Weekly Mon–Fri calendar: required courses, picks, a hover preview, and a
// small detail card when a block is tapped.

import { h, fill } from './dom.js';
import { WEEKDAYS, toMinutes, fmtTimeRange, fmtDate } from './time.js';
import { courseSlots, conflictsBetween, describeOverlap } from './rules.js';

export function createCalendar(root, data, { onRemove }) {
  const required = data.required;
  const all = [...required, ...data.electives].flatMap((c) => c.meetings);
  // Bounds snapped to the half hour around the earliest start / latest end.
  const gStart = Math.floor(Math.min(...all.map((m) => toMinutes(m.start))) / 30) * 30;
  const gEnd = Math.ceil(Math.max(...all.map((m) => toMinutes(m.end))) / 30) * 30;
  const span = gEnd - gStart;
  const pct = (min) => `${((min - gStart) / span) * 100}%`;

  const hours = [];
  const lines = [];
  for (let t = Math.ceil(gStart / 60) * 60; t < gEnd; t += 60) {
    const hr = t / 60;
    hours.push(h('span', { class: 'cal-hour', style: `top:${pct(t)}` }, `${hr % 12 || 12} ${hr < 12 ? 'AM' : 'PM'}`));
    lines.push(h('span', { class: 'cal-line', style: `top:${pct(t)}` }));
  }
  const days = WEEKDAYS.map((d) => h('div', { class: 'cal-day', role: 'group', 'aria-label': d }));
  const pop = h('div', { class: 'cal-pop', hidden: true, role: 'dialog', 'aria-label': 'Course details' });

  root.style.setProperty('--span', String(span));
  fill(root,
    h('div', { class: 'cal-head', 'aria-hidden': 'true' }, h('span'), WEEKDAYS.map((d) => h('span', {}, d))),
    h('div', { class: 'cal-body' },
      h('div', { class: 'cal-hours', 'aria-hidden': 'true' }, hours),
      h('div', { class: 'cal-grid' }, h('div', { class: 'cal-lines', 'aria-hidden': 'true' }, lines), days)),
    pop);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });

  function showPop(b) {
    const s = b.slot;
    fill(pop,
      h('div', { class: 'pop-head' },
        h('strong', {}, b.c.title),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => { pop.hidden = true; } }, '×')),
      h('p', { class: 'pop-when' }, `${s.day} ${fmtTimeRange(s.start, s.end)}`),
      s.partial ? h('p', {}, `Meets ${s.dates.length === 1 ? 'once' : `${s.dates.length} times`}: ${s.dates.map(fmtDate).join(', ')}`) : null,
      b.clash.map((t) => h('p', { class: 'warn-text' }, t)),
      (b.c.flags || []).map((f) => h('p', { class: 'muted' }, f)),
      b.kind === 'pick' ? h('button', { type: 'button', class: 'btn-quiet', onclick: () => { pop.hidden = true; onRemove(b.c.id); } }, 'Remove') : null);
    pop.hidden = false;
  }

  /**
   * picks: elective objects; preview: elective object or null.
   * conflicts: findConflicts() result for required + picks.
   */
  function render(picks, preview, conflicts) {
    const byDay = Object.fromEntries(WEEKDAYS.map((d) => [d, []]));
    const clashText = (c, slot) => {
      const out = [];
      for (const p of conflicts) {
        if (p.a !== c && p.b !== c) continue;
        const other = p.a === c ? p.b : p.a;
        for (const o of p.overlaps) {
          if (o.day === slot.day && o.start < slot.end && slot.start < o.end) out.push(`Clashes with ${other.shortTitle}: ${describeOverlap(o)}`);
        }
      }
      return out;
    };
    const add = (c, kind, clash) => {
      for (const slot of courseSlots(c, data)) {
        if (!byDay[slot.day]) continue;
        byDay[slot.day].push({ c, kind, slot, s: toMinutes(slot.start), e: toMinutes(slot.end), clash: clash(slot) });
      }
    };
    for (const c of required) add(c, 'req', (slot) => clashText(c, slot));
    for (const c of picks) add(c, 'pick', (slot) => clashText(c, slot));
    if (preview && !picks.includes(preview)) {
      const against = [...required, ...picks].map((o) => ({ o, ov: conflictsBetween(preview, o, data) })).filter((x) => x.ov.length);
      add(preview, 'ghost', (slot) => against.flatMap(({ o, ov }) => ov
        .filter((x) => x.day === slot.day && x.start < slot.end && slot.start < x.end)
        .map((x) => `Would clash with ${o.shortTitle}: ${describeOverlap(x)}`)));
    }

    days.forEach((col, i) => {
      const blocks = byDay[WEEKDAYS[i]].sort((a, b) => a.s - b.s || b.e - a.e);
      layoutColumns(blocks);
      fill(col, blocks.map((b) => {
        const cls = ['blk', b.kind, b.slot.partial ? 'partial' : '', b.clash.length ? 'conflict' : '', b.cols > 1 ? 'narrow' : ''].join(' ');
        const label = `${b.c.title}, ${b.slot.day} ${fmtTimeRange(b.slot.start, b.slot.end)}`
          + (b.slot.partial ? `, not every week (${b.slot.dateLabel})` : '')
          + (b.clash.length ? ', time conflict' : '')
          + (b.kind === 'req' ? ', required' : b.kind === 'ghost' ? ', preview' : '');
        const el = h(b.kind === 'ghost' ? 'div' : 'button', {
          class: cls,
          style: `top:calc(${pct(b.s)} + 1px);height:calc(${((b.e - b.s) / span) * 100}% - 2px);`
            + `left:calc(${(b.col / b.cols) * 100}% + 3px);width:calc(${100 / b.cols}% - 6px)`,
          ...(b.kind === 'ghost' ? { 'aria-hidden': 'true' } : { type: 'button', 'aria-label': label, onclick: () => showPop(b) }),
        },
        h('span', { class: 'blk-t' }, b.c.shortTitle),
        h('span', { class: 'blk-s' }, fmtTimeRange(b.slot.start, b.slot.end)),
        b.slot.partial ? h('span', { class: 'blk-d' }, b.slot.dateLabel) : null);
        return el;
      }));
    });
  }

  return { render, closePop: () => { pop.hidden = true; } };
}

/** Side-by-side columns for blocks whose times overlap within a day. */
function layoutColumns(blocks) {
  let cluster = [];
  let end = -1;
  const flush = () => {
    const cols = [];
    for (const b of cluster) {
      let i = cols.findIndex((e) => e <= b.s);
      if (i === -1) { i = cols.length; cols.push(0); }
      cols[i] = b.e;
      b.col = i;
    }
    for (const b of cluster) b.cols = cols.length;
    cluster = [];
  };
  for (const b of blocks) {
    if (cluster.length && b.s >= end) flush();
    cluster.push(b);
    end = Math.max(end, b.e);
  }
  if (cluster.length) flush();
}
