import { Component, OnDestroy, effect, inject, input, output, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { formatDue, isOverdue } from '../core/dates';
import { Todo } from '../core/models';
import { Icon } from '../shared/icon';

/** One todo, rendered as a compact row, a rich card (with first image) or a kanban card. */
@Component({
  selector: 'dm-todo-card',
  imports: [Icon],
  template: `
    <article class="item {{ mode() }}" [class.done]="done()" [class.overdue]="overdue()">
      <input type="checkbox" [checked]="done()" (change)="toggle.emit(todo())" [attr.aria-label]="(done() ? 'Mark not done: ' : 'Mark done: ') + todo().title" />
      <div class="body" (click)="open.emit(todo())" tabindex="0" (keydown.enter)="open.emit(todo())" role="button">
        @if (mode() === 'card' && thumb()) { <img class="thumb" [src]="thumb()" alt="" /> }
        <div class="title">{{ todo().title }}</div>
        @if (mode() === 'card' && todo().description) { <p class="desc">{{ todo().description }}</p> }
        <div class="meta">
          @if (todo().priority === 'High' || todo().priority === 'Urgent') { <span class="chip p-{{ todo().priority }}"><dm-icon name="flag" [size]="12" />{{ todo().priority }}</span> }
          @if (todo().dueUtc) { <span class="chip" [class.overdue]="overdue()"><dm-icon name="clock" [size]="12" />{{ due() }}</span> }
          @if (todo().categoryName) { <span class="chip"><span class="dot" [style.background]="todo().categoryColor"></span>{{ todo().categoryName }}</span> }
          @for (t of todo().tags; track t) { <span class="chip">#{{ t }}</span> }
          @if (todo().checklist.length) { <span class="chip"><dm-icon name="check" [size]="12" />{{ checked() }}/{{ todo().checklist.length }}</span> }
          @if (todo().subtaskCount) { <span class="chip">{{ todo().subtasksDone }}/{{ todo().subtaskCount }} subtasks</span> }
          @if (todo().attachmentCount) { <span class="chip" title="Attachments"><dm-icon name="paperclip" [size]="12" />{{ todo().attachmentCount }}</span> }
          @if (todo().recurrence !== 'None') { <span class="chip" [title]="'Repeats ' + todo().recurrence.toLowerCase()"><dm-icon name="repeat" [size]="12" /></span> }
          @if (todo().googleEventId) { <span class="chip meeting" title="Synced with Google Calendar"><dm-icon name="calendar" [size]="12" /></span> }
        </div>
      </div>
      <button class="icon-btn focus" (click)="focus.emit(todo())" aria-label="Focus on this task" title="Focus"><dm-icon name="target" [size]="16" /></button>
    </article>`,
  styles: `
    .item { display: flex; gap: 0.8rem; align-items: flex-start; background: var(--surface); padding: var(--pad); border-radius: var(--radius); box-shadow: var(--shadow); transition: transform 0.2s var(--ease), box-shadow 0.2s; }
    .item:hover { box-shadow: 0 0 0 0.5px rgb(0 0 0 / 6%), 0 6px 20px rgb(0 0 0 / 8%); }
    .item.row { border-radius: 12px; padding-block: calc(var(--pad) * 0.75); align-items: center; }
    .item.overdue input[type='checkbox'] { border-color: var(--danger); }
    .item.done .title { text-decoration: line-through; color: var(--muted); }
    .body { flex: 1; min-width: 0; cursor: pointer; display: flex; flex-direction: column; gap: 0.35rem; }
    .row .body { flex-direction: row; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
    .row .title { flex: 1 1 14rem; }
    .title { font-weight: 600; overflow-wrap: anywhere; }
    .desc { margin: 0; color: var(--muted); font-size: 0.9rem; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
    .meta { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .thumb { width: 100%; max-height: 150px; object-fit: cover; border-radius: 8px; }
    .focus { opacity: 0; } .item:hover .focus, .focus:focus-visible { opacity: 1; }
    @media (hover: none) { .focus { opacity: 1; } }
    input[type='checkbox'] { margin-top: 0.2rem; flex: none; }`,
})
export class TodoCard implements OnDestroy {
  private api = inject(Api);
  todo = input.required<Todo>();
  mode = input<'row' | 'card' | 'kanban'>('row');
  toggle = output<Todo>();
  open = output<Todo>();
  focus = output<Todo>();
  thumb = signal<string | null>(null);

  constructor() {
    effect(() => {
      const t = this.todo();
      if (this.mode() === 'card' && t.attachmentCount > 0) void this.loadThumb(t.id);
      else this.clear();
    });
  }

  done() { return this.todo().status === 'Completed'; }
  overdue() { return isOverdue(this.todo().dueUtc, this.done()); }
  due() { return formatDue(this.todo().dueUtc); }
  checked() { return this.todo().checklist.filter((c) => c.done).length; }

  private async loadThumb(id: number) {
    try {
      const img = (await this.api.attachments('Todo', id)).find((a) => a.contentType.startsWith('image/'));
      if (!img) return;
      this.clear();
      this.thumb.set(URL.createObjectURL(await this.api.attachmentBlob(img.id)));
    } catch { /* thumbnails are optional */ }
  }
  private clear() { const u = this.thumb(); if (u) URL.revokeObjectURL(u); this.thumb.set(null); }
  ngOnDestroy() { this.clear(); }
}
