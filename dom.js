// Tiny DOM builder. Text from courses.json is always inserted as text nodes,
// never as HTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') {
      // CSSOM (not a style attribute) so a strict Content-Security-Policy allows it.
      for (const decl of String(v).split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Only allow http(s) links from the data file. */
export function safeUrl(u) {
  try {
    const url = new URL(u, location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function extLink(href, text, attrs = {}) {
  const safe = safeUrl(href);
  if (!safe) return h('span', attrs, text);
  return h('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', ...attrs }, text);
}

/** Replace an element's children, skipping null/false (replaceChildren would print "null"). */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
