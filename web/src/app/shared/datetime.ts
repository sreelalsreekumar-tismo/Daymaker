import { Component, ElementRef, HostListener, OnDestroy, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon } from './icon';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Parts { y: number; m: number; d: number; h: number; min: number }

/**
 * Apple-style date (and time) picker replacing the browser's native picker.
 * Value is the same string <input type="datetime-local"> used ("YYYY-MM-DDTHH:mm", or "YYYY-MM-DD" in date mode),
 * so forms need no other change. Arrow keys move between days; Esc closes.
 */
@Component({
  selector: 'dm-datetime',
  imports: [Icon],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateTime), multi: true }],
  template: `
    <button type="button" class="trigger" [class.open]="open()" [disabled]="disabled()" (click)="toggle()" (keydown)="triggerKey($event)"
            aria-haspopup="dialog" [attr.aria-expanded]="open()" [attr.aria-label]="ariaLabel() || null">
      <dm-icon name="calendar" [size]="15" />
      <span class="label" [class.ph]="!value()">{{ text() }}</span>
    </button>

    @if (open()) {
      <div class="pop" role="dialog" aria-label="Choose date" [style.top.px]="pos().top" [style.left.px]="pos().left" [class.up]="pos().up" (keydown)="popKey($event)">
        <div class="head">
          <strong class="month">{{ monthLabel() }}</strong>
          <span class="spacer"></span>
          <button type="button" class="nav" (click)="shiftMonth(-1)" aria-label="Previous month">‹</button>
          <button type="button" class="nav" (click)="goToday()" aria-label="Go to today"><span class="dotc"></span></button>
          <button type="button" class="nav" (click)="shiftMonth(1)" aria-label="Next month">›</button>
        </div>

        <div class="grid" role="grid">
          @for (w of weekdays; track w) { <span class="wd">{{ w.charAt(0) }}</span> }
          @for (c of cells(); track c.key) {
            <button type="button" class="day" [class.other]="c.other" [class.today]="c.today" [class.sel]="c.sel" [class.foc]="c.key === focusKey()"
                    [attr.data-key]="c.key" [attr.aria-label]="c.aria" [attr.aria-selected]="c.sel" [tabindex]="c.key === focusKey() ? 0 : -1" (focus)="focusKey.set(c.key)" (click)="pick(c)">{{ c.day }}</button>
          }
        </div>

        <div class="quick">
          <button type="button" class="chip q" (click)="quick(0)">Today</button>
          <button type="button" class="chip q" (click)="quick(1)">Tomorrow</button>
          <button type="button" class="chip q" (click)="quick(7)">Next week</button>
        </div>

        @if (mode() === 'datetime') {
          <div class="time">
            <span class="tl">Time</span><span class="spacer"></span>
            <div class="stepper">
              <button type="button" class="st" (click)="step('h', 1)" aria-label="Hour up">▲</button>
              <input class="num" inputmode="numeric" maxlength="2" [value]="hour12()" (change)="typed('h', $any($event.target).value)" (keydown)="numKey($event, 'h')" aria-label="Hour" />
              <button type="button" class="st" (click)="step('h', -1)" aria-label="Hour down">▼</button>
            </div>
            <span class="colon">:</span>
            <div class="stepper">
              <button type="button" class="st" (click)="step('m', 5)" aria-label="Minutes up">▲</button>
              <input class="num" inputmode="numeric" maxlength="2" [value]="minute2()" (change)="typed('m', $any($event.target).value)" (keydown)="numKey($event, 'm')" aria-label="Minutes" />
              <button type="button" class="st" (click)="step('m', -5)" aria-label="Minutes down">▼</button>
            </div>
            <div class="ampm" role="group" aria-label="AM or PM">
              <button type="button" [class.on]="!isPm()" (click)="setPm(false)">AM</button>
              <button type="button" [class.on]="isPm()" (click)="setPm(true)">PM</button>
            </div>
          </div>
        }

        <div class="foot">
          <button type="button" class="btn sm danger" (click)="clear()" [disabled]="!value()">Clear</button>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" (click)="close()">Done</button>
        </div>
      </div>
    }`,
  styles: `
    :host { display: block; position: relative; min-width: 0; color: var(--text); font-size: 1rem; font-weight: 400; }
    .trigger { width: 100%; display: flex; align-items: center; gap: 0.5rem; text-align: left; border: 0; cursor: pointer; padding: 0.55rem 0.8rem; border-radius: var(--radius-sm); background: var(--fill); color: var(--text); transition: background 0.15s, box-shadow 0.15s; }
    .trigger dm-icon { color: var(--accent); flex: none; }
    .trigger:hover { background: color-mix(in srgb, var(--fill) 70%, var(--text) 8%); }
    .trigger.open, .trigger:focus-visible { outline: none; box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--accent) 35%, transparent); }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .label.ph { color: var(--muted); }

    .pop { position: fixed; z-index: 200; width: 312px; padding: 0.9rem; border-radius: 18px; background: var(--material); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%); box-shadow: var(--shadow-lg); animation: pop-in 0.18s var(--ease); transform-origin: top left; }
    .pop.up { transform-origin: bottom left; }
    @supports not (backdrop-filter: blur(1px)) { .pop { background: var(--surface); } }
    .head { display: flex; align-items: center; gap: 0.2rem; margin-bottom: 0.5rem; }
    .month { font-size: 1.05rem; letter-spacing: -0.02em; padding-left: 0.2rem; }
    .nav { border: 0; background: transparent; width: 2rem; height: 2rem; border-radius: 50%; cursor: pointer; font-size: 1.4rem; line-height: 1; color: var(--accent); display: grid; place-items: center; transition: background 0.15s; }
    .nav:hover { background: var(--fill); } .dotc { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--accent); }
    .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px 0; justify-items: center; }
    .wd { font-size: 0.72rem; font-weight: 600; color: var(--muted); padding: 0.2rem 0 0.35rem; }
    .day { width: 2.5rem; height: 2.5rem; border: 0; background: transparent; border-radius: 50%; cursor: pointer; font-size: 0.98rem; color: var(--text); transition: background 0.12s, transform 0.1s; font-variant-numeric: tabular-nums; }
    .day:hover { background: var(--fill); } .day:active { transform: scale(0.92); }
    .day.other { color: color-mix(in srgb, var(--muted) 55%, transparent); }
    .day.today { color: var(--accent); font-weight: 700; }
    .day.sel, .day.sel:hover { background: var(--accent); color: var(--on-accent); font-weight: 600; }
    .day:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .quick { display: flex; gap: 0.35rem; margin: 0.6rem 0 0.2rem; } .chip.q { cursor: pointer; border: 0; font-size: 0.8rem; padding: 0.3rem 0.7rem; } .chip.q:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
    .time { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.6rem; padding-top: 0.7rem; border-top: 0.5px solid var(--border); }
    .tl { font-weight: 500; } .colon { font-weight: 700; color: var(--muted); }
    .stepper { display: flex; flex-direction: column; align-items: center; }
    .st { border: 0; background: transparent; cursor: pointer; font-size: 0.55rem; line-height: 1; padding: 0.18rem 0.6rem; color: var(--muted); border-radius: 5px; } .st:hover { background: var(--fill); color: var(--accent); }
    .num { width: 2.7rem; text-align: center; font-size: 1.15rem; font-weight: 600; padding: 0.3rem 0; background: var(--fill); font-variant-numeric: tabular-nums; }
    .ampm { display: inline-flex; padding: 2px; border-radius: 9px; background: var(--fill); margin-left: 0.2rem; }
    .ampm button { border: 0; background: transparent; padding: 0.4rem 0.6rem; border-radius: 7px; cursor: pointer; font-weight: 600; font-size: 0.85rem; }
    .ampm button.on { background: var(--thumb); box-shadow: 0 1px 3px rgb(0 0 0 / 16%); }
    .foot { display: flex; align-items: center; margin-top: 0.7rem; }
    @keyframes pop-in { from { opacity: 0; transform: scale(0.96) translateY(-4px); } }`,
})
export class DateTime implements ControlValueAccessor, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  mode = input<'datetime' | 'date'>('datetime');
  placeholder = input('Add date');
  ariaLabel = input('');

  weekdays = WEEKDAYS;
  open = signal(false);
  disabled = signal(false);
  value = signal('');                       // 'YYYY-MM-DDTHH:mm' | 'YYYY-MM-DD' | ''
  viewY = signal(new Date().getFullYear());
  viewM = signal(new Date().getMonth());
  focusKey = signal('');
  pos = signal({ top: 0, left: 0, up: false });
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  // ----- parsing / formatting
  private parts(): Parts | null {
    const v = this.value();
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3], h: +(m[4] ?? 0), min: +(m[5] ?? 0) } : null;
  }
  private emit(p: Parts) {
    const date = ymd(p.y, p.m, p.d);
    const v = this.mode() === 'date' ? date : `${date}T${pad(p.h)}:${pad(p.min)}`;
    this.value.set(v); this.onChange(v);
  }
  text() {
    const p = this.parts();
    if (!p) return this.placeholder();
    const d = new Date(p.y, p.m, p.d, p.h, p.min);
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: p.y === new Date().getFullYear() ? undefined : 'numeric' }).format(d);
    return this.mode() === 'date' ? day : `${day} · ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)}`;
  }
  monthLabel() { return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(this.viewY(), this.viewM(), 1)); }
  hour12() { const h = this.parts()?.h ?? 9; return String(h % 12 === 0 ? 12 : h % 12); }
  minute2() { return pad(this.parts()?.min ?? 0); }
  isPm() { return (this.parts()?.h ?? 9) >= 12; }

  /** 6×7 grid, Monday first. */
  cells() {
    const y = this.viewY(), m = this.viewM();
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
    const sel = this.parts();
    const today = new Date();
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = ymd(d.getFullYear(), d.getMonth(), d.getDate());
      return {
        key, day: d.getDate(), y: d.getFullYear(), m: d.getMonth(), other: d.getMonth() !== m,
        today: d.toDateString() === today.toDateString(),
        sel: !!sel && sel.y === d.getFullYear() && sel.m === d.getMonth() && sel.d === d.getDate(),
        aria: new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(d),
      };
    });
  }

  // ----- CVA
  writeValue(v: string | null) { this.value.set(v ?? ''); }
  registerOnChange(fn: (v: string) => void) { this.onChange = fn; }
  registerOnTouched(fn: () => void) { this.onTouched = fn; }
  setDisabledState(d: boolean) { this.disabled.set(d); }

  // ----- open / close
  toggle() { this.open() ? this.close() : this.show(); }
  private show() {
    const p = this.parts();
    const base = p ? new Date(p.y, p.m, p.d) : new Date();
    this.viewY.set(base.getFullYear()); this.viewM.set(base.getMonth());
    this.focusKey.set(ymd(base.getFullYear(), base.getMonth(), base.getDate()));
    const r = (this.host.nativeElement as HTMLElement).getBoundingClientRect();
    const h = this.mode() === 'datetime' ? 470 : 400;
    const up = window.innerHeight - r.bottom < h && r.top > window.innerHeight - r.bottom;
    this.pos.set({ left: Math.max(8, Math.min(r.left, window.innerWidth - 312 - 8)), top: up ? Math.max(8, r.top - h - 6) : Math.min(r.bottom + 6, Math.max(8, window.innerHeight - h - 8)), up });
    this.open.set(true);
    this.focusDay(); // keep keyboard focus inside the picker so Esc and arrow keys always work
  }
  close() { if (this.open()) { this.open.set(false); this.onTouched(); } }

  // ----- actions
  shiftMonth(n: number) { const d = new Date(this.viewY(), this.viewM() + n, 1); this.viewY.set(d.getFullYear()); this.viewM.set(d.getMonth()); }
  goToday() { const t = new Date(); this.viewY.set(t.getFullYear()); this.viewM.set(t.getMonth()); this.focusKey.set(ymd(t.getFullYear(), t.getMonth(), t.getDate())); }

  pick(c: { y: number; m: number; day: number }) {
    const cur = this.parts();
    this.emit({ y: c.y, m: c.m, d: c.day, h: cur?.h ?? 9, min: cur?.min ?? 0 }); // first pick defaults to 9:00 AM
    this.focusKey.set(ymd(c.y, c.m, c.day));
    if (c.m !== this.viewM()) { this.viewY.set(c.y); this.viewM.set(c.m); }
    if (this.mode() === 'date') this.close();
    else this.focusDay(); // the grid re-renders after a month change; keep focus on the chosen day
  }
  quick(days: number) {
    const d = new Date(); d.setDate(d.getDate() + days);
    this.pick({ y: d.getFullYear(), m: d.getMonth(), day: d.getDate() });
    this.viewY.set(d.getFullYear()); this.viewM.set(d.getMonth());
  }
  clear() { this.value.set(''); this.onChange(''); this.close(); }

  private ensure(): Parts { const t = new Date(); return this.parts() ?? { y: t.getFullYear(), m: t.getMonth(), d: t.getDate(), h: 9, min: 0 }; }
  step(unit: 'h' | 'm', by: number) {
    const p = this.ensure();
    // hours and minutes wrap on their own; stepping never changes the chosen date
    if (unit === 'h') this.emit({ ...p, h: (p.h + by + 24) % 24 });
    else this.emit({ ...p, min: (((p.min + by) % 60) + 60) % 60 });
  }
  typed(unit: 'h' | 'm', raw: string) {
    const n = parseInt(raw, 10);
    const p = this.ensure();
    if (Number.isNaN(n)) { this.emit(p); return; }
    if (unit === 'h') { const h12 = Math.min(12, Math.max(1, n)); this.emit({ ...p, h: (h12 % 12) + (p.h >= 12 ? 12 : 0) }); }
    else this.emit({ ...p, min: Math.min(59, Math.max(0, n)) });
  }
  numKey(e: KeyboardEvent, unit: 'h' | 'm') {
    if (e.key === 'ArrowUp') { e.preventDefault(); this.step(unit, unit === 'h' ? 1 : 5); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); this.step(unit, unit === 'h' ? -1 : -5); }
    else if (e.key === 'Enter') { e.preventDefault(); this.typed(unit, (e.target as HTMLInputElement).value); }
  }
  setPm(pm: boolean) { const p = this.ensure(); this.emit({ ...p, h: (p.h % 12) + (pm ? 12 : 0) }); }

  // ----- keyboard
  triggerKey(e: KeyboardEvent) { if (!this.open() && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); this.show(); queueMicrotask(() => this.focusDay()); } }
  popKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.trigger')?.focus(); return; }
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in delta && (e.target as HTMLElement).classList.contains('day')) {
      e.preventDefault();
      const [y, m, d] = this.focusKey().split('-').map(Number);
      const n = new Date(y, m - 1, d + delta[e.key]);
      this.focusKey.set(ymd(n.getFullYear(), n.getMonth(), n.getDate()));
      if (n.getMonth() !== this.viewM() || n.getFullYear() !== this.viewY()) { this.viewY.set(n.getFullYear()); this.viewM.set(n.getMonth()); }
      this.focusDay();
    }
  }
  private focusDay() { setTimeout(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(`.day[data-key="${this.focusKey()}"]`)?.focus()); }

  @HostListener('document:mousedown', ['$event'])
  outside(e: Event) { if (this.open() && !this.host.nativeElement.contains(e.target)) this.close(); }
  @HostListener('window:resize') resized() { if (this.open()) this.close(); }
  // safety net: if focus was lost (e.g. the focused day re-rendered after a month change), Esc must still close the picker
  @HostListener('document:keydown.escape') escapeFallback() { if (this.open() && document.activeElement === document.body) this.close(); }
  private onScroll = (e: Event) => { if (this.open() && !this.host.nativeElement.querySelector('.pop')?.contains(e.target as Node)) this.close(); };
  constructor() { document.addEventListener('scroll', this.onScroll, true); }
  ngOnDestroy() { document.removeEventListener('scroll', this.onScroll, true); }
}
