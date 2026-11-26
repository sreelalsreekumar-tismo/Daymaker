import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { Preferences } from './models';

export interface Toast { id: number; text: string; kind: 'ok' | 'error' | 'info' }

/** Best human message for a failed API call (ProblemDetails title if present). */
export function errMsg(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Cannot reach the server. Check your connection.';
    const t = (e.error as { title?: string } | null)?.title;
    if (t) return t;
    if (e.status === 403) return 'You do not have permission to do that.';
    if (e.status === 404) return 'That item no longer exists.';
  }
  return fallback;
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private n = 0;

  show(text: string, kind: Toast['kind'] = 'ok', ms = 3500) {
    if (this.items().some((t) => t.text === text && t.kind === kind)) return; // don't stack identical messages
    const id = ++this.n;
    this.items.update((l) => [...l, { id, text, kind }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? Math.max(ms, 6000) : ms);
  }
  error(e: unknown, fallback?: string) { this.show(errMsg(e, fallback), 'error'); }
  dismiss(id: number) { this.items.update((l) => l.filter((t) => t.id !== id)); }
}

/** Small confirm dialog state, used instead of window.confirm for destructive actions. */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly request = signal<{ message: string; action: string; resolve: (ok: boolean) => void } | null>(null);
  ask(message: string, action = 'Delete'): Promise<boolean> {
    return new Promise((resolve) => this.request.set({ message, action, resolve }));
  }
  answer(ok: boolean) { this.request()?.resolve(ok); this.request.set(null); }
}

export const DEFAULT_PREFS: Preferences = {
  theme: 'system', accent: '#4f46e5', fontSize: 'medium', spacing: 'comfortable', todoLayout: 'list', noteLayout: 'grid',
  notifyDeadlines: true, notifyMeetings: true, notifyTaskUpdates: true, notifyDailySummary: true,
};
const CACHE_KEY = 'daymaker.prefs';

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private api = inject(Api);
  private toasts = inject(Toasts);
  readonly prefs = signal<Preferences>(this.cached());
  readonly saving = signal(false);
  private timer?: ReturnType<typeof setTimeout>;

  constructor() { this.apply(this.prefs()); }

  async load() {
    try { const p = await this.api.preferences(); this.set(p); } catch { /* keep cached appearance */ }
  }

  /** Applies immediately and saves automatically (debounced) so the app remembers the user's setup. */
  update(patch: Partial<Preferences>) {
    this.set({ ...this.prefs(), ...patch });
    this.saving.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try { await this.api.savePreferences(this.prefs()); this.toasts.show('Preferences saved'); }
      catch (e) { this.toasts.error(e, 'Could not save preferences'); }
      finally { this.saving.set(false); }
    }, 500);
  }

  private set(p: Preferences) {
    this.prefs.set(p);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
    this.apply(p);
  }

  private apply(p: Preferences) {
    const r = document.documentElement;
    if (p.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', p.theme);
    r.dataset['font'] = p.fontSize;
    r.dataset['spacing'] = p.spacing;
    r.style.setProperty('--accent', p.accent);
    r.style.setProperty('--on-accent', luminance(p.accent) > 0.55 ? '#111827' : '#ffffff');
  }

  private cached(): Preferences {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') }; } catch { return DEFAULT_PREFS; }
  }
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
