import { Injectable, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { AppNotification } from '../core/models';
import { TodoStore } from '../core/todo.store';
import { Toasts } from '../core/ui.services';

/** Live notification feed: initial load over REST, then pushed over SignalR (no page refresh needed). */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private api = inject(Api);
  private auth = inject(AuthService);
  private toasts = inject(Toasts);
  private store = inject(TodoStore);
  private hub?: HubConnection;

  readonly items = signal<AppNotification[]>([]);
  readonly unread = signal(0);
  readonly live = signal(false);
  readonly loadError = signal(false);

  async start() {
    if (this.hub) return;
    await this.refresh();
    this.hub = new HubConnectionBuilder()
      .withUrl('/hubs/notifications', { accessTokenFactory: () => this.auth.token ?? '' })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();
    this.hub.on('notification', (n: AppNotification) => {
      this.items.update((l) => [n, ...l.filter((x) => x.id !== n.id)].slice(0, 100));
      this.unread.update((u) => u + 1);
      this.toasts.show(`${n.title}: ${n.message}`, 'info', 5000);
      if (n.linkKind === 'todo' || n.type === 'TaskUpdated') this.store.changed(); // keep task views fresh
    });
    this.hub.onreconnecting(() => this.live.set(false));
    this.hub.onreconnected(() => { this.live.set(true); void this.refresh(); }); // catch up on anything missed
    this.hub.onclose(() => this.live.set(false));
    try { await this.hub.start(); this.live.set(true); } catch { this.live.set(false); }
  }

  async stop() {
    if (this.hub?.state !== HubConnectionState.Disconnected) await this.hub?.stop();
    this.hub = undefined; this.items.set([]); this.unread.set(0); this.live.set(false);
  }

  async refresh() {
    try {
      const r = await this.api.notifications();
      this.items.set(r.items); this.unread.set(r.unread); this.loadError.set(false);
    } catch { this.loadError.set(true); }
  }

  async markRead(n: AppNotification) {
    if (n.read) return;
    this.items.update((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    this.unread.update((u) => Math.max(0, u - 1));
    try { await this.api.markRead(n.id); } catch (e) { this.toasts.error(e); void this.refresh(); }
  }

  async markAllRead() {
    this.items.update((l) => l.map((x) => ({ ...x, read: true })));
    this.unread.set(0);
    try { await this.api.markAllRead(); } catch (e) { this.toasts.error(e); void this.refresh(); }
  }

  async remove(n: AppNotification) {
    this.items.update((l) => l.filter((x) => x.id !== n.id));
    if (!n.read) this.unread.update((u) => Math.max(0, u - 1));
    try { await this.api.deleteNotification(n.id); } catch (e) { this.toasts.error(e); void this.refresh(); }
  }

  async clear() {
    this.items.set([]); this.unread.set(0);
    try { await this.api.clearNotifications(); } catch (e) { this.toasts.error(e); void this.refresh(); }
  }
}
