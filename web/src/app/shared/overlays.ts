import { Component, inject } from '@angular/core';
import { Confirm, Toasts } from '../core/ui.services';
import { Icon } from './icon';

@Component({
  selector: 'dm-toasts',
  imports: [Icon],
  template: `
    <div class="host" role="status" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <div class="toast {{ t.kind }}">
          <span>{{ t.text }}</span>
          <button class="icon-btn" (click)="toasts.dismiss(t.id)" aria-label="Dismiss"><dm-icon name="x" [size]="14" /></button>
        </div>
      }
    </div>`,
  styles: `
    .host { position: fixed; right: 1rem; bottom: 1rem; z-index: 100; display: flex; flex-direction: column; gap: 0.5rem; max-width: min(92vw, 380px); }
    .toast { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.8rem; border-radius: 10px; background: var(--text); color: var(--bg); box-shadow: var(--shadow-lg); font-size: 0.9rem; }
    .toast.error { background: var(--danger); color: #fff; }
    .toast span { flex: 1; } .toast .icon-btn { color: inherit; opacity: 0.8; }`,
})
export class ToastHost { toasts = inject(Toasts); }

@Component({
  selector: 'dm-confirm',
  template: `
    @if (c.request(); as r) {
      <div class="scrim" (click)="c.answer(false)">
        <div class="dlg card" role="alertdialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown.escape)="c.answer(false)">
          <p>{{ r.message }}</p>
          <div class="row" style="justify-content:flex-end">
            <button class="btn" (click)="c.answer(false)" autofocus>Cancel</button>
            <button class="btn primary" style="background:var(--danger)" (click)="c.answer(true)">{{ r.action }}</button>
          </div>
        </div>
      </div>
    }`,
  styles: `
    .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 45%); display: grid; place-items: center; z-index: 120; padding: 1rem; }
    .dlg { max-width: 420px; width: 100%; box-shadow: var(--shadow-lg); } p { margin-top: 0; }`,
})
export class ConfirmDialog { c = inject(Confirm); }
