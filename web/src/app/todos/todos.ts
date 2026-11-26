import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { addDays, startOfDay } from '../core/dates';
import { Category, PRIORITIES, STATUSES, Todo, TodoStatus } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { PreferencesService, Toasts } from '../core/ui.services';
import { Icon } from '../shared/icon';
import { TodoCard } from './todo-card';

@Component({
  selector: 'dm-todos',
  imports: [FormsModule, Icon, TodoCard, CdkDropListGroup, CdkDropList, CdkDrag],
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Todos</h1><span class="spacer"></span>
        <div class="seg" role="group" aria-label="Layout">
          <button [class.on]="layout() === 'list'" (click)="setLayout('list')" title="List view"><dm-icon name="list" /></button>
          <button [class.on]="layout() === 'grid'" (click)="setLayout('grid')" title="Card view"><dm-icon name="grid" /></button>
          <button [class.on]="layout() === 'kanban'" (click)="setLayout('kanban')" title="Kanban view"><dm-icon name="columns" /></button>
        </div>
        <button class="btn primary" (click)="store.openNew()"><dm-icon name="plus" /> New task</button>
      </div>

      <div class="filters card">
        <input type="search" [(ngModel)]="q" (ngModelChange)="queryChanged()" placeholder="Filter by text…" aria-label="Filter by text" />
        <select [(ngModel)]="status" (ngModelChange)="reload()" aria-label="Status">
          <option value="">Any status</option>@for (s of statuses; track s.value) { <option [value]="s.value">{{ s.label }}</option> }</select>
        <select [(ngModel)]="priority" (ngModelChange)="reload()" aria-label="Priority">
          <option value="">Any priority</option>@for (p of priorities; track p) { <option [value]="p">{{ p }}</option> }</select>
        <select [(ngModel)]="due" (ngModelChange)="reload()" aria-label="Due">
          <option value="">Any date</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="overdue">Overdue</option></select>
        <select [(ngModel)]="categoryId" (ngModelChange)="reload()" aria-label="Category">
          <option [ngValue]="null">Any category</option>@for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }</select>
        <select [(ngModel)]="tag" (ngModelChange)="reload()" aria-label="Tag">
          <option value="">Any tag</option>@for (t of tags(); track t) { <option [value]="t">#{{ t }}</option> }</select>
        @if (filtered()) { <button class="btn ghost sm" (click)="clearFilters()">Clear</button> }
      </div>

      @if (error()) {
        <div class="banner error row" role="alert">{{ error() }} <button class="btn sm" (click)="reload()">Retry</button></div>
      } @else if (loading() && !todos().length) {
        <p class="muted empty">Loading…</p>
      } @else if (!todos().length) {
        <div class="empty card">
          <p>{{ filtered() ? 'No tasks match these filters.' : 'No tasks yet. Add your first one!' }}</p>
          @if (!filtered()) { <button class="btn primary" (click)="store.openNew()"><dm-icon name="plus" /> New task</button> }
        </div>
      } @else {
        @switch (layout()) {
          @case ('list') {
            <div class="stack">
              @for (t of todos(); track t.id) {
                <dm-todo-card [todo]="t" mode="row" (toggle)="toggle($event)" (open)="store.openEdit($event)" (focus)="focusOn($event)" />
              }
            </div>
          }
          @case ('grid') {
            <div class="grid">
              @for (t of todos(); track t.id) {
                <dm-todo-card [todo]="t" mode="card" (toggle)="toggle($event)" (open)="store.openEdit($event)" (focus)="focusOn($event)" />
              }
            </div>
          }
          @case ('kanban') {
            <div class="board" cdkDropListGroup>
              @for (col of statuses; track col.value) {
                <section class="col">
                  <h3>{{ col.label }} <span class="chip">{{ columns()[col.value].length }}</span></h3>
                  <div class="drop" cdkDropList [cdkDropListData]="columns()[col.value]" (cdkDropListDropped)="drop($event, col.value)">
                    @for (t of columns()[col.value]; track t.id) {
                      <div cdkDrag [cdkDragData]="t"><dm-todo-card [todo]="t" mode="kanban" (toggle)="toggle($event)" (open)="store.openEdit($event)" (focus)="focusOn($event)" /></div>
                    }
                    @if (!columns()[col.value].length) { <p class="muted small empty">Drop tasks here</p> }
                  </div>
                </section>
              }
            </div>
          }
        }
      }
    </div>`,
  styles: `
    .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.5rem; margin-bottom: 1rem; align-items: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--gap); align-items: start; }
    .board { display: grid; grid-template-columns: repeat(3, minmax(250px, 1fr)); gap: var(--gap); overflow-x: auto; align-items: start; padding-bottom: 0.5rem; }
    .col { background: var(--surface-2); border-radius: var(--radius); padding: 0.6rem; min-width: 250px; }
    .col h3 { display: flex; align-items: center; gap: 0.5rem; margin: 0.2rem 0.3rem 0.6rem; }
    .drop { display: flex; flex-direction: column; gap: 0.5rem; min-height: 5rem; }
    .cdk-drag-preview { box-shadow: var(--shadow-lg); border-radius: var(--radius); }
    .cdk-drag-placeholder { opacity: 0.35; }
    .cdk-drag-animating { transition: transform 200ms; }`,
})
export class Todos {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private router = inject(Router);
  private prefs = inject(PreferencesService);
  store = inject(TodoStore);

  statuses = STATUSES;
  priorities = PRIORITIES;
  layout = computed(() => this.prefs.prefs().todoLayout);

  todos = signal<Todo[]>([]);
  categories = signal<Category[]>([]);
  tags = signal<string[]>([]);
  loading = signal(true);
  error = signal('');

  q = ''; status = ''; priority = ''; due = ''; categoryId: number | null = null; tag = '';
  private timer?: ReturnType<typeof setTimeout>;

  columns = computed(() => {
    const by: Record<TodoStatus, Todo[]> = { ToDo: [], InProgress: [], Completed: [] };
    for (const t of this.todos()) by[t.status].push(t);
    return by;
  });

  constructor() {
    // reload whenever any page/dialog reports a change
    effect(() => { this.store.version(); untracked(() => void this.reload()); });
    void Promise.all([this.api.categories(), this.api.tags()]).then(([c, t]) => { this.categories.set(c); this.tags.set(t); }).catch(() => {});
  }

  filtered() { return !!(this.q || this.status || this.priority || this.due || this.categoryId || this.tag); }
  clearFilters() { this.q = this.status = this.priority = this.due = this.tag = ''; this.categoryId = null; void this.reload(); }
  queryChanged() { clearTimeout(this.timer); this.timer = setTimeout(() => this.reload(), 250); }
  setLayout(l: 'list' | 'grid' | 'kanban') { this.prefs.update({ todoLayout: l }); }

  async reload() {
    const today = startOfDay();
    const range = this.due === 'today' ? { from: today.toISOString(), to: addDays(today, 1).toISOString() }
      : this.due === 'week' ? { from: today.toISOString(), to: addDays(today, 7).toISOString() } : {};
    try {
      this.loading.set(true);
      this.todos.set(await this.api.todos({
        status: this.status, priority: this.priority, categoryId: this.categoryId, tag: this.tag, q: this.q.trim(),
        overdue: this.due === 'overdue' ? true : null, ...range,
      }));
      this.error.set('');
    } catch { this.error.set('Could not load your tasks.'); }
    finally { this.loading.set(false); }
  }

  async toggle(t: Todo) {
    try {
      if (t.status === 'Completed') await this.api.setTodoStatus(t.id, 'ToDo'); else await this.api.completeTodo(t.id);
      this.store.changed();
    } catch (e) { this.toasts.error(e, 'Could not update the task'); }
  }

  focusOn(t: Todo) { this.router.navigate(['/focus', t.id]); }

  async drop(ev: CdkDragDrop<Todo[]>, target: TodoStatus) {
    const moved: Todo = ev.item.data;
    const cols = structuredClone(this.columns()) as Record<TodoStatus, Todo[]>;
    const from = cols[moved.status];
    const to = cols[target];
    const idx = from.findIndex((x) => x.id === moved.id);
    from.splice(idx, 1);
    to.splice(ev.currentIndex, 0, { ...moved, status: target });
    // optimistic update, then persist the new column order
    this.todos.set([...cols.ToDo, ...cols.InProgress, ...cols.Completed]);
    try {
      await this.api.setTodoStatus(moved.id, target, ev.currentIndex);
      await Promise.all(to.filter((x) => x.id !== moved.id).map((x, i) => this.api.setTodoStatus(x.id, x.status, i >= ev.currentIndex ? i + 1 : i)));
      if (target === 'Completed' || moved.status === 'Completed') this.store.changed();
    } catch (e) { this.toasts.error(e, 'Could not move the task'); void this.reload(); }
  }
}
