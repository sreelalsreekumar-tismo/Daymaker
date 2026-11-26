import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { fromLocalInput, toLocalInput } from '../core/dates';
import { Category, ChecklistItem, GoogleStatus, PRIORITIES, Priority, Recurrence, STATUSES, Todo, TodoStatus } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Confirm, Toasts } from '../core/ui.services';
import { Attachments } from '../shared/attachments';
import { Icon } from '../shared/icon';

/** Create/edit dialog for a todo. Opened through TodoStore so any page can launch it. */
@Component({
  selector: 'dm-todo-form',
  imports: [FormsModule, Icon, Attachments],
  template: `
    @if (store.editor(); as req) {
      <div class="scrim" (click)="cancel()">
        <form class="dlg card" (click)="$event.stopPropagation()" (keydown.escape)="cancel()" (ngSubmit)="save()" role="dialog" aria-modal="true"
              [attr.aria-label]="editing() ? 'Edit task' : 'New task'">
          <div class="row"><h2>{{ editing() ? 'Edit task' : 'New task' }}</h2><span class="spacer"></span>
            <button type="button" class="icon-btn" (click)="cancel()" aria-label="Close"><dm-icon name="x" /></button></div>

          <label class="field">Title
            <input type="text" name="title" [(ngModel)]="title" placeholder="What needs doing?" required autofocus maxlength="200" /></label>
          <label class="field">Description
            <textarea name="description" [(ngModel)]="description" placeholder="Details, links, context…"></textarea></label>

          <div class="grid2">
            <label class="field">Due <input type="datetime-local" name="due" [(ngModel)]="due" /></label>
            <label class="field">Reminder <input type="datetime-local" name="reminder" [(ngModel)]="reminder" /></label>
            <label class="field">Priority
              <select name="priority" [(ngModel)]="priority">@for (p of priorities; track p) { <option [value]="p">{{ p }}</option> }</select></label>
            <label class="field">Status
              <select name="status" [(ngModel)]="status">@for (s of statuses; track s.value) { <option [value]="s.value">{{ s.label }}</option> }</select></label>
            <label class="field">Category
              <select name="category" [(ngModel)]="categoryId">
                <option [ngValue]="null">None</option>
                @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
                <option [ngValue]="-1">+ New category…</option>
              </select></label>
            <label class="field">Repeats
              <select name="recurrence" [(ngModel)]="recurrence">
                <option value="None">Never</option><option value="Daily">Daily</option><option value="Weekly">Weekly</option><option value="Monthly">Monthly</option>
              </select></label>
          </div>
          @if (categoryId === -1) {
            <div class="row"><input type="text" name="newcat" [(ngModel)]="newCategory" placeholder="Category name" maxlength="40" />
              <button type="button" class="btn" (click)="addCategory()">Add</button></div>
          }

          <label class="field">Tags (comma separated)
            <input type="text" name="tags" [(ngModel)]="tagText" list="tag-list" placeholder="work, urgent" />
            <datalist id="tag-list">@for (t of allTags(); track t) { <option [value]="t"></option> }</datalist></label>

          <fieldset class="group"><legend>Checklist</legend>
            @for (c of checklist(); track $index) {
              <div class="row ck">
                <input type="checkbox" [checked]="c.done" (change)="toggleItem($index)" [attr.aria-label]="'Done: ' + c.text" />
                <input type="text" [value]="c.text" (input)="editItem($index, $any($event.target).value)" />
                <button type="button" class="icon-btn" (click)="removeItem($index)" aria-label="Remove item"><dm-icon name="x" [size]="14" /></button>
              </div>
            }
            <div class="row"><input type="text" name="newitem" [(ngModel)]="newItem" placeholder="Add checklist item" (keydown.enter)="$event.preventDefault(); addItem()" />
              <button type="button" class="btn" (click)="addItem()">Add</button></div>
          </fieldset>

          @if (editing()) {
            <fieldset class="group"><legend>Subtasks</legend>
              @for (s of subtasks(); track s.id) {
                <div class="row ck">
                  <input type="checkbox" [checked]="s.status === 'Completed'" (change)="toggleSub(s)" [attr.aria-label]="'Done: ' + s.title" />
                  <span [class.done]="s.status === 'Completed'">{{ s.title }}</span>
                  <span class="spacer"></span>
                  <button type="button" class="icon-btn" (click)="removeSub(s)" aria-label="Delete subtask"><dm-icon name="trash" [size]="14" /></button>
                </div>
              }
              <div class="row"><input type="text" name="newsub" [(ngModel)]="newSub" placeholder="Add subtask" (keydown.enter)="$event.preventDefault(); addSub()" />
                <button type="button" class="btn" (click)="addSub()">Add</button></div>
            </fieldset>
          }

          <fieldset class="group"><legend>Attachments</legend>
            <dm-attachments #att owner="Todo" [ownerId]="editing()?.id ?? null" />
          </fieldset>

          <label class="row check">
            <input type="checkbox" name="cal" [(ngModel)]="addToCalendar" [disabled]="!google()?.connected" />
            <span><dm-icon name="calendar" [size]="16" />
              {{ editing()?.googleEventId ? 'Synced with Google Calendar' : 'Add to Google Calendar' }}</span>
            @if (google() && !google()!.connected) { <a class="small" href="/settings" (click)="goSettings($event)">Connect Google</a> }
            @if (addToCalendar && !due) { <span class="err small">A due date is required.</span> }
          </label>

          @if (error()) { <p class="banner error small" role="alert">{{ error() }}</p> }

          <div class="row actions">
            @if (editing(); as t) {
              <button type="button" class="btn danger" (click)="remove()"><dm-icon name="trash" [size]="16" /> Delete</button>
              <button type="button" class="btn" (click)="saveAsNote()"><dm-icon name="note" [size]="16" /> Save as note</button>
            }
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="cancel()">Cancel</button>
            <button type="submit" class="btn primary" [disabled]="busy() || !title.trim()">{{ busy() ? 'Saving…' : 'Save' }}</button>
          </div>
        </form>
      </div>
    }`,
  styles: `
    .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 45%); display: grid; place-items: start center; z-index: 90; padding: 2rem 1rem; overflow-y: auto; }
    .dlg { width: min(100%, 640px); display: flex; flex-direction: column; gap: 0.8rem; box-shadow: var(--shadow-lg); }
    .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.7rem; }
    .group { border: 1px solid var(--border); border-radius: 10px; padding: 0.6rem 0.8rem; display: flex; flex-direction: column; gap: 0.4rem; }
    legend { padding: 0 0.3rem; color: var(--muted); font-size: 0.85rem; }
    .ck { flex-wrap: nowrap; } .done { text-decoration: line-through; color: var(--muted); }
    .check { gap: 0.5rem; } .actions { position: sticky; bottom: 0; background: var(--surface); padding-top: 0.5rem; }`,
})
export class TodoForm {
  store = inject(TodoStore);
  private api = inject(Api);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private router = inject(Router);
  private att = viewChild<Attachments>('att');

