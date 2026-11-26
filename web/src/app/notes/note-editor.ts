import { Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import { Api } from '../core/api.service';
import { Folder, Note } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Confirm, Toasts } from '../core/ui.services';
import { Attachments } from '../shared/attachments';
import { Icon } from '../shared/icon';
import { Option, Select } from '../shared/select';
import { imageToDataUrl } from './note-html';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

/** Rich-text note editor with autosave. Works on a note that already exists (the page creates it first). */
@Component({
  selector: 'dm-note-editor',
  imports: [FormsModule, Icon, Attachments, Select],
  template: `
    <div class="scrim" (click)="requestClose()">
      <div class="dlg card" (click)="$event.stopPropagation()" (keydown.escape)="requestClose()" role="dialog" aria-modal="true" aria-label="Edit note">
        <div class="row">
          <input class="title" type="text" [(ngModel)]="title" (ngModelChange)="touch()" placeholder="Untitled" aria-label="Note title" maxlength="200" />
          <button class="icon-btn" (click)="togglePin()" [attr.aria-pressed]="pinned" [title]="pinned ? 'Unpin' : 'Pin'" aria-label="Pin note"><dm-icon name="pin" [style.color]="pinned ? 'var(--accent)' : ''" /></button>
          <button class="icon-btn" (click)="requestClose()" aria-label="Close"><dm-icon name="x" /></button>
        </div>

        <div class="row meta">
          <dm-select [options]="folderOptions()" [(ngModel)]="folderId" (ngModelChange)="touch()" ariaLabel="Folder" />
          <input type="text" [(ngModel)]="tagText" (ngModelChange)="touch()" placeholder="Tags, comma separated" aria-label="Tags" />
          @if (note().sourceTodoId) { <button class="btn sm" (click)="openSource()"><dm-icon name="link" [size]="14" /> From task</button> }
        </div>

        <div class="toolbar" role="toolbar" aria-label="Formatting">
          @for (b of buttons; track b.label) {
            <button type="button" class="tb" [class.on]="b.active()" (click)="b.run()" [attr.aria-label]="b.label" [title]="b.label" [attr.aria-pressed]="b.active()">{{ b.text }}</button>
          }
          <button type="button" class="tb" (click)="setLink()" aria-label="Link" title="Link"><dm-icon name="link" [size]="15" /></button>
          <label class="tb" title="Insert image" aria-label="Insert image"><dm-icon name="image" [size]="15" />
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden (change)="insertImage($event)" /></label>
          <button type="button" class="tb wide" (click)="itemToTodo()" title="Turn the checklist item at the cursor into a todo">☑ → Todo</button>
        </div>

        <div #host class="editor prose" (click)="focusEditor()"></div>

        <details class="att"><summary>Attachments</summary><dm-attachments owner="Note" [ownerId]="note().id" /></details>

        <div class="row foot">
          <span class="muted small" role="status">
            @switch (state()) { @case ('saved') { Saved } @case ('saving') { Saving… } @case ('dirty') { Unsaved changes… } @case ('error') { <span class="err">Not saved — <button class="link" (click)="save()">retry</button></span> } }
          </span>
          <span class="spacer"></span>
          <button class="btn danger" (click)="remove()"><dm-icon name="trash" [size]="16" /> Delete</button>
          <button class="btn primary" (click)="requestClose()">Done</button>
        </div>
      </div>
    </div>`,
  styles: `
    .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 45%); display: grid; place-items: center; z-index: 90; padding: 1rem; }
    .dlg { width: min(100%, 860px); max-height: calc(100vh - 2rem); display: flex; flex-direction: column; gap: 0.7rem; box-shadow: var(--shadow-lg); overflow: hidden; }
    .title { font-size: 1.3rem; font-weight: 700; border: 0; background: transparent; padding-inline: 0; flex: 1; } .title:focus { outline: none; }
    .meta > * { flex: 1 1 160px; } .meta .btn { flex: none; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 2px; padding: 0.25rem; background: var(--surface-2); border-radius: 10px; }
    .tb { border: 0; background: transparent; min-width: 2rem; height: 2rem; border-radius: 7px; cursor: pointer; font-weight: 700; display: inline-grid; place-items: center; padding: 0 0.4rem; }
    .tb:hover { background: var(--border); } .tb.on { background: var(--accent); color: var(--on-accent); } .tb.wide { font-weight: 500; font-size: 0.85rem; }
    .editor { flex: 1; min-height: 240px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; padding: 0.6rem 0.9rem; cursor: text; }
    .att summary { cursor: pointer; color: var(--muted); margin-bottom: 0.4rem; } .link { border: 0; background: none; color: var(--accent); cursor: pointer; text-decoration: underline; padding: 0; }
    .foot { border-top: 1px solid var(--border); padding-top: 0.6rem; }`,
})
export class NoteEditor implements OnDestroy {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private router = inject(Router);
  private todoStore = inject(TodoStore);
  private host = viewChild.required<ElementRef<HTMLElement>>('host');

  note = input.required<Note>();
  folders = input<Folder[]>([]);
  closed = output<{ deleted: boolean }>();
  folderOptions = computed<Option[]>(() => [{ value: null, label: 'No folder' }, ...this.folders().map((f) => ({ value: f.id, label: f.name }))]);

  title = ''; tagText = ''; folderId: number | null = null; pinned = false;
  state = signal<SaveState>('saved');
  private tick = signal(0); // bumped on every editor transaction so toolbar "active" states refresh
  private editor?: Editor;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;

