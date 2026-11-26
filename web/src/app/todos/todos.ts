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
import { Option, Select } from '../shared/select';
import { TodoCard } from './todo-card';

@Component({
  selector: 'dm-todos',
  imports: [FormsModule, Icon, Select, TodoCard, CdkDropListGroup, CdkDropList, CdkDrag],
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
        <dm-select [options]="statusOptions" [(ngModel)]="status" (ngModelChange)="reload()" ariaLabel="Status" />
        <dm-select [options]="priorityOptions" [(ngModel)]="priority" (ngModelChange)="reload()" ariaLabel="Priority" />
        <dm-select [options]="dueOptions" [(ngModel)]="due" (ngModelChange)="reload()" ariaLabel="Due" />
        <dm-select [options]="categoryOptions()" [(ngModel)]="categoryId" (ngModelChange)="reload()" ariaLabel="Category" />
        <dm-select [options]="tagOptions()" [(ngModel)]="tag" (ngModelChange)="reload()" ariaLabel="Tag" />
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
                <!-- the whole column (header, padding and empty space) is the drop target -->
                <section class="col" cdkDropList [cdkDropListData]="columns()[col.value]" (cdkDropListDropped)="drop($event, col.value)"
                         [attr.aria-label]="col.label + ' column'">
                  <h3><span class="dot s-{{ col.value }}"></span>{{ col.label }} <span class="chip">{{ columns()[col.value].length }}</span></h3>
                  <div class="drop">
                    @for (t of columns()[col.value]; track t.id) {
                      <div cdkDrag [cdkDragData]="t" class="drag"><dm-todo-card [todo]="t" mode="kanban" (toggle)="toggle($event)" (open)="store.openEdit($event)" (focus)="focusOn($event)" /></div>
                    }
                    @if (!columns()[col.value].length) { <p class="hint muted small">Drag tasks here</p> }
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
    .board { display: grid; grid-template-columns: repeat(3, minmax(260px, 1fr)); gap: var(--gap); overflow-x: auto; align-items: stretch; padding-bottom: 0.5rem; }
    .col { display: flex; flex-direction: column; background: var(--surface-2); border-radius: var(--radius); padding: 0.7rem; min-width: 260px; min-height: max(22rem, 55vh); transition: background 0.2s var(--ease), box-shadow 0.2s; }
    .col h3 { display: flex; align-items: center; gap: 0.5rem; margin: 0.2rem 0.3rem 0.7rem; }
    .dot.s-ToDo { background: var(--muted); } .dot.s-InProgress { background: var(--warn); } .dot.s-Completed { background: var(--ok); }
    .drop { display: flex; flex-direction: column; gap: 0.55rem; flex: 1; }
    .drag { cursor: grab; } .hint { text-align: center; margin: 2rem 0; pointer-events: none; }
    /* column highlights while a card is being dragged over it */
    .col.cdk-drop-list-receiving, .col.cdk-drop-list-dragging { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); }
    .col.cdk-drop-list-dragging { background: color-mix(in srgb, var(--accent) 9%, var(--surface-2)); }
    .col.cdk-drop-list-dragging .hint, .col.cdk-drop-list-receiving .hint { visibility: hidden; }`,
})
export class Todos {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private router = inject(Router);
  private prefs = inject(PreferencesService);
  store = inject(TodoStore);

  statuses = STATUSES;
  statusOptions: Option[] = [{ value: '', label: 'Any status' }, ...STATUSES.map((s) => ({ value: s.value, label: s.label }))];
  priorityOptions: Option[] = [{ value: '', label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p, label: p }))];
  dueOptions: Option[] = [{ value: '', label: 'Any date' }, { value: 'today', label: 'Due today' }, { value: 'week', label: 'Next 7 days' }, { value: 'overdue', label: 'Overdue' }];
  categoryOptions = computed<Option[]>(() => [{ value: null, label: 'Any category' }, ...this.categories().map((c) => ({ value: c.id, label: c.name }))]);
  tagOptions = computed<Option[]>(() => [{ value: '', label: 'Any tag' }, ...this.tags().map((t) => ({ value: t, label: '#' + t }))]);
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
    if (ev.previousContainer === ev.container && ev.previousIndex === ev.currentIndex) return; // dropped back where it started
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
      if (moved.status !== target) this.toasts.show(target === 'Completed' ? `Completed “${moved.title}”` : `Moved to ${STATUSES.find((s) => s.value === target)!.label}`);
      if (target === 'Completed' || moved.status === 'Completed') this.store.changed(); // recurring tasks may spawn a new one
    } catch (e) { this.toasts.error(e, 'Could not move the task'); void this.reload(); }
  }
}