  priorities = PRIORITIES;
  statuses = STATUSES;
  editing = signal<Todo | null>(null);
  categories = signal<Category[]>([]);
  allTags = signal<string[]>([]);
  google = signal<GoogleStatus | null>(null);
  subtasks = signal<Todo[]>([]);
  checklist = signal<ChecklistItem[]>([]);
  busy = signal(false);
  error = signal('');

  title = ''; description = ''; due = ''; reminder = '';
  priority: Priority = 'Medium'; status: TodoStatus = 'ToDo'; recurrence: Recurrence = 'None';
  categoryId: number | null = null; tagText = ''; addToCalendar = false;
  newItem = ''; newSub = ''; newCategory = '';

  constructor() {
    effect(() => {
      const req = this.store.editor();
      if (!req) return;
      const t = req.todo ?? null;
      const d = req.defaults ?? {};
      this.editing.set(t);
      this.title = t?.title ?? d.title ?? '';
      this.description = t?.description ?? d.description ?? '';
      this.due = toLocalInput(t?.dueUtc ?? d.dueUtc);
      this.reminder = toLocalInput(t?.reminderUtc ?? d.reminderUtc);
      this.priority = t?.priority ?? d.priority ?? 'Medium';
      this.status = t?.status ?? d.status ?? 'ToDo';
      this.recurrence = t?.recurrence ?? d.recurrence ?? 'None';
      this.categoryId = t?.categoryId ?? d.categoryId ?? null;
      this.tagText = (t?.tags ?? d.tags ?? []).join(', ');
      this.addToCalendar = !!t?.googleEventId || !!d.addToCalendar;
      this.checklist.set((t?.checklist ?? d.checklist ?? []).map((c) => ({ ...c })));
      this.subtasks.set([]);
      this.error.set('');
      this.newItem = this.newSub = this.newCategory = '';
      void this.loadLookups(t);
    });
  }

