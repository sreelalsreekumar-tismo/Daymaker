import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { addDays, formatTime, startOfDay } from '../core/dates';
import { CalendarEvent, Todo } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Toasts } from '../core/ui.services';
import { Icon } from '../shared/icon';
import { TodoCard } from '../todos/todo-card';

@Component({
  selector: 'dm-dashboard',
  imports: [FormsModule, Icon, TodoCard],
  template: `
    <div class="page">
      <div class="page-head"><div><h1>{{ greeting() }}, {{ firstName() }}</h1><span class="muted">{{ today }}</span></div></div>

      <form class="card quick row" (ngSubmit)="quickAdd()">
        <dm-icon name="plus" /><input type="text" name="q" [(ngModel)]="quick" placeholder="Quick add a task — press Enter" aria-label="Quick add a task" />
        <button class="btn primary" type="submit" [disabled]="!quick.trim()">Add</button>
      </form>

      @if (error()) { <div class="banner error row" role="alert">{{ error() }} <button class="btn sm" (click)="load()">Retry</button></div> }

      <div class="stats">
        <div class="card stat"><span class="n">{{ today_().length }}</span><span class="muted">Due today</span></div>
        <div class="card stat" [class.bad]="overdue().length"><span class="n">{{ overdue().length }}</span><span class="muted">Overdue</span></div>
        <div class="card stat"><span class="n">{{ meetings().length }}</span><span class="muted">Meetings today</span></div>
        <div class="card stat"><span class="n">{{ upcoming().length }}</span><span class="muted">Next 7 days</span></div>
      </div>

      <div class="cols">
        <section class="stack">
          @if (overdue().length) {
            <h2 class="err">Overdue</h2>
            @for (t of overdue(); track t.id) { <dm-todo-card [todo]="t" mode="row" (toggle)="toggle($event)" (open)="store.openEdit($event)" (focus)="focus($event)" /> }
          }
          <h2>Today</h2>
          @for (t of today_(); track t.id) { <dm-todo-card [todo]="t" mode="row" (toggle)="toggle($event)" (open)="store.openEdit($event)" (focus)="focus($event)" /> }
          @if (!today_().length) { <p class="muted card empty">Nothing due today. Enjoy the calm, or plan ahead.</p> }
          @if (upcoming().length) {
            <h2>Coming up</h2>
            @for (t of upcoming(); track t.id) { <dm-todo-card [todo]="t" mode="row" (toggle)="toggle($event)" (open)="store.openEdit($event)" (focus)="focus($event)" /> }
          }
        </section>
        <aside class="stack">
          <h2>Meetings</h2>
          @for (e of meetings(); track e.id) {
            <div class="card ev"><span class="chip meeting"><dm-icon name="calendar" [size]="12" /> {{ e.allDay ? 'All day' : time(e.startUtc) }}</span> <strong>{{ e.title }}</strong></div>
          }
          @if (!meetings().length) { <p class="muted card empty">No meetings today.</p> }
          <h2>Pinned notes</h2>
          @for (n of notes(); track n.id) {
            <button class="card note" (click)="openNote(n.id)">{{ n.title }}</button>
          }
          @if (!notes().length) { <p class="muted card empty">Pin a note to see it here.</p> }
        </aside>
      </div>
    </div>`,
  styles: `
    .quick { margin-bottom: 1rem; flex-wrap: nowrap; } .quick input { border: 0; background: transparent; flex: 1; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--gap); margin-bottom: 1.25rem; }
    .stat { display: flex; flex-direction: column; } .n { font-size: 1.8rem; font-weight: 700; } .stat.bad .n { color: var(--danger); }
    .cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
    @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
    h2 { margin-top: 0.5rem; } .ev { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
    .note { text-align: left; cursor: pointer; font-weight: 600; } .note:hover { background: var(--surface-2); }`,
})
export class Dashboard {
  private api = inject(Api);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toasts = inject(Toasts);
  store = inject(TodoStore);

  today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  quick = '';
  error = signal('');
  overdue = signal<Todo[]>([]);
  today_ = signal<Todo[]>([]);
  upcoming = signal<Todo[]>([]);
  meetings = signal<CalendarEvent[]>([]);
  notes = signal<{ id: number; title: string }[]>([]);

  constructor() { effect(() => { this.store.version(); untracked(() => void this.load()); }); }

  firstName() { return (this.auth.user()?.name ?? '').replace(/^Dev /, '').split(' ')[0]; }
  greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  time(iso: string) { return formatTime(iso); }

  async load() {
    const start = startOfDay(), end = addDays(start, 1);
    try {
      const [over, open, events, pinned] = await Promise.all([
        this.api.todos({ overdue: true }),
        this.api.todos({ status: '', from: start.toISOString(), to: addDays(start, 7).toISOString() }),
        this.api.events(start, end).catch(() => [] as CalendarEvent[]),
        this.api.notes({ pinned: true }).catch(() => []),
      ]);
      const live = open.filter((t) => t.status !== 'Completed');
      this.overdue.set(over);
      this.today_.set(live.filter((t) => new Date(t.dueUtc!) < end));
      this.upcoming.set(live.filter((t) => new Date(t.dueUtc!) >= end));
      this.meetings.set(events);
      this.notes.set(pinned.slice(0, 5));
      this.error.set('');
    } catch { this.error.set('Could not load your dashboard.'); }
  }

  async quickAdd() {
    const title = this.quick.trim();
    if (!title) return;
    try {
      const due = new Date(); due.setHours(17, 0, 0, 0);
      await this.api.createTodo({ title, dueUtc: due.toISOString() });
      this.quick = '';
      this.store.changed();
      this.toasts.show('Task added for today');
    } catch (e) { this.toasts.error(e, 'Could not add the task'); }
  }

  async toggle(t: Todo) {
    try { if (t.status === 'Completed') await this.api.setTodoStatus(t.id, 'ToDo'); else await this.api.completeTodo(t.id); this.store.changed(); }
    catch (e) { this.toasts.error(e); }
  }
  focus(t: Todo) { this.router.navigate(['/focus', t.id]); }
  openNote(id: number) { this.router.navigate(['/notes'], { queryParams: { open: id } }); }
}
