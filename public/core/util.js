// Small helpers shared by the core, modules and GUIs. No DOM access.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s) => String(s ?? '').toLowerCase();
export const uniq = (a) => [...new Set(a)];
export const byName = (a, b) => String(a).localeCompare(String(b));
export const readableType = (t) => String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
export const fmtNum = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}`;
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

// ISO timestamp -> value for <input type="datetime-local"> in local time.
// ISO timestamp -> value for <input type="datetime-local"> in local time.
export function toLocalInput(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
