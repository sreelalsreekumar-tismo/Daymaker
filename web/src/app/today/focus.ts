import { Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { formatDue } from '../core/dates';
import { Todo, TodoInput } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Toasts } from '../core/ui.services';
import { Icon } from '../shared/icon';

const PRESETS = [{ label: '25 min', s: 25 * 60 }, { label: '50 min', s: 50 * 60 }, { label: 'Stopwatch', s: 0 }];

function toInput(t: Todo, patch: Partial<TodoInput> = {}): TodoInput {
  return {
    title: t.title, description: t.description, dueUtc: t.dueUtc, reminderUtc: t.reminderUtc, priority: t.priority, status: t.status,
    categoryId: t.categoryId, recurrence: t.recurrence, tags: t.tags, checklist: t.checklist, ...patch,
  };
}

/** Focus mode: one task, a timer, its notes and checklist, and a one-click way to finish it. */
@Component({
  selector: 'dm-focus',
  imports: [FormsModule, Icon, RouterLink],
  template: `
    <div class="wrap">
      <div class="row"><a routerLink="/todos" class="btn ghost sm">← Back</a><span class="spacer"></span>
        <span class="muted small">Focus mode</span></div>

      @if (error()) { <div class="banner error">{{ error() }}</div> }
      @else if (todo(); as t) {
        <div class="card stack main">
          <h1 [class.done]="t.status === 'Completed'">{{ t.title }}</h1>
          <div class="row">
            @if (t.dueUtc) { <span class="chip">Due {{ due() }}</span> }
            <span class="chip p-{{ t.priority }}">{{ t.priority }}</span>
            @if (t.categoryName) { <span class="chip">{{ t.categoryName }}</span> }
          </div>

          <div class="timer" role="timer" aria-live="off">
            <div class="clock" [class.over]="overtime()">{{ clock() }}</div>
            <div class="row" style="justify-content:center">
              @for (p of presets; track p.label) { <button class="btn sm" [class.primary]="preset() === p.s" (click)="setPreset(p.s)" [disabled]="running()">{{ p.label }}</button> }
            </div>
            <div class="row" style="justify-content:center">
              @if (!running()) { <button class="btn primary" (click)="start()"><dm-icon name="play" /> {{ elapsed() ? 'Resume' : 'Start' }}</button> }
              @else { <button class="btn" (click)="pause()"><dm-icon name="pause" /> Pause</button> }
              <button class="btn ghost" (click)="reset()" [disabled]="!elapsed()">Reset</button>
            </div>
            @if (overtime()) { <p class="small muted" style="text-align:center">Time's up — finish, or keep going.</p> }
          </div>

          @if (t.checklist.length) {
            <div class="stack"><h3>Checklist</h3>
              @for (c of t.checklist; track c.id) {
                <label class="row"><input type="checkbox" [checked]="c.done" (change)="toggleItem(c.id!, $any($event.target).checked)" /> <span [class.done]="c.done">{{ c.text }}</span></label>
              }
            </div>
          }

          <label class="field">Task notes <span class="muted">{{ savedNote() ? '· saved' : '' }}</span>
            <textarea [(ngModel)]="notes" (blur)="saveNotes()" rows="5" placeholder="Jot down thoughts while you work…"></textarea></label>

          <div class="row">
            <button class="btn" (click)="store.openEdit(t)">Edit details</button>
            <span class="spacer"></span>
            @if (t.status !== 'Completed') { <button class="btn primary" (click)="complete()" [disabled]="busy()"><dm-icon name="check" /> Mark complete</button> }
            @else { <span class="chip meeting">Completed</span> }
          </div>
        </div>
      } @else { <p class="muted empty">Loading…</p> }
    </div>`,
  styles: `
    .wrap { max-width: 640px; margin: 0 auto; padding: 1.25rem 1rem 3rem; display: flex; flex-direction: column; gap: 1rem; }
    .main { gap: 1rem; padding: 1.5rem; } h1.done, .done { text-decoration: line-through; color: var(--muted); }
    .timer { display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem; background: var(--surface-2); border-radius: var(--radius); }
    .clock { font-size: 3.4rem; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; } .clock.over { color: var(--warn); }`,
})
export class Focus implements OnDestroy {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private router = inject(Router);
  store = inject(TodoStore);

