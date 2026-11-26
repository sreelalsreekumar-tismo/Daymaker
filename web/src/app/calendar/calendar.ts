import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { addDays, formatDay, formatTime, fromLocalInput, relativeTime, sameDay, startOfDay, toLocalInput } from '../core/dates';
import { CalendarEvent, GoogleStatus, Todo } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Confirm, Toasts, errMsg } from '../core/ui.services';
import { DateTime } from '../shared/datetime';
import { Icon } from '../shared/icon';

interface Entry { kind: 'todo' | 'event'; id: number; title: string; start: Date; allDay: boolean; done: boolean; overdue: boolean; todo?: Todo; event?: CalendarEvent }

/** All-day events are stored as UTC midnight; show them on the same calendar date for every time zone. */
function eventStart(e: CalendarEvent): Date {
  const d = new Date(e.startUtc);
  return e.allDay ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d;
}

@Component({
  selector: 'dm-calendar',
  imports: [FormsModule, Icon, RouterLink, DateTime],
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Calendar</h1>
        <div class="row">
          <button class="btn sm" (click)="shift(-1)" aria-label="Previous"><dm-icon name="play" [size]="12" style="transform:rotate(180deg)" /></button>
          <button class="btn sm" (click)="goToday()">Today</button>
          <button class="btn sm" (click)="shift(1)" aria-label="Next"><dm-icon name="play" [size]="12" /></button>
          <strong class="mlabel">{{ monthLabel() }}</strong>
        </div>
        <span class="spacer"></span>
        <div class="seg"><button [class.on]="view() === 'month'" (click)="view.set('month')">Month</button><button [class.on]="view() === 'agenda'" (click)="view.set('agenda')">Agenda</button></div>
        <button class="btn" (click)="newEvent()" [disabled]="!google()?.connected"><dm-icon name="calendar" /> New event</button>
        <button class="btn primary" (click)="newTask(selected() ?? today)"><dm-icon name="plus" /> New task</button>
      </div>

      @if (google(); as g) {
        <div class="status row small" [class.err]="g.lastError">
          @if (!g.connected) { <span class="muted"><dm-icon name="cloud" [size]="14" /> Google Calendar is not connected — </span><a routerLink="/settings">connect it</a><span class="muted"> to see meetings here.</span> }
          @else {
            <span class="chip meeting"><dm-icon name="cloud" [size]="12" /> {{ g.lastError ? 'Sync problem' : 'Synced' }}</span>
            <span class="muted">{{ g.lastSyncUtc ? 'Last sync ' + rel(g.lastSyncUtc) : 'Not synced yet' }}</span>
            @if (g.lastError) { <span class="err">{{ g.lastError }}</span> }
            <button class="btn ghost sm" (click)="syncNow()" [disabled]="syncing()"><dm-icon name="refresh" [size]="14" /> {{ syncing() ? 'Syncing…' : 'Sync now' }}</button>
          }
          <span class="spacer"></span>
          <span class="legend"><span class="chip"><span class="dot"></span> Task</span> <span class="chip meeting"><span class="dot m"></span> Meeting</span></span>
        </div>
      }
      @if (error()) { <div class="banner error row" role="alert">{{ error() }} <button class="btn sm" (click)="load()">Retry</button></div> }

      @if (view() === 'month') {
        <div class="layout">
          <div class="month card">
            @for (d of weekdays; track d) { <div class="wd">{{ d }}</div> }
            @for (c of cells(); track c.date.getTime()) {
              <button class="cell" [class.other]="c.date.getMonth() !== cursor().getMonth()" [class.today]="sameDay(c.date, today)" [class.sel]="selected() && sameDay(c.date, selected()!)"
                      (click)="select(c.date)" [attr.aria-label]="dayLabel(c.date) + ', ' + c.items.length + ' items'">
                <span class="num">{{ c.date.getDate() }}</span>
                @for (e of c.items.slice(0, 3); track e.kind + e.id) {
                  <span class="pill {{ e.kind }}" [class.done]="e.done" [class.overdue]="e.overdue">{{ e.title }}</span>
                }
                @if (c.items.length > 3) { <span class="more">+{{ c.items.length - 3 }} more</span> }
              </button>
            }
          </div>
          <aside class="card day stack">
            <div class="row"><h2>{{ selected() ? dayLabel(selected()!) : 'Select a day' }}</h2></div>
            @if (selected()) {
              <div class="row"><button class="btn sm" (click)="newTask(selected()!)"><dm-icon name="plus" [size]="14" /> Task</button>
                <button class="btn sm" (click)="newEvent(selected()!)" [disabled]="!google()?.connected"><dm-icon name="plus" [size]="14" /> Event</button></div>
              @for (e of dayItems(); track e.kind + e.id) {
                <button class="entry {{ e.kind }}" (click)="openEntry(e)">
                  <span class="t">{{ e.allDay ? 'All day' : time(e.start) }}</span><span class="ti" [class.done]="e.done">{{ e.title }}</span>
                  @if (e.kind === 'event') { <span class="chip meeting">Meeting</span> }
                </button>
              } @empty { <p class="muted small">Nothing scheduled.</p> }
            }
          </aside>
        </div>
      } @else {
        @for (g of agenda(); track g.day.getTime()) {
          <h3 class="aday">{{ dayLabel(g.day) }}</h3>
          <div class="stack">
            @for (e of g.items; track e.kind + e.id) {
              <button class="entry card {{ e.kind }}" (click)="openEntry(e)">
                <span class="t">{{ e.allDay ? 'All day' : time(e.start) }}</span><span class="ti" [class.done]="e.done">{{ e.title }}</span>
                @if (e.kind === 'event') { <span class="chip meeting"><dm-icon name="calendar" [size]="12" /> Meeting</span> } @else { <span class="chip">Task</span> }
              </button>
            }
          </div>
        } @empty { <div class="empty card">Nothing scheduled in this period.</div> }
      }
    </div>

    @if (form(); as f) {
      <div class="scrim" (click)="form.set(null)">
        <form class="dlg card stack" (click)="$event.stopPropagation()" (ngSubmit)="saveEvent()" (keydown.escape)="form.set(null)" role="dialog" aria-modal="true">
          <div class="row"><h2>{{ f.id ? 'Edit event' : 'New event' }}</h2><span class="spacer"></span><button type="button" class="icon-btn" (click)="form.set(null)" aria-label="Close"><dm-icon name="x" /></button></div>
          <label class="field">Title<input type="text" name="t" [(ngModel)]="f.title" required autofocus /></label>
          <label class="row"><input type="checkbox" name="ad" [(ngModel)]="f.allDay" /> All day</label>
          @if (!f.allDay) {
            <div class="grid2"><div class="field">Starts <dm-datetime name="s" [ngModel]="f.start" (ngModelChange)="setStart(f, $event)" placeholder="Start" ariaLabel="Starts" /></div>
              <div class="field">Ends <dm-datetime name="e" [(ngModel)]="f.end" placeholder="End" ariaLabel="Ends" /></div></div>
          } @else { <div class="field">Date <dm-datetime name="d" mode="date" [(ngModel)]="f.date" placeholder="Choose date" ariaLabel="Date" /></div> }
          <label class="field">Description<textarea name="desc" [(ngModel)]="f.description"></textarea></label>
          <label class="field">Reminder (minutes before)<input type="text" name="rm" [(ngModel)]="f.reminder" inputmode="numeric" placeholder="Default" /></label>
          @if (formError()) { <p class="banner error small" role="alert">{{ formError() }}</p> }
          <div class="row">
            @if (f.id) { <button type="button" class="btn danger" (click)="deleteEvent()"><dm-icon name="trash" [size]="16" /> Delete</button> }
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="form.set(null)">Cancel</button>
            <button type="submit" class="btn primary" [disabled]="saving() || !f.title.trim()">{{ saving() ? 'Saving…' : 'Save' }}</button>
          </div>
        </form>
      </div>
    }`,
  styles: `
    .mlabel { min-width: 9rem; } .status { margin-bottom: 0.8rem; } .legend { display: flex; gap: 0.4rem; } .dot.m { background: var(--meeting); }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--gap); align-items: start; }
    @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } }
    .month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); padding: 0; overflow: hidden; }
    .wd { padding: 0.5rem; text-align: center; font-size: 0.8rem; color: var(--muted); border-bottom: 1px solid var(--border); }
    .cell { min-height: 6.2rem; border: 0; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--surface); padding: 0.3rem; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
    .cell:nth-child(7n+1) { } .cell:hover { background: var(--surface-2); } .cell.other { background: var(--bg); color: var(--muted); }
    .cell.sel { outline: 2px solid var(--accent); outline-offset: -2px; } .num { font-size: 0.85rem; font-weight: 600; width: 1.5rem; height: 1.5rem; display: grid; place-items: center; border-radius: 50%; }
    .cell.today .num { background: var(--accent); color: var(--on-accent); }
    .pill { font-size: 0.72rem; padding: 1px 5px; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill.todo { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
    .pill.event { background: color-mix(in srgb, var(--meeting) 18%, transparent); color: var(--meeting); border-left: 3px solid var(--meeting); }
    .pill.done { text-decoration: line-through; opacity: 0.6; } .pill.overdue { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
    .more { font-size: 0.7rem; color: var(--muted); }
    @media (max-width: 600px) { .cell { min-height: 4rem; } .pill { display: none; } .cell .more { display: none; } }
    .day { position: sticky; top: 4.5rem; } .aday { margin: 1rem 0 0.4rem; }
    .entry { display: flex; align-items: center; gap: 0.6rem; border: 1px solid var(--border); background: var(--surface); border-radius: 10px; padding: 0.5rem 0.7rem; cursor: pointer; text-align: left; width: 100%; }
    .entry.event { border-left: 4px solid var(--meeting); } .entry.todo { border-left: 4px solid var(--accent); } .entry:hover { background: var(--surface-2); }
    .t { color: var(--muted); font-size: 0.82rem; min-width: 4.5rem; } .ti { flex: 1; font-weight: 500; } .ti.done { text-decoration: line-through; color: var(--muted); }
    .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 45%); display: grid; place-items: start center; z-index: 90; padding: 2rem 1rem; overflow-y: auto; }
    .dlg { width: min(100%, 520px); box-shadow: var(--shadow-lg); } .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }
    @media (max-width: 520px) { .grid2 { grid-template-columns: 1fr; } }`,
})
export class Calendar {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private route = inject(ActivatedRoute);
  private store = inject(TodoStore);

  today = startOfDay();
  weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  view = signal<'month' | 'agenda'>('month');
  cursor = signal(new Date(this.today.getFullYear(), this.today.getMonth(), 1));
  selected = signal<Date | null>(this.today);
  todos = signal<Todo[]>([]);
  events = signal<CalendarEvent[]>([]);
  google = signal<GoogleStatus | null>(null);
  error = signal('');
  syncing = signal(false);
  saving = signal(false);
  formError = signal('');
  form = signal<{ id?: number; title: string; allDay: boolean; start: string; end: string; date: string; description: string; reminder: string } | null>(null);

  monthLabel = computed(() => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(this.cursor()));

  /** The 6-week grid covering the visible month (Monday first). */
  range = computed(() => {
    const first = this.cursor();
    const offset = (first.getDay() + 6) % 7;
    const start = addDays(first, -offset);
    return { start, end: addDays(start, 42) };
  });

  entries = computed<Entry[]>(() => {
    const out: Entry[] = [];
    for (const t of this.todos()) {
      if (!t.dueUtc) continue;
      const done = t.status === 'Completed';
      out.push({ kind: 'todo', id: t.id, title: t.title, start: new Date(t.dueUtc), allDay: false, done, overdue: !done && new Date(t.dueUtc) < new Date(), todo: t });
    }
    // an event linked to a todo is the same thing seen twice — show only the task
    for (const e of this.events()) {
      if (e.linkedTodoId) continue;
      out.push({ kind: 'event', id: e.id, title: e.title, start: eventStart(e), allDay: e.allDay, done: false, overdue: false, event: e });
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  cells = computed(() => {
    const { start } = this.range();
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(start, i);
      return { date, items: this.entries().filter((e) => sameDay(e.start, date)) };
    });
  });

  dayItems = computed(() => { const s = this.selected(); return s ? this.entries().filter((e) => sameDay(e.start, s)) : []; });

  agenda = computed(() => {
    const from = startOfDay();
    const groups = new Map<number, { day: Date; items: Entry[] }>();
    for (const e of this.entries().filter((x) => x.start >= from)) {
      const day = startOfDay(e.start);
      if (!groups.has(day.getTime())) groups.set(day.getTime(), { day, items: [] });
      groups.get(day.getTime())!.items.push(e);
    }
    return [...groups.values()];
  });

  constructor() {
    effect(() => { this.store.version(); this.range(); this.view(); untracked(() => void this.load()); });
    void this.loadStatus();
    const ev = Number(this.route.snapshot.queryParamMap.get('event'));
    if (ev) void this.openEventById(ev);
  }

  sameDay = sameDay;
  time(d: Date) { return formatTime(d.toISOString()); }
  dayLabel(d: Date) { return formatDay(d); }
  rel(iso: string) { return relativeTime(iso); }

  shift(n: number) { const c = this.cursor(); this.cursor.set(new Date(c.getFullYear(), c.getMonth() + n, 1)); }
  goToday() { this.cursor.set(new Date(this.today.getFullYear(), this.today.getMonth(), 1)); this.selected.set(this.today); }
  select(d: Date) { this.selected.set(d); }

  async load() {
    const { start, end } = this.range();
    const from = this.view() === 'agenda' ? startOfDay() : start;
    const to = this.view() === 'agenda' ? addDays(startOfDay(), 60) : end;
    try {
      const [todos, events] = await Promise.all([
        this.api.todos({ from: from.toISOString(), to: to.toISOString(), topLevel: false }),
        this.api.events(from, to),
      ]);
      this.todos.set(todos); this.events.set(events); this.error.set('');
    } catch { this.error.set('Could not load your calendar.'); }
  }

  async loadStatus() { try { this.google.set(await this.api.googleStatus()); } catch { /* banner simply hidden */ } }

  async syncNow() {
    this.syncing.set(true);
    try {
      const r = await this.api.googleSync();
      await Promise.all([this.loadStatus(), this.load()]);
      this.toasts.show(r.lastError ? `Sync failed: ${r.lastError}` : 'Calendar synced', r.lastError ? 'error' : 'ok');
    } catch (e) { this.toasts.error(e, 'Sync failed'); }
    finally { this.syncing.set(false); }
  }

  newTask(day: Date) { const d = new Date(day); d.setHours(9, 0, 0, 0); this.store.openNew({ dueUtc: d.toISOString() }); }

  newEvent(day: Date = this.selected() ?? this.today) {
    const s = new Date(day); s.setHours(10, 0, 0, 0);
    this.formError.set('');
    this.form.set({ title: '', allDay: false, start: toLocalInput(s.toISOString()), end: toLocalInput(addHours(s, 1).toISOString()), date: ymd(day), description: '', reminder: '' });
  }

  /** Changing the start moves the end too, keeping the event's length (as Apple Calendar does). */
  setStart(f: { start: string; end: string }, v: string) {
    const len = f.start && f.end ? new Date(f.end).getTime() - new Date(f.start).getTime() : 3600000;
    f.start = v;
    if (v) f.end = toLocalInput(new Date(new Date(v).getTime() + Math.max(len, 0)).toISOString());
  }

  openEntry(e: Entry) {
    if (e.todo) { this.store.openEdit(e.todo); return; }
    const ev = e.event!;
    this.formError.set('');
    this.form.set({
      id: ev.id, title: ev.title, allDay: ev.allDay, description: ev.description, reminder: '',
      start: toLocalInput(ev.startUtc), end: toLocalInput(ev.endUtc), date: ymd(eventStart(ev)),
    });
  }

  private async openEventById(id: number) {
    await this.load();
    const e = this.entries().find((x) => x.kind === 'event' && x.id === id);
    if (e) { this.selected.set(startOfDay(e.start)); this.cursor.set(new Date(e.start.getFullYear(), e.start.getMonth(), 1)); this.openEntry(e); }
  }

  async saveEvent() {
    const f = this.form();
    if (!f || !f.title.trim()) return;
    let startUtc: string, endUtc: string;
    if (f.allDay) {
      const [y, m, d] = f.date.split('-').map(Number);
      startUtc = new Date(Date.UTC(y, m - 1, d)).toISOString(); endUtc = new Date(Date.UTC(y, m - 1, d + 1)).toISOString();
    } else {
      startUtc = fromLocalInput(f.start)!; endUtc = fromLocalInput(f.end)!;
      if (new Date(endUtc) < new Date(startUtc)) { this.formError.set('The event cannot end before it starts.'); return; }
    }
    const reminderMinutes = f.reminder.trim() ? Number(f.reminder) : null;
    if (reminderMinutes !== null && (!Number.isInteger(reminderMinutes) || reminderMinutes < 0)) { this.formError.set('Reminder must be a whole number of minutes.'); return; }
    this.saving.set(true); this.formError.set('');
    try {
      const body = { title: f.title.trim(), description: f.description, startUtc, endUtc, allDay: f.allDay, reminderMinutes };
      await (f.id ? this.api.updateEvent(f.id, body) : this.api.createEvent(body));
      this.form.set(null); this.toasts.show(f.id ? 'Event updated in Google Calendar' : 'Event created in Google Calendar');
      await this.load();
    } catch (e) { this.formError.set('Not saved. ' + errMsg(e)); }
    finally { this.saving.set(false); }
  }

  async deleteEvent() {
    const f = this.form();
    if (!f?.id || !(await this.confirm.ask(`Delete "${f.title}" from your Google Calendar?`))) return;
    try { await this.api.deleteEvent(f.id); this.form.set(null); this.toasts.show('Event deleted'); await this.load(); }
    catch (e) { this.toasts.error(e); }
  }
}

function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600000); }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
