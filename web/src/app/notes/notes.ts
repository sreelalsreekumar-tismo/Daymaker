import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api.service';
import { relativeTime } from '../core/dates';
import { Folder, Note } from '../core/models';
import { PreferencesService, Toasts, Confirm } from '../core/ui.services';
import { Icon } from '../shared/icon';
import { NoteEditor } from './note-editor';
import { noteToReadonlyHtml, noteToText } from './note-html';

@Component({
  selector: 'dm-notes',
  imports: [FormsModule, Icon, NoteEditor],
  template: `
    <div class="page">
      <div class="page-head">
        <h1>Notes</h1><span class="spacer"></span>
        <input type="search" [(ngModel)]="q" (ngModelChange)="queryChanged()" placeholder="Search notes…" aria-label="Search notes" class="search" />
        <div class="seg" role="group" aria-label="Layout">
          <button [class.on]="layout() === 'grid'" (click)="setLayout('grid')" title="Grid"><dm-icon name="grid" /></button>
          <button [class.on]="layout() === 'list'" (click)="setLayout('list')" title="List"><dm-icon name="list" /></button>
          <button [class.on]="layout() === 'document'" (click)="setLayout('document')" title="Document"><dm-icon name="note" /></button>
        </div>
        <button class="btn primary" (click)="create()" [disabled]="creating()"><dm-icon name="plus" /> New note</button>
      </div>

      <div class="layout">
        <nav class="folders card stack" aria-label="Folders">
          <button class="f" [class.on]="folderId() === null && !pinnedOnly()" (click)="pick(null, false)"><dm-icon name="note" [size]="16" /> All notes</button>
          <button class="f" [class.on]="pinnedOnly()" (click)="pick(null, true)"><dm-icon name="pin" [size]="16" /> Pinned</button>
          @for (f of folders(); track f.id) {
            <div class="row nowrap"><button class="f grow" [class.on]="folderId() === f.id" (click)="pick(f.id, false)"><dm-icon name="folder" [size]="16" /> {{ f.name }}</button>
              <button class="icon-btn" (click)="removeFolder(f)" [attr.aria-label]="'Delete folder ' + f.name"><dm-icon name="trash" [size]="14" /></button></div>
          }
          <form class="row nowrap" (ngSubmit)="addFolder()"><input type="text" name="nf" [(ngModel)]="newFolder" placeholder="New folder" aria-label="New folder name" maxlength="40" />
            <button class="btn sm" type="submit" [disabled]="!newFolder.trim()">Add</button></form>
          @if (tags().length) {
            <h3 class="small muted">Tags</h3>
            <div class="row">@for (t of tags(); track t) { <button class="chip tagbtn" [class.on]="tag() === t" (click)="toggleTag(t)">#{{ t }}</button> }</div>
          }
        </nav>

        <div>
          @if (error()) { <div class="banner error row" role="alert">{{ error() }} <button class="btn sm" (click)="load()">Retry</button></div> }
          @else if (loading() && !notes().length) { <p class="muted empty">Loading…</p> }
          @else if (!notes().length) {
            <div class="empty card"><p>{{ q || tag() || folderId() || pinnedOnly() ? 'No notes match.' : 'No notes yet. Capture your first idea.' }}</p>
              @if (!q && !tag() && !folderId() && !pinnedOnly()) { <button class="btn primary" (click)="create()"><dm-icon name="plus" /> New note</button> }</div>
          } @else {
            @switch (layout()) {
              @case ('grid') {
                <div class="grid">
                  @for (n of notes(); track n.id) {
                    <article class="card note" tabindex="0" (click)="open(n)" (keydown.enter)="open(n)">
                      <div class="row"><h3 class="grow">{{ n.title }}</h3>
                        <button class="icon-btn" (click)="togglePin(n, $event)" [attr.aria-label]="n.pinned ? 'Unpin' : 'Pin'"><dm-icon name="pin" [size]="15" [style.color]="n.pinned ? 'var(--accent)' : ''" /></button></div>
                      <p class="preview">{{ preview(n) }}</p>
                      <div class="row"><span class="muted small">{{ rel(n.updatedUtc) }}</span>
                        @for (t of n.tags.slice(0, 3); track t) { <span class="chip">#{{ t }}</span> }
                        @if (n.attachmentCount) { <span class="chip"><dm-icon name="paperclip" [size]="12" /> {{ n.attachmentCount }}</span> }
                        @if (n.sourceTodoId) { <span class="chip"><dm-icon name="link" [size]="12" /> task</span> }</div>
                    </article>
                  }
                </div>
              }
              @case ('list') {
                <div class="stack">
                  @for (n of notes(); track n.id) {
                    <article class="card lrow row" tabindex="0" (click)="open(n)" (keydown.enter)="open(n)">
                      @if (n.pinned) { <dm-icon name="pin" [size]="15" style="color:var(--accent)" /> }
                      <strong>{{ n.title }}</strong><span class="muted preview1 grow">{{ preview(n) }}</span>
                      @for (t of n.tags.slice(0, 2); track t) { <span class="chip">#{{ t }}</span> }
                      <span class="muted small">{{ rel(n.updatedUtc) }}</span>
                    </article>
                  }
                </div>
              }
              @case ('document') {
                <div class="docs">
                  @for (n of notes(); track n.id) {
                    <article class="paper" tabindex="0" (click)="open(n)" (keydown.enter)="open(n)">
                      <div class="row"><h2 class="grow">{{ n.title }}</h2>
                        <button class="icon-btn" (click)="togglePin(n, $event)" [attr.aria-label]="n.pinned ? 'Unpin' : 'Pin'"><dm-icon name="pin" [style.color]="n.pinned ? 'var(--accent)' : ''" /></button></div>
                      <div class="prose" [innerHTML]="html(n)"></div>
                      <div class="muted small">Updated {{ rel(n.updatedUtc) }}</div>
                    </article>
                  }
                </div>
              }
            }
          }
        </div>
      </div>
    </div>

    @if (editing(); as n) { <dm-note-editor [note]="n" [folders]="folders()" (closed)="closeEditor($event)" /> }`,
  styles: `
    .search { max-width: 260px; } .layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 1rem; align-items: start; }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } .folders { flex-direction: row; flex-wrap: wrap; } }
    .folders { position: sticky; top: 4.5rem; gap: 2px; } .nowrap { flex-wrap: nowrap; } .grow { flex: 1; min-width: 0; }
    .f { display: flex; align-items: center; gap: 0.5rem; border: 0; background: none; padding: 0.45rem 0.6rem; border-radius: 8px; cursor: pointer; text-align: left; }
    .f:hover { background: var(--surface-2); } .f.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-weight: 600; }
    .tagbtn { cursor: pointer; } .tagbtn.on { background: var(--accent); color: var(--on-accent); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--gap); align-items: start; }
    .note { cursor: pointer; display: flex; flex-direction: column; gap: 0.5rem; } .note:hover, .lrow:hover, .paper:hover { border-color: var(--accent); }
    .preview { margin: 0; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .lrow { cursor: pointer; flex-wrap: nowrap; } .preview1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .docs { display: flex; flex-direction: column; gap: 1.2rem; align-items: center; }
    .paper { width: min(100%, 760px); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: var(--shadow); padding: 1.6rem 2rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.6rem; }
    .paper .prose { line-height: 1.7; max-height: 34rem; overflow: hidden; }`,
})
export class Notes {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private prefs = inject(PreferencesService);

