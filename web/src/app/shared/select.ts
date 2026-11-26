import { Component, ElementRef, HostListener, OnDestroy, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface Option<T = unknown> { value: T; label: string; hint?: string }

/**
 * Apple-style pop-up menu replacing the native <select> (whose open list the browser draws and CSS cannot style).
 * Works with ngModel. Keyboard: ↑/↓ to move, Enter/Space to choose, Esc to close, type a letter to jump.
 */
@Component({
  selector: 'dm-select',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Select), multi: true }],
  template: `
    <button type="button" class="trigger" [class.open]="open()" [disabled]="disabled()" (click)="toggle()" (keydown)="key($event)"
            aria-haspopup="listbox" [attr.aria-expanded]="open()" [attr.aria-label]="ariaLabel() || null">
      <span class="label" [class.ph]="!selected()">{{ selected()?.label ?? placeholder() }}</span>
      <svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 4.5l3-3 3 3M3 7.5l3 3 3-3" /></svg>
    </button>
    @if (open()) {
      <ul class="menu" role="listbox" [style.top.px]="pos().top" [style.left.px]="pos().left" [style.min-width.px]="pos().width" [style.max-height.px]="pos().maxH" [class.up]="pos().up">
        @for (o of options(); track $index; let i = $index) {
          <li role="option" [attr.aria-selected]="isSelected(o)" [class.active]="i === active()" [class.sel]="isSelected(o)"
              (mouseenter)="active.set(i)" (mousedown)="$event.preventDefault()" (click)="choose(o)">
            <svg class="tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            <span class="txt">{{ o.label }}</span>
            @if (o.hint) { <span class="hint">{{ o.hint }}</span> }
          </li>
        }
      </ul>
    }`,
  styles: `
    /* reset: the dropdown often sits inside a muted, small "field" label and must not inherit that */
    :host { display: block; position: relative; min-width: 0; color: var(--text); font-size: 1rem; font-weight: 400; }
    .trigger {
      width: 100%; display: flex; align-items: center; gap: 0.5rem; text-align: left; border: 0; cursor: pointer;
      padding: 0.55rem 0.7rem 0.55rem 0.8rem; border-radius: var(--radius-sm); background: var(--fill); color: var(--text);
      transition: background 0.15s, box-shadow 0.15s;
    }
    .trigger:hover { background: color-mix(in srgb, var(--fill) 70%, var(--text) 8%); }
    .trigger.open, .trigger:focus-visible { outline: none; box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--accent) 35%, transparent); }
    .trigger:disabled { opacity: 0.45; cursor: not-allowed; }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .label.ph { color: var(--muted); }
    .chev { flex: none; color: var(--muted); }
    .menu {
      position: fixed; z-index: 200; margin: 0; padding: 5px; list-style: none; overflow-y: auto; overscroll-behavior: contain;
      background: var(--material); backdrop-filter: blur(28px) saturate(180%); -webkit-backdrop-filter: blur(28px) saturate(180%);
      border-radius: 12px; box-shadow: var(--shadow-lg); transform-origin: top center; animation: menu-in 0.16s var(--ease);
    }
    .menu.up { transform-origin: bottom center; }
    @supports not (backdrop-filter: blur(1px)) { .menu { background: var(--surface); } }
    li { display: flex; align-items: center; gap: 0.45rem; padding: 0.42rem 0.6rem 0.42rem 0.4rem; border-radius: 7px; cursor: pointer; white-space: nowrap; font-size: 0.95rem; }
    li.active { background: var(--accent); color: var(--on-accent); }
    li .tick { visibility: hidden; flex: none; } li.sel .tick { visibility: visible; }
    li .txt { flex: 1; } li .hint { color: var(--muted); font-size: 0.8rem; } li.active .hint { color: inherit; opacity: 0.8; }
    @keyframes menu-in { from { opacity: 0; transform: scale(0.97) translateY(-4px); } }`,
})
export class Select implements ControlValueAccessor, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  options = input<Option[]>([]);
  placeholder = input('Select…');
  ariaLabel = input('');

  open = signal(false);
  disabled = signal(false);
  active = signal(0);
  pos = signal({ top: 0, left: 0, width: 0, maxH: 280, up: false });
  private value: unknown = null;
  private typed = ''; private typedAt = 0;
  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  selected() { return this.options().find((o) => o.value === this.value) ?? null; }
  isSelected(o: Option) { return o.value === this.value; }

  writeValue(v: unknown) { this.value = v; }
  registerOnChange(fn: (v: unknown) => void) { this.onChange = fn; }
  registerOnTouched(fn: () => void) { this.onTouched = fn; }
  setDisabledState(d: boolean) { this.disabled.set(d); }

  toggle() { this.open() ? this.close() : this.show(); }

  private show() {
    const r = (this.host.nativeElement as HTMLElement).getBoundingClientRect();
    const rows = this.options().length;
    const want = Math.min(280, rows * 34 + 10);
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < want && above > below;
    const maxH = Math.max(120, Math.min(280, up ? above : below));
    const h = Math.min(want, maxH);
    this.pos.set({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8)), top: up ? r.top - h - 6 : r.bottom + 6, width: r.width, maxH, up });
    this.active.set(Math.max(0, this.options().findIndex((o) => o.value === this.value)));
    this.open.set(true);
    queueMicrotask(() => this.scrollToActive());
  }

  private close() { this.open.set(false); this.onTouched(); }

  choose(o: Option) {
    this.value = o.value;
    this.onChange(o.value);
    this.close();
  }

  private scrollToActive() {
    (this.host.nativeElement as HTMLElement).querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
  }

  key(e: KeyboardEvent) {
    const n = this.options().length;
    if (!this.open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); this.show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set((this.active() + 1) % n); this.scrollToActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set((this.active() - 1 + n) % n); this.scrollToActive(); }
    else if (e.key === 'Home') { e.preventDefault(); this.active.set(0); this.scrollToActive(); }
    else if (e.key === 'End') { e.preventDefault(); this.active.set(n - 1); this.scrollToActive(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = this.options()[this.active()]; if (o) this.choose(o); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    else if (e.key === 'Tab') this.close();
    else if (e.key.length === 1) { // type-ahead
      const now = Date.now();
      this.typed = now - this.typedAt > 700 ? e.key.toLowerCase() : this.typed + e.key.toLowerCase();
      this.typedAt = now;
      const i = this.options().findIndex((o) => o.label.toLowerCase().startsWith(this.typed));
      if (i >= 0) { this.active.set(i); this.scrollToActive(); }
    }
  }

  @HostListener('document:mousedown', ['$event'])
  outside(e: Event) { if (this.open() && !this.host.nativeElement.contains(e.target)) this.close(); }
  @HostListener('window:resize') resized() { if (this.open()) this.close(); }

  // scroll events don't bubble, so listen in the capture phase to catch scrolling inside dialogs too
  private onScroll = (e: Event) => {
    if (this.open() && !this.host.nativeElement.querySelector('.menu')?.contains(e.target as Node)) this.close();
  };
  constructor() { document.addEventListener('scroll', this.onScroll, true); }
  ngOnDestroy() { document.removeEventListener('scroll', this.onScroll, true); }
}
