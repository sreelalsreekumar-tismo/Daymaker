import { Component, ElementRef, HostListener, OnDestroy, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { relativeTime } from '../core/dates';
import { AppNotification } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Toasts } from '../core/ui.services';
import { Icon } from '../shared/icon';
import { NotificationsService } from './notifications.service';

const ICONS: Record<string, string> = {
  DeadlineApproaching: 'clock', Reminder: 'bell', MeetingAdded: 'calendar', MeetingChanged: 'calendar',
  TaskUpdated: 'check-circle', DailySummary: 'sun', Sync: 'refresh',
};

@Component({
  selector: 'dm-bell',
  imports: [Icon, RouterLink],
  template: `
    <button class="icon-btn bell" (click)="toggle()" [attr.aria-expanded]="open()" aria-haspopup="true"
            [attr.aria-label]="'Notifications' + (svc.unread() ? ', ' + svc.unread() + ' unread' : '')">
      <dm-icon name="bell" [size]="22" />
      @if (svc.unread()) { <span class="badge">{{ svc.unread() > 99 ? '99+' : svc.unread() }}</span> }
    </button>
    @if (open()) {
      <div class="panel card" role="dialog" aria-label="Notifications">
        <div class="row head">
          <h2>Notifications</h2><span class="spacer"></span>
          <button class="btn ghost sm" (click)="svc.markAllRead()" [disabled]="!svc.unread()">Mark all read</button>
          <button class="btn ghost sm" (click)="svc.clear()" [disabled]="!svc.items().length">Clear</button>
        </div>
        @if (svc.loadError()) { <p class="banner error small">Could not load notifications. <button class="btn sm" (click)="svc.refresh()">Retry</button></p> }
        <ul>
          @for (n of svc.items(); track n.id) {
            <li [class.unread]="!n.read">
              <button class="item" (click)="go(n)">
                <dm-icon [name]="icon(n)" /><span class="txt"><strong>{{ n.title }}</strong><span>{{ n.message }}</span>
                  <span class="muted small">{{ rel(n.createdUtc) }}{{ n.linkKind ? ' · open ' + n.linkKind : '' }}</span></span>
                @if (!n.read) { <span class="dot" aria-label="Unread"></span> }
              </button>
              <button class="icon-btn" (click)="svc.remove(n)" aria-label="Dismiss notification"><dm-icon name="x" [size]="14" /></button>
            </li>
          } @empty { <li class="empty muted">You're all caught up.</li> }
        </ul>
        <div class="foot small"><a routerLink="/settings" (click)="open.set(false)">Notification settings</a>
          <span class="muted">{{ svc.live() ? '● Live' : '○ Reconnecting…' }}</span></div>
      </div>
    }`,
  styles: `
    :host { position: relative; display: inline-block; }
    .bell { position: relative; } .badge { position: absolute; top: -2px; right: -2px; min-width: 1.1rem; height: 1.1rem; padding: 0 0.25rem; border-radius: 999px; background: var(--danger); color: #fff; font-size: 0.7rem; font-weight: 700; display: grid; place-items: center; }
    .panel { position: absolute; right: 0; top: calc(100% + 8px); width: min(92vw, 380px); max-height: min(70vh, 560px); display: flex; flex-direction: column; padding: 0; box-shadow: var(--shadow-lg); z-index: 70; }
    .head { padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--border); }
    ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
    li { display: flex; align-items: flex-start; border-bottom: 1px solid var(--border); } li.unread { background: color-mix(in srgb, var(--accent) 7%, transparent); }
    .item { flex: 1; display: flex; gap: 0.7rem; text-align: left; border: 0; background: none; padding: 0.7rem 0.9rem; cursor: pointer; align-items: flex-start; min-width: 0; }
    .item:hover { background: var(--surface-2); } .txt { display: flex; flex-direction: column; flex: 1; min-width: 0; overflow-wrap: anywhere; }
    li > .icon-btn { margin: 0.5rem 0.4rem 0 0; } .empty { padding: 2rem; text-align: center; border: 0; display: block; }
    .foot { display: flex; justify-content: space-between; padding: 0.6rem 0.9rem; border-top: 1px solid var(--border); }`,
})
export class Bell implements OnDestroy {
  svc = inject(NotificationsService);
  private api = inject(Api);
  private store = inject(TodoStore);
  private router = inject(Router);
  private toasts = inject(Toasts);
  private host = inject(ElementRef<HTMLElement>);
  open = signal(false);

  constructor() { void this.svc.start(); }
  ngOnDestroy() { void this.svc.stop(); } // the shell is destroyed on sign-out

  toggle() { this.open.update((o) => !o); if (this.open()) void this.svc.refresh(); }
  icon(n: AppNotification) { return ICONS[n.type] ?? 'bell'; }
  rel(iso: string) { return relativeTime(iso); }

  @HostListener('document:click', ['$event']) outside(e: Event) { if (this.open() && !this.host.nativeElement.contains(e.target)) this.open.set(false); }
  @HostListener('document:keydown.escape') esc() { this.open.set(false); }

  /** Marks the notification read and jumps to the related task / meeting / note. */
  async go(n: AppNotification) {
    void this.svc.markRead(n);
    if (!n.linkKind) return;
    this.open.set(false);
    try {
      if (n.linkKind === 'todo' && n.linkId) this.store.openEdit(await this.api.todo(n.linkId));
      else if (n.linkKind === 'event') await this.router.navigate(['/calendar'], { queryParams: { event: n.linkId } });
      else if (n.linkKind === 'note' && n.linkId) await this.router.navigate(['/notes'], { queryParams: { open: n.linkId } });
    } catch { this.toasts.show('That item no longer exists.', 'error'); }
  }
}