  layout = computed(() => this.prefs.prefs().noteLayout);
  notes = signal<Note[]>([]);
  folders = signal<Folder[]>([]);
  allTags = signal<string[]>([]);
  tags = computed(() => this.allTags());
  folderId = signal<number | null>(null);
  pinnedOnly = signal(false);
  tag = signal('');
  editing = signal<Note | null>(null);
  loading = signal(true);
  creating = signal(false);
  error = signal('');
  q = ''; newFolder = '';
  private timer?: ReturnType<typeof setTimeout>;
  private previews = new Map<number, string>();

  constructor() {
    effect(() => { this.folderId(); this.pinnedOnly(); this.tag(); void this.load(); });
    void this.loadSide();
    const open = Number(this.route.snapshot.queryParamMap.get('open'));
    if (open) void this.openById(open);
  }

  rel(iso: string) { return relativeTime(iso); }
  preview(n: Note) { return this.previews.get(n.id) ?? ''; }
  html(n: Note) { return noteToReadonlyHtml(n.contentHtml); }
  setLayout(l: 'grid' | 'list' | 'document') { this.prefs.update({ noteLayout: l }); }
  pick(folder: number | null, pinned: boolean) { this.folderId.set(folder); this.pinnedOnly.set(pinned); }
  toggleTag(t: string) { this.tag.set(this.tag() === t ? '' : t); }
  queryChanged() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.load(), 250); }

  async loadSide() {
    try { const [f, t] = await Promise.all([this.api.folders(), this.api.tags()]); this.folders.set(f); this.allTags.set(t); } catch { /* sidebar stays empty */ }
  }

  async load() {
    try {
      this.loading.set(true);
      const notes = await this.api.notes({ q: this.q.trim(), folderId: this.folderId(), tag: this.tag(), pinned: this.pinnedOnly() ? true : null });
      this.previews = new Map(notes.map((n) => [n.id, noteToText(n.contentHtml).slice(0, 240) || 'Empty note']));
      this.notes.set(notes);
      this.error.set('');
    } catch { this.error.set('Could not load your notes.'); }
    finally { this.loading.set(false); }
  }

  async create() {
    this.creating.set(true);
    try {
      const n = await this.api.createNote({ title: 'Untitled', contentHtml: '', folderId: this.folderId() });
      this.editing.set(n);
    } catch (e) { this.toasts.error(e, 'Could not create a note'); }
    finally { this.creating.set(false); }
  }

  open(n: Note) { this.editing.set(n); }

  private async openById(id: number) {
    try { this.editing.set(await this.api.note(id)); } catch { this.toasts.show('That note no longer exists.', 'error'); }
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  async closeEditor(r: { deleted: boolean }) {
    const n = this.editing();
    this.editing.set(null);
    // an untouched new note is clutter — drop it silently
    if (n && !r.deleted && n.title === 'Untitled' && !noteToText(n.contentHtml)) { try { await this.api.deleteNote(n.id); } catch { /* ignore */ } }
    await Promise.all([this.load(), this.loadSide()]);
  }

  async togglePin(n: Note, ev: Event) {
    ev.stopPropagation();
    try { await this.api.pinNote(n.id, !n.pinned); await this.load(); } catch (e) { this.toasts.error(e); }
  }

  async addFolder() {
    const name = this.newFolder.trim();
    if (!name) return;
    try { const f = await this.api.createFolder(name); this.folders.update((l) => [...l, f].sort((a, b) => a.name.localeCompare(b.name))); this.newFolder = ''; }
    catch (e) { this.toasts.error(e); }
  }

  async removeFolder(f: Folder) {
    if (!(await this.confirm.ask(`Delete folder "${f.name}"? Its notes are kept and moved to "All notes".`))) return;
    try { await this.api.deleteFolder(f.id); if (this.folderId() === f.id) this.folderId.set(null); await this.loadSide(); await this.load(); }
    catch (e) { this.toasts.error(e); }
  }
}
