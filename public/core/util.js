// Small helpers shared by the core, modules and GUIs. No DOM access.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s) => String(s ?? '').toLowerCase();
export const uniq = (a) => [...new Set(a)];
export const byName = (a, b) => String(a).localeCompare(String(b));
export const readableType = (t) => String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
// Item icon, served by the tracker (downloaded from tarkov.dev the first time, then kept in the data folder
// so it works offline). '' when the item has no icon.
export const itemIcon = (it) => (it?.id && it?.iconLink ? `/api/images/items/${encodeURIComponent(it.id)}` : '');

// Item counts with thousands separators ("1,200,000 RUB" reads; "1200000" doesn't).
export const fmtCount = (n) => Number(n || 0).toLocaleString('en-US');
export const fmtNum =(n) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}`;
export const fmtDuration = (sec) => {
  const m = Math.round(sec / 60);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h ${String(mm).padStart(2, '0')}m` : `${h}h ${String(mm).padStart(2, '0')}m`;
};

export const fmtDurationSec = (sec) => {
  const t = Math.floor(sec + 1e-6); // the game drops the fraction of a second
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return `${d ? `${d}d ` : ''}${h}h ${String(m).padStart(2, '0')}m ${String(x).padStart(2, '0')}s`;
};

// ISO timestamp (or ms) -> "27 Nov, 19:23 (3 h ago)" in local time; fallback when missing or invalid.
export function fmtWhen(t, fallback = 'never') {
  const d = new Date(typeof t === 'number' ? t : t || '');
  if (!t || Number.isNaN(d.getTime())) return fallback;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const abs = d.toLocaleString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  const ago = min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`;
  return min < 0 ? abs : `${abs} (${ago})`;
}

// ISO timestamp -> value for <input type="datetime-local"> in local time.
export function toLocalInput(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
