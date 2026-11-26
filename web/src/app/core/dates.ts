/** Date helpers. The API speaks UTC ISO strings; the UI works in the user's local time. */

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO (UTC) -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local) -> ISO UTC, or null when empty. */
export function fromLocalInput(v: string | null | undefined): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function startOfDay(d = new Date()): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function formatTime(iso: string) { return timeFmt.format(new Date(iso)); }
export function formatDay(d: Date) { return dayFmt.format(d); }

/** "Today 3:00 PM", "Tomorrow", "Mon, Nov 30 9:00 AM". Midnight is treated as "no specific time". */
export function formatDue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = startOfDay();
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : formatDay(d);
  return hasTime ? `${day} ${timeFmt.format(d)}` : day;
}

export function isOverdue(iso: string | null, done: boolean): boolean {
  return !!iso && !done && new Date(iso).getTime() < Date.now();
}

export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return formatDay(new Date(iso));
}