  buttons = [
    { label: 'Heading 1', text: 'H1', run: () => this.cmd((c) => c.toggleHeading({ level: 1 })), active: () => this.is('heading', { level: 1 }) },
    { label: 'Heading 2', text: 'H2', run: () => this.cmd((c) => c.toggleHeading({ level: 2 })), active: () => this.is('heading', { level: 2 }) },
    { label: 'Heading 3', text: 'H3', run: () => this.cmd((c) => c.toggleHeading({ level: 3 })), active: () => this.is('heading', { level: 3 }) },
    { label: 'Bold', text: 'B', run: () => this.cmd((c) => c.toggleBold()), active: () => this.is('bold') },
    { label: 'Italic', text: 'I', run: () => this.cmd((c) => c.toggleItalic()), active: () => this.is('italic') },
    { label: 'Bullet list', text: '•', run: () => this.cmd((c) => c.toggleBulletList()), active: () => this.is('bulletList') },
    { label: 'Numbered list', text: '1.', run: () => this.cmd((c) => c.toggleOrderedList()), active: () => this.is('orderedList') },
    { label: 'Checklist', text: '☑', run: () => this.cmd((c) => c.toggleTaskList()), active: () => this.is('taskList') },
    { label: 'Quote', text: '❝', run: () => this.cmd((c) => c.toggleBlockquote()), active: () => this.is('blockquote') },
  ];

  constructor() {
    effect(() => {
      const n = this.note();
      untracked(() => {
        this.title = n.title === 'Untitled' ? '' : n.title; this.tagText = n.tags.join(', '); this.folderId = n.folderId; this.pinned = n.pinned;
        this.mount(n.contentHtml);
      });
    });
  }

  private mount(html: string) {
    this.editor?.destroy();
    this.editor = new Editor({
      element: this.host().nativeElement,
      extensions: [
        StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
        Image.configure({ allowBase64: true }), TaskList, TaskItem.configure({ nested: true }),
      ],
      content: html,
      editorProps: { attributes: { 'aria-label': 'Note content', role: 'textbox', 'aria-multiline': 'true' } },
      onTransaction: () => this.tick.update((v) => v + 1),
      onUpdate: () => this.touch(),
    });
    this.state.set('saved');
  }

  private is(name: string, attrs?: Record<string, unknown>) { this.tick(); return !!this.editor?.isActive(name, attrs); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cmd(fn: (c: any) => any) { fn(this.editor!.chain().focus()).run(); }
  focusEditor() { this.editor?.commands.focus(); }

  touch() {
    this.state.set('dirty');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 1000);
  }

  async save() {
    clearTimeout(this.timer);
    if (this.inFlight) await this.inFlight;
    const n = this.note();
    const run = (async () => {
      this.state.set('saving');
      try {
        const saved = await this.api.updateNote(n.id, {
          title: this.title.trim() || 'Untitled', contentHtml: this.editor!.getHTML(), pinned: this.pinned, folderId: this.folderId,
          tags: this.tagText.split(',').map((t) => t.trim()).filter(Boolean),
        });
        Object.assign(n, saved);
        this.state.update((s) => (s === 'saving' ? 'saved' : s));
      } catch (e) { this.state.set('error'); this.toasts.error(e, 'Could not save the note'); }
    })();
    this.inFlight = run;
    await run;
    this.inFlight = undefined;
  }

  togglePin() { this.pinned = !this.pinned; this.touch(); }

  setLink() {
    const prev = this.editor?.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('Link address (leave empty to remove)', prev ?? 'https://');
    if (url === null) return;
    const chain = this.editor!.chain().focus().extendMarkRange('link');
    if (url.trim() === '') chain.unsetLink().run();
    else if (/^(https?:|mailto:)/i.test(url.trim())) chain.setLink({ href: url.trim() }).run();
    else this.toasts.show('Links must start with http://, https:// or mailto:', 'error');
  }

  async insertImage(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const src = await imageToDataUrl(file);
      if (src.length > 2_000_000) { this.toasts.show('That image is too large even after shrinking. Try a smaller one.', 'error'); return; }
      this.editor!.chain().focus().setImage({ src, alt: file.name }).run();
    } catch { this.toasts.show('Could not read that image.', 'error'); }
  }

  /** Turns the checklist item under the cursor into a real todo. */
  async itemToTodo() {
    const ed = this.editor!;
    const { $from } = ed.state.selection;
    let text = '';
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'taskItem') { text = $from.node(d).textContent.trim(); break; }
    }
    if (!text) { this.toasts.show('Place the cursor inside a checklist item first.', 'info'); return; }
    try {
      await this.save();
      await this.api.checklistToTodo(this.note().id, text);
      this.todoStore.changed();
      this.toasts.show(`Todo created: "${text}"`);
    } catch (e) { this.toasts.error(e, 'Could not create the todo'); }
  }

  async openSource() {
    const id = this.note().sourceTodoId;
    if (!id) return;
    try { const t = await this.api.todo(id); await this.close(false); this.todoStore.openEdit(t); }
    catch { this.toasts.show('The original task no longer exists.', 'error'); }
  }

  async requestClose() { await this.close(false); }

  private async close(deleted: boolean) {
    if (!deleted && this.state() !== 'saved') await this.save();
    if (!deleted && this.state() === 'error') {
      if (!(await this.confirm.ask('This note could not be saved. Close anyway and lose recent changes?', 'Close anyway'))) return;
    }
    this.closed.emit({ deleted });
  }

  async remove() {
    if (!(await this.confirm.ask(`Delete "${this.title || 'Untitled'}"? This cannot be undone.`))) return;
    try { clearTimeout(this.timer); await this.api.deleteNote(this.note().id); this.toasts.show('Note deleted'); this.closed.emit({ deleted: true }); }
    catch (e) { this.toasts.error(e); }
  }

  ngOnDestroy() { clearTimeout(this.timer); this.editor?.destroy(); }
}
