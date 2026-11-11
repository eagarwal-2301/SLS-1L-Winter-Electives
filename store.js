// Picks live only in this browser's localStorage. Every access is guarded:
// private windows or blocked storage just mean picks aren't remembered.

const KEY = 'sls1l-winter2027-picks-v1';

export function loadPicks(validIds) {
  try {
    const raw = localStorage.getItem(KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id) => validIds.has(id)) : [];
  } catch {
    return [];
  }
}

export function savePicks(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable; picks last for this visit only */
  }
}
