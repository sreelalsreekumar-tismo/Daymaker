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
    .host { position: fixed; left: 50%; transform: translateX(-50%); bottom: 1.4rem; z-index: 100; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; width: max-content; max-width: min(92vw, 420px); }
    .toast { display: flex; align-items: center; gap: 0.6rem; padding: 0.65rem 0.9rem 0.65rem 1.1rem; border-radius: 999px; background: rgb(40 40 44 / 82%); color: #fff; backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); box-shadow: var(--shadow-lg); font-size: 0.9rem; animation: toast-in 0.35s var(--ease); }
    .toast.error { background: rgb(255 59 48 / 90%); }
    @keyframes toast-in { from { opacity: 0; transform: translateY(14px) scale(0.96); } }
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
    .scrim { position: fixed; inset: 0; display: grid; place-items: center; z-index: 120; padding: 1rem; }
    .dlg { max-width: 400px; width: 100%; box-shadow: var(--shadow-lg); padding: 1.4rem; } p { margin-top: 0; font-size: 1.02rem; }`,
})
export class ConfirmDialog { c = inject(Confirm); }
