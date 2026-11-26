import { Component, OnDestroy, effect, inject, input, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Attachment } from '../core/models';
import { Confirm, Toasts } from '../core/ui.services';
import { Icon } from './icon';

interface View extends Attachment { url?: string; }

/**
 * Lists/uploads attachments for a todo or note. With no ownerId yet (a task being created) files are queued
 * and uploaded by calling flush(ownerId) after the owner is saved.
 */
@Component({
  selector: 'dm-attachments',
  imports: [Icon],
  template: `
    <div class="list">
      @for (a of items(); track a.id) {
        <div class="att">
          @if (a.url && a.contentType.startsWith('image/')) { <img [src]="a.url" [alt]="a.fileName" /> }
          @else { <dm-icon name="paperclip" /> }
          <button type="button" class="name" (click)="download(a)" [title]="a.fileName">{{ a.fileName }}</button>
          <button type="button" class="icon-btn" (click)="remove(a)" [attr.aria-label]="'Remove ' + a.fileName"><dm-icon name="x" [size]="14" /></button>
        </div>
      }
      @for (f of queued(); track f.name) {
        <div class="att queued"><dm-icon name="paperclip" /><span class="name">{{ f.name }}</span><span class="muted small">will upload on save</span>
          <button type="button" class="icon-btn" (click)="unqueue(f)" aria-label="Remove"><dm-icon name="x" [size]="14" /></button></div>
      }
    </div>
    <label class="btn sm"><dm-icon name="image" [size]="16" /> Add image or file
      <input type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain" (change)="pick($event)" /></label>`,
  styles: `
    .list { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem; }
    .att { display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.5rem; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); max-width: 100%; }
    .att img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; }
    .name { border: 0; background: none; cursor: pointer; text-decoration: underline; max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queued .name { text-decoration: none; cursor: default; }`,
})
export class Attachments implements OnDestroy {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);

  owner = input.required<'Todo' | 'Note'>();
  ownerId = input<number | null>(null);
  items = signal<View[]>([]);
  queued = signal<File[]>([]);

  constructor() {
    effect(() => { const id = this.ownerId(); if (id) this.load(id); else this.items.set([]); });
  }

  private async load(id: number) {
    try {
      const list = await this.api.attachments(this.owner(), id);
      const views: View[] = await Promise.all(list.map(async (a) =>
        a.contentType.startsWith('image/') ? { ...a, url: URL.createObjectURL(await this.api.attachmentBlob(a.id)) } : a));
      this.revoke();
      this.items.set(views);
    } catch (e) { this.toasts.error(e, 'Could not load attachments'); }
  }

  async pick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const id = this.ownerId();
    if (!id) { this.queued.update((q) => [...q, ...files]); return; }
    for (const f of files) await this.upload(id, f);
    await this.load(id);
  }

  private async upload(id: number, f: File) {
    try { await this.api.uploadAttachment(this.owner(), id, f); }
    catch (e) { this.toasts.error(e, `Could not upload ${f.name}`); }
  }

  /** Uploads files queued while the owner did not exist yet. */
  async flush(ownerId: number) {
    for (const f of this.queued()) await this.upload(ownerId, f);
    this.queued.set([]);
  }

  unqueue(f: File) { this.queued.update((q) => q.filter((x) => x !== f)); }

  async remove(a: View) {
    if (!(await this.confirm.ask(`Remove "${a.fileName}"?`, 'Remove'))) return;
    try { await this.api.deleteAttachment(a.id); this.items.update((l) => l.filter((x) => x.id !== a.id)); }
    catch (e) { this.toasts.error(e); }
  }

  async download(a: View) {
    try {
      const url = a.url ?? URL.createObjectURL(await this.api.attachmentBlob(a.id));
      const link = document.createElement('a');
      link.href = url; link.download = a.fileName; link.click();
      if (!a.url) setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { this.toasts.error(e); }
  }

  private revoke() { for (const a of this.items()) if (a.url) URL.revokeObjectURL(a.url); }
  ngOnDestroy() { this.revoke(); }
}