  private async loadLookups(t: Todo | null) {
    try {
      const [cats, tags, g, subs] = await Promise.all([
        this.api.categories(), this.api.tags(), this.api.googleStatus().catch(() => null), t ? this.api.subtasks(t.id) : Promise.resolve([]),
      ]);
      this.categories.set(cats); this.allTags.set(tags); this.google.set(g); this.subtasks.set(subs);
    } catch (e) { this.toasts.error(e); }
  }

  async addCategory() {
    const name = this.newCategory.trim();
    if (!name) return;
    try {
      const c = await this.api.createCategory(name, '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'));
      this.categories.update((l) => [...l, c]);
      this.categoryId = c.id; this.newCategory = '';
    } catch (e) { this.toasts.error(e); }
  }

  addItem() {
    const text = this.newItem.trim();
    if (!text) return;
    this.checklist.update((l) => [...l, { text, done: false }]);
    this.newItem = '';
  }
  editItem(i: number, text: string) { this.checklist.update((l) => l.map((c, n) => (n === i ? { ...c, text } : c))); }
  toggleItem(i: number) { this.checklist.update((l) => l.map((c, n) => (n === i ? { ...c, done: !c.done } : c))); }
  removeItem(i: number) { this.checklist.update((l) => l.filter((_, n) => n !== i)); }

  async addSub() {
    const parent = this.editing(); const title = this.newSub.trim();
    if (!parent || !title) return;
    try {
      await this.api.createTodo({ title, parentId: parent.id });
      this.newSub = '';
      this.subtasks.set(await this.api.subtasks(parent.id));
      this.store.changed();
    } catch (e) { this.toasts.error(e); }
  }
  async toggleSub(s: Todo) {
    try {
      if (s.status === 'Completed') await this.api.setTodoStatus(s.id, 'ToDo'); else await this.api.completeTodo(s.id);
      this.subtasks.set(await this.api.subtasks(this.editing()!.id));
      this.store.changed();
    } catch (e) { this.toasts.error(e); }
  }
  async removeSub(s: Todo) {
    try { await this.api.deleteTodo(s.id); this.subtasks.update((l) => l.filter((x) => x.id !== s.id)); this.store.changed(); }
    catch (e) { this.toasts.error(e); }
  }

  async save() {
    if (!this.title.trim() || this.busy()) return;
    if (this.addToCalendar && !this.due) { this.error.set('Pick a due date to add this task to Google Calendar.'); return; }
    this.busy.set(true); this.error.set('');
    const tags = this.tagText.split(',').map((t) => t.trim()).filter(Boolean);
    const input = {
      title: this.title.trim(), description: this.description, dueUtc: fromLocalInput(this.due), reminderUtc: fromLocalInput(this.reminder),
      priority: this.priority, status: this.status, recurrence: this.recurrence,
      categoryId: this.categoryId === -1 ? null : this.categoryId, tags, checklist: this.checklist().filter((c) => c.text.trim()),
      addToCalendar: this.addToCalendar,
    };
    try {
      const t = this.editing();
      const saved = t ? await this.api.updateTodo(t.id, input) : await this.api.createTodo(input);
      await this.att()?.flush(saved.id);
      this.store.changed();
      if (saved.syncError) this.toasts.show(saved.syncError, 'error');
      else this.toasts.show(t ? 'Task saved' : 'Task created');
      this.store.close();
    } catch (e) {
      this.toasts.error(e, 'Could not save the task');
      this.error.set('Your changes were not saved. Please try again.');
    } finally { this.busy.set(false); }
  }

  async remove() {
    const t = this.editing();
    if (!t || !(await this.confirm.ask(`Delete "${t.title}"? This also removes its subtasks${t.googleEventId ? ' and Google Calendar event' : ''}.`))) return;
    try { await this.api.deleteTodo(t.id); this.store.changed(); this.store.close(); this.toasts.show('Task deleted'); }
    catch (e) { this.toasts.error(e); }
  }

  async saveAsNote() {
    const t = this.editing();
    if (!t) return;
    try {
      const n = await this.api.noteFromTodo(t.id);
      this.store.close();
      this.toasts.show('Saved as note');
      this.router.navigate(['/notes'], { queryParams: { open: n.id } });
    } catch (e) { this.toasts.error(e); }
  }

  goSettings(e: Event) { e.preventDefault(); this.store.close(); this.router.navigateByUrl('/settings'); }
  cancel() { this.store.close(); }
}
