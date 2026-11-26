import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { addDays, formatTime, startOfDay } from '../core/dates';
import { CalendarEvent, Todo } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Toasts } from '../core/ui.services';
import { Icon } from '../shared/icon';

interface Slot { kind: 'todo' | 'event'; id: number; title: string; at: Date; end?: Date; allDay: boolean; done: boolean; todo?: Todo }

/** Today: meetings and todos merged into one chronological timeline. */
@Component({
  selector: 'dm-today',
  imports: [Icon, RouterLink],
  template: `
    <div class="page narrow">
      <div class="page-head"><div><h1>Today</h1><span class="muted">{{ label }}</span></div><span class="spacer"></span>
        <button class="btn primary" (click)="store.openNew({ dueUtc: soon() })"><dm-icon name="plus" /> New task</button></div>

      @if (error()) { <div class="banner error row" role="alert">{{ error() }} <button class="btn sm" (click)="load()">Retry</button></div> }

      @if (overdue().length) {
        <section class="card stack"><h2 class="err">Overdue</h2>
          @for (t of overdue(); track t.id) {
            <div class="row"><input type="checkbox" (change)="toggle(t)" [attr.aria-label]="'Complete ' + t.title" />
              <button class="link" (click)="store.openEdit(t)">{{ t.title }}</button><span class="spacer"></span>
              <button class="icon-btn" (click)="focus(t)" aria-label="Focus"><dm-icon name="target" [size]="16" /></button></div>
          }
        </section>
      }

      <div class="timeline">
        @for (s of slots(); track s.kind + s.id; let i = $index) {
          @if (showNow(i)) { <div class="now" role="separator" aria-label="Now"><span>Now · {{ nowLabel }}</span></div> }
          <div class="slot {{ s.kind }}" [class.done]="s.done" [class.past]="isPast(s)">
            <div class="when">{{ s.allDay ? 'All day' : time(s.at) }}@if (s.end && !s.allDay) { <span class="muted small">{{ time(s.end) }}</span> }</div>
            <div class="what card">
              @if (s.kind === 'todo') {
                <input type="checkbox" [checked]="s.done" (change)="toggle(s.todo!)" [attr.aria-label]="'Complete ' + s.title" />
                <button class="link grow" (click)="store.openEdit(s.todo!)">{{ s.title }}</button>
                <button class="icon-btn" (click)="focus(s.todo!)" aria-label="Focus" title="Focus"><dm-icon name="target" [size]="16" /></button>
              } @else {
                <dm-icon name="calendar" /> <a class="grow link" [routerLink]="['/calendar']" [queryParams]="{ event: s.id }">{{ s.title }}</a>
                <span class="chip meeting">Meeting</span>
              }
            </div>
          </div>
        }
        @if (showNow(slots().length)) { <div class="now"><span>Now · {{ nowLabel }}</span></div> }
        @if (!slots().length && !loading()) { <div class="empty card">Nothing scheduled for today. Add a task or enjoy the open time.</div> }
      </div>

      @if (anytime().length) {
        <section class="card stack"><h2>Anytime today</h2>
          @for (t of anytime(); track t.id) {
            <div class="row"><input type="checkbox" [checked]="t.status === 'Completed'" (change)="toggle(t)" [attr.aria-label]="'Complete ' + t.title" />
              <button class="link" [class.done]="t.status === 'Completed'" (click)="store.openEdit(t)">{{ t.title }}</button><span class="spacer"></span>
              <button class="icon-btn" (click)="focus(t)" aria-label="Focus"><dm-icon name="target" [size]="16" /></button></div>
          }
        </section>
      }
    </div>`,
  styles: `
    .narrow { max-width: 820px; } section { margin-bottom: 1rem; }
    .timeline { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .slot { display: grid; grid-template-columns: 5.2rem 1fr; gap: 0.8rem; align-items: stretch; } .slot.past:not(.done) .when { color: var(--muted); }
    .when { padding-top: 0.8rem; font-weight: 600; display: flex; flex-direction: column; } .when .small { font-weight: 400; }
    .what { display: flex; align-items: center; gap: 0.6rem; padding-block: 0.6rem; } .slot.event .what { border-left: 4px solid var(--meeting); } .slot.todo .what { border-left: 4px solid var(--accent); }
    .slot.done .grow { text-decoration: line-through; color: var(--muted); }
    .grow { flex: 1; text-align: left; } .link { border: 0; background: none; cursor: pointer; font-weight: 600; padding: 0; color: var(--text); text-decoration: none; } .link:hover { text-decoration: underline; }
    .link.done { text-decoration: line-through; color: var(--muted); }
    .now { display: flex; align-items: center; gap: 0.5rem; color: var(--danger); font-size: 0.8rem; font-weight: 700; }
    .now::before { content: ''; width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--danger); } .now::after { content: ''; flex: 1; height: 2px; background: var(--danger); }`,
})
export class Today {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private router = inject(Router);
  store = inject(TodoStore);

  label = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  nowLabel = formatTime(new Date().toISOString());
  loading = signal(true);
  error = signal('');
  overdue = signal<Todo[]>([]);
  slots = signal<Slot[]>([]);
  anytime = signal<Todo[]>([]);

  constructor() { effect(() => { this.store.version(); untracked(() => void this.load()); }); }

  time(d: Date) { return formatTime(d.toISOString()); }
  isPast(s: Slot) { return (s.end ?? s.at).getTime() < Date.now(); }
  soon() { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d.toISOString(); }

  /** Draws the "now" line before the first slot that starts after the current time. */
  nowIndex = computed(() => {
    const s = this.slots();
    if (!s.some((x) => !x.allDay)) return -1; // nothing timed: a "now" line would be meaningless
    const i = s.findIndex((x) => !x.allDay && x.at.getTime() > Date.now());
    return i === -1 ? s.length : i;
  });
  showNow(i: number) { return this.nowIndex() === i; }

  async load() {
    const start = startOfDay(), end = addDays(start, 1);
    try {
      this.loading.set(true);
      const [over, todos, events] = await Promise.all([
        this.api.todos({ overdue: true }),
        this.api.todos({ from: start.toISOString(), to: end.toISOString() }),
        this.api.events(start, end).catch(() => [] as CalendarEvent[]),
      ]);
      const timed: Slot[] = [];
      const loose: Todo[] = [];
      for (const t of todos) {
        const d = new Date(t.dueUtc!);
        if (d.getHours() === 0 && d.getMinutes() === 0) loose.push(t);
        else timed.push({ kind: 'todo', id: t.id, title: t.title, at: d, allDay: false, done: t.status === 'Completed', todo: t });
      }
      for (const e of events) {
        if (e.linkedTodoId) continue; // already shown as its task
        const s = new Date(e.startUtc);
        timed.push({ kind: 'event', id: e.id, title: e.title, at: e.allDay ? start : s, end: new Date(e.endUtc), allDay: e.allDay, done: false });
      }
      timed.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.at.getTime() - b.at.getTime());
      this.overdue.set(over); this.slots.set(timed); this.anytime.set(loose); this.error.set('');
    } catch { this.error.set('Could not load today.'); }
    finally { this.loading.set(false); }
  }

  async toggle(t: Todo) {
    try { if (t.status === 'Completed') await this.api.setTodoStatus(t.id, 'ToDo'); else await this.api.completeTodo(t.id); this.store.changed(); }
    catch (e) { this.toasts.error(e); }
  }
  focus(t: Todo) { this.router.navigate(['/focus', t.id]); }
}