  /** Route param (/focus/:id) via component input binding. */
  id = input.required<string>();
  presets = PRESETS;
  todo = signal<Todo | null>(null);
  error = signal('');
  busy = signal(false);
  savedNote = signal(false);
  notes = '';

  preset = signal(25 * 60);   // 0 = stopwatch
  elapsed = signal(0);        // seconds
  running = signal(false);
  private tick?: ReturnType<typeof setInterval>;
  private startedAt = 0;
  private base = 0;

  overtime = computed(() => this.preset() > 0 && this.elapsed() > this.preset());
  clock = computed(() => {
    const p = this.preset();
    const secs = p ? Math.abs(p - this.elapsed()) : this.elapsed();
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return `${this.overtime() ? '+' : ''}${h ? h + ':' : ''}${mm}:${ss}`;
  });

  constructor() {
    effect(() => { const id = Number(this.id()); untracked(() => void this.load(id)); });
    effect(() => { document.title = this.running() ? `${this.clock()} · Focus · Daymaker` : 'Focus · Daymaker'; });
  }

  due() { return formatDue(this.todo()?.dueUtc ?? null); }

  async load(id: number) {
    this.pause();
    try {
      const t = await this.api.todo(id);
      this.todo.set(t); this.notes = t.description; this.error.set('');
      const saved = this.readTimer(id);
      this.preset.set(saved?.preset ?? 25 * 60); this.elapsed.set(saved?.elapsed ?? 0); this.base = saved?.elapsed ?? 0;
    } catch { this.error.set('This task could not be found. It may have been deleted.'); }
  }

  setPreset(s: number) { this.preset.set(s); this.persist(); }

  async start() {
    this.startedAt = Date.now(); this.base = this.elapsed(); this.running.set(true);
    this.tick = setInterval(() => { this.elapsed.set(this.base + Math.floor((Date.now() - this.startedAt) / 1000)); this.persist(); }, 500);
    const t = this.todo();
    if (t && t.status === 'ToDo') {
      try { await this.api.setTodoStatus(t.id, 'InProgress'); this.todo.set({ ...t, status: 'InProgress' }); this.store.changed(); } catch { /* timer still works */ }
    }
  }
  pause() { clearInterval(this.tick); this.running.set(false); this.base = this.elapsed(); this.persist(); }
  reset() { this.pause(); this.elapsed.set(0); this.base = 0; this.persist(); }

  async toggleItem(itemId: number, done: boolean) {
    const t = this.todo();
    if (!t) return;
    this.todo.set({ ...t, checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, done } : c)) });
    try { await this.api.toggleChecklist(t.id, itemId, done); this.store.changed(); }
    catch (e) { this.toasts.error(e); void this.load(t.id); }
  }

  async saveNotes() {
    const t = this.todo();
    if (!t || this.notes === t.description) return;
    try {
      const saved = await this.api.updateTodo(t.id, toInput(t, { description: this.notes }));
      this.todo.set({ ...t, description: saved.description }); this.savedNote.set(true); this.store.changed();
      setTimeout(() => this.savedNote.set(false), 2500);
    } catch (e) { this.toasts.error(e, 'Notes were not saved'); }
  }

  async complete() {
    const t = this.todo();
    if (!t) return;
    this.busy.set(true);
    try {
      await this.saveNotes();
      await this.api.completeTodo(t.id);
      this.pause(); this.clearTimer(t.id); this.store.changed();
      this.toasts.show('Task completed — nice work!');
      this.router.navigateByUrl('/today');
    } catch (e) { this.toasts.error(e, 'Could not complete the task'); }
    finally { this.busy.set(false); }
  }

  private key(id: number) { return `daymaker.focus.${id}`; }
  private persist() {
    const t = this.todo();
    if (!t) return;
    try { localStorage.setItem(this.key(t.id), JSON.stringify({ preset: this.preset(), elapsed: this.elapsed() })); } catch { /* ignore */ }
  }
  private readTimer(id: number): { preset: number; elapsed: number } | null {
    try { return JSON.parse(localStorage.getItem(this.key(id)) ?? 'null'); } catch { return null; }
  }
  private clearTimer(id: number) { try { localStorage.removeItem(this.key(id)); } catch { /* ignore */ } }

  ngOnDestroy() { clearInterval(this.tick); document.title = 'Daymaker'; }
}
