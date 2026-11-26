import { Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { formatDay } from '../core/dates';
import { SearchHit } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Toasts } from '../core/ui.services';
import { Icon } from '../shared/icon';

const KINDS = [
  { v: '', l: 'All' }, { v: 'todo', l: 'Tasks' }, { v: 'note', l: 'Notes' }, { v: 'event', l: 'Meetings' }, { v: 'attachment', l: 'Files' },
];
const LABEL: Record<string, string> = { todo: 'Task', note: 'Note', event: 'Meeting', attachment: 'File' };
const ICON: Record<string, string> = { todo: 'check-circle', note: 'note', event: 'calendar', attachment: 'paperclip' };

/** Global search across todos, notes, meetings and attachments. Ctrl/⌘+K or "/" focuses it. */
@Component({
  selector: 'dm-search',
  imports: [FormsModule, Icon],
  template: `
    <div class="box">
      <dm-icon name="search" [size]="16" />
      <input #input type="search" [(ngModel)]="q" (ngModelChange)="changed()" (focus)="open.set(true)" (keydown)="key($event)"
             placeholder="Search tasks, notes, meetings…  ( / )" role="combobox" aria-label="Global search" aria-autocomplete="list"
             [attr.aria-expanded]="open() && !!q.trim()" aria-controls="search-results" autocomplete="off" />
    </div>
    @if (open() && q.trim()) {
      <div class="panel card" id="search-results" role="listbox">
        <div class="kinds">@for (k of kinds; track k.v) { <button class="chip" [class.on]="kind === k.v" (click)="setKind(k.v)">{{ k.l }}</button> }</div>
        @if (loading()) { <p class="muted small pad">Searching…</p> }
        @else if (error()) { <p class="banner error small">{{ error() }}</p> }
        @else if (!hits().length) { <p class="muted small pad">No results for “{{ q.trim() }}”.</p> }
        @for (h of hits(); track h.kind + h.id; let i = $index) {
          <button class="hit" role="option" [class.active]="i === active()" [attr.aria-selected]="i === active()" (mouseenter)="active.set(i)" (click)="go(h)">
            <dm-icon [name]="icon(h)" /><span class="t"><strong>{{ h.title }}</strong><span class="muted small">{{ snippet(h) }}</span></span>
            <span class="chip">{{ label(h) }}</span>
          </button>
        }
      </div>
    }`,
  styles: `
    :host { position: relative; display: block; width: 100%; }
    .box { display: flex; align-items: center; gap: 0.5rem; padding: 0 0.7rem; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--muted); }
    .box:focus-within { border-color: var(--accent); } input { border: 0; background: transparent; padding-inline: 0; } input:focus { outline: none; }
    .panel { position: absolute; left: 0; right: 0; top: calc(100% + 6px); max-height: 70vh; overflow-y: auto; padding: 0.4rem; box-shadow: var(--shadow-lg); z-index: 70; }
    .kinds { display: flex; gap: 0.3rem; flex-wrap: wrap; padding: 0.2rem 0.2rem 0.5rem; } .kinds .chip { cursor: pointer; } .kinds .chip.on { background: var(--accent); color: var(--on-accent); }
    .hit { display: flex; align-items: center; gap: 0.7rem; width: 100%; border: 0; background: none; padding: 0.5rem 0.6rem; border-radius: 8px; cursor: pointer; text-align: left; }
    .hit.active { background: var(--surface-2); } .t { display: flex; flex-direction: column; flex: 1; min-width: 0; } .t span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pad { padding: 0.5rem 0.6rem; margin: 0; }`,
})
export class Search {
  private api = inject(Api);
  private router = inject(Router);
  private store = inject(TodoStore);
  private toasts = inject(Toasts);
  private host = inject(ElementRef<HTMLElement>);
  private input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  kinds = KINDS;
  q = ''; kind = '';
  open = signal(false);
  loading = signal(false);
  error = signal('');
  hits = signal<SearchHit[]>([]);
  active = signal(0);
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  label(h: SearchHit) { return LABEL[h.kind]; }
  icon(h: SearchHit) { return ICON[h.kind]; }
  snippet(h: SearchHit) { return h.snippet || (h.date ? formatDay(new Date(h.date)) : ''); }
  setKind(k: string) { this.kind = k; void this.run(); }

  changed() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.run(), 200); }

  private async run() {
    const q = this.q.trim();
    if (!q) { this.hits.set([]); return; }
    const mine = ++this.seq;
    this.loading.set(true);
    try {
      const r = await this.api.search(q, this.kind || undefined);
      if (mine !== this.seq) return; // a newer query is already in flight
      this.hits.set(r); this.active.set(0); this.error.set('');
    } catch { if (mine === this.seq) this.error.set('Search is unavailable right now.'); }
    finally { if (mine === this.seq) this.loading.set(false); }
  }

  @HostListener('document:keydown', ['$event'])
  shortcut(e: KeyboardEvent) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
      e.preventDefault(); this.input().nativeElement.focus(); this.input().nativeElement.select();
    }
  }
  @HostListener('document:click', ['$event']) outside(e: Event) { if (!this.host.nativeElement.contains(e.target)) this.open.set(false); }

  key(e: KeyboardEvent) {
    const n = this.hits().length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); this.active.set((this.active() + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); this.active.set((this.active() - 1 + n) % n); }
    else if (e.key === 'Enter' && n) { e.preventDefault(); this.go(this.hits()[this.active()]); }
    else if (e.key === 'Escape') { this.open.set(false); this.input().nativeElement.blur(); }
  }

  async go(h: SearchHit) {
    this.open.set(false);
    this.input().nativeElement.blur();
    const kind = h.kind === 'attachment' ? h.parentKind : h.kind;
    const id = h.kind === 'attachment' ? h.parentId : h.id;
    if (!id) return;
    try {
      if (kind === 'todo') this.store.openEdit(await this.api.todo(id));
      else if (kind === 'note') await this.router.navigate(['/notes'], { queryParams: { open: id } });
      else if (kind === 'event') await this.router.navigate(['/calendar'], { queryParams: { event: id } });
    } catch { this.toasts.show('That item no longer exists.', 'error'); }
  }
}
