import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api.service';
import { relativeTime } from '../core/dates';
import { ApiTokenInfo, GoogleCalendarInfo, GoogleStatus, Preferences } from '../core/models';
import { Confirm, PreferencesService, Toasts } from '../core/ui.services';
import { Icon } from '../shared/icon';

const ACCENTS = ['#007aff', '#5856d6', '#af52de', '#ff2d55', '#ff3b30', '#ff9500', '#34c759', '#30b0c7'];

@Component({
  selector: 'dm-settings',
  imports: [FormsModule, Icon],
  template: `
    <div class="page narrow">
      <div class="page-head"><h1>Settings</h1><span class="spacer"></span>
        @if (prefsSvc.saving()) { <span class="muted small">Saving…</span> } @else { <span class="muted small">Changes save automatically</span> }</div>

      <section class="card stack" aria-labelledby="h-app">
        <h2 id="h-app">Appearance</h2>
        <div class="line"><span>Theme</span>
          <div class="seg">@for (t of themes; track t.v) { <button [class.on]="p().theme === t.v" (click)="set({ theme: t.v })">{{ t.l }}</button> }</div></div>
        <div class="line"><span>Accent colour</span>
          <div class="row">
            @for (c of accents; track c) {
              <button class="sw" [style.background]="c" [style.color]="c" [class.on]="p().accent === c" (click)="set({ accent: c })" [attr.aria-label]="'Accent ' + c"></button>
            }
            <input type="color" [value]="p().accent" (input)="set({ accent: $any($event.target).value })" aria-label="Custom accent colour" />
          </div></div>
        <div class="line"><span>Font size</span>
          <div class="seg">@for (s of sizes; track s) { <button [class.on]="p().fontSize === s" (click)="set({ fontSize: s })">{{ s }}</button> }</div></div>
        <div class="line"><span>Spacing</span>
          <div class="seg">@for (s of spacings; track s) { <button [class.on]="p().spacing === s" (click)="set({ spacing: s })">{{ s }}</button> }</div></div>
        <div class="line"><span>Todo layout</span>
          <div class="seg">@for (s of todoLayouts; track s.v) { <button [class.on]="p().todoLayout === s.v" (click)="set({ todoLayout: s.v })"><dm-icon [name]="s.i" [size]="15" /> {{ s.l }}</button> }</div></div>
        <div class="line"><span>Notes layout</span>
          <div class="seg">@for (s of noteLayouts; track s.v) { <button [class.on]="p().noteLayout === s.v" (click)="set({ noteLayout: s.v })">{{ s.l }}</button> }</div></div>
      </section>

      <section class="card stack" aria-labelledby="h-notif">
        <h2 id="h-notif">Notifications</h2>
        <label class="line"><span>Approaching deadlines and reminders</span><input type="checkbox" class="switch" [checked]="p().notifyDeadlines" (change)="set({ notifyDeadlines: $any($event.target).checked })" /></label>
        <label class="line"><span>New or changed calendar meetings</span><input type="checkbox" class="switch" [checked]="p().notifyMeetings" (change)="set({ notifyMeetings: $any($event.target).checked })" /></label>
        <label class="line"><span>Task updates (e.g. made by Claude or Google Calendar)</span><input type="checkbox" class="switch" [checked]="p().notifyTaskUpdates" (change)="set({ notifyTaskUpdates: $any($event.target).checked })" /></label>
        <label class="line"><span>Daily summary (8:00 UTC)</span><input type="checkbox" class="switch" [checked]="p().notifyDailySummary" (change)="set({ notifyDailySummary: $any($event.target).checked })" /></label>
      </section>

      <section class="card stack" aria-labelledby="h-google">
        <h2 id="h-google">Google Calendar</h2>
        @if (googleMsg(); as m) { <div class="banner {{ m.kind }}" role="status">{{ m.text }}</div> }
        @if (!google()) { <p class="muted">Loading…</p> }
        @else if (!google()!.configured) {
          <p class="banner warn">Google is not configured on the server. Set <code>Google:ClientId</code> and <code>Google:ClientSecret</code>, then restart the API.</p>
        } @else if (!google()!.connected) {
          <p class="muted">Connect your Google account to see meetings next to your tasks, add tasks to your calendar, and keep both in sync.</p>
          <div><button class="btn primary" (click)="connect()" [disabled]="busy()"><dm-icon name="calendar" /> Connect Google Calendar</button></div>
        } @else {
          <div class="row">
            <span class="chip meeting"><dm-icon name="cloud" [size]="12" /> Connected</span>
            <span class="muted small">{{ syncLabel() }}</span><span class="spacer"></span>
            <button class="btn sm" (click)="syncNow()" [disabled]="busy()"><dm-icon name="refresh" [size]="14" /> Sync now</button>
          </div>
          @if (google()!.lastError) {
            <div class="banner error">Last sync failed: {{ google()!.lastError }}
              <div class="small">If this persists, try <button class="btn sm" (click)="connect()">reconnecting</button>.</div></div>
          }
          <h3>Calendars to show</h3>
          @for (c of calendars(); track c.id) {
            <label class="line"><span>{{ c.name }} @if (c.primary) { <span class="chip">primary</span> }</span>
              <input type="checkbox" class="switch" [checked]="c.selected" (change)="toggleCalendar(c, $any($event.target).checked)" /></label>
          }
          <label class="line"><span>Two-way sync <span class="muted small">(changes to linked meetings update the task)</span></span>
            <input type="checkbox" class="switch" [checked]="google()!.twoWaySync" (change)="setTwoWay($any($event.target).checked)" /></label>
          <div class="row">
            <button class="btn" (click)="connect()" [disabled]="busy()">Reconnect</button>
            <button class="btn danger" (click)="disconnect()" [disabled]="busy()">Disconnect</button>
          </div>
        }
      </section>

      <section class="card stack" aria-labelledby="h-claude">
        <h2 id="h-claude">Claude access (MCP)</h2>
        <p class="muted">Let Claude Code create and manage your todos, notes and calendar events. Each token limits what Claude may do.</p>
        <form class="row" (ngSubmit)="createToken()">
          <input type="text" name="tn" [(ngModel)]="tokenName" placeholder="Token name, e.g. Claude Code on laptop" style="flex:1 1 220px" aria-label="Token name" />
          <label class="row"><input type="checkbox" name="w" [(ngModel)]="canWrite" /> Create &amp; edit</label>
          <label class="row"><input type="checkbox" name="d" [(ngModel)]="canDelete" /> Delete</label>
          <button class="btn primary" type="submit" [disabled]="!tokenName.trim()">Create token</button>
        </form>
        @if (newToken()) {
          <div class="banner ok stack">
            <strong>Copy this token now — it will not be shown again.</strong>
            <code class="tok">{{ newToken() }}</code>
            <div class="small">Register the MCP server in Claude Code:</div>
            <code class="tok">claude mcp add daymaker -e DAYMAKER_TOKEN={{ newToken() }} -e DAYMAKER_API_URL={{ apiUrl }} -- dotnet run --project src/Daymaker.Mcp</code>
            <div><button class="btn sm" (click)="copy(newToken()!)">Copy token</button></div>
          </div>
        }
        @for (t of tokens(); track t.id) {
          <div class="line"><span><strong>{{ t.name }}</strong>
            <span class="muted small"> · {{ perms(t) }} · {{ t.lastUsedUtc ? 'used ' + rel(t.lastUsedUtc) : 'never used' }}</span></span>
            <button class="btn sm danger" (click)="revoke(t)">Revoke</button></div>
        }
      </section>
    </div>`,
  styles: `
    .narrow { max-width: 720px; } section { margin-bottom: 1.6rem; padding: 0.4rem 1.2rem 0.9rem; gap: 0; }
    section > h2 { padding: 0.9rem 0 0.4rem; }
    section > p { margin: 0.2rem 0 0.6rem; }
    .line { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.72rem 0; border-bottom: 0.5px solid var(--border); min-height: 3rem; }
    .line:last-child { border-bottom: 0; } section > .row, section > div:not(.line):not(.banner) { margin-top: 0.7rem; }
    section > .banner { margin: 0.5rem 0; }
    .seg button { text-transform: capitalize; display: inline-flex; gap: 0.3rem; align-items: center; }
    .sw { width: 1.75rem; height: 1.75rem; border-radius: 50%; border: 0; cursor: pointer; box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 15%); transition: transform 0.15s var(--ease); }
    .sw:hover { transform: scale(1.1); } .sw.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px currentColor; }
    .tok { display: block; padding: 0.5rem 0.7rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow-wrap: anywhere; user-select: all; }`,
})
export class Settings {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  prefsSvc = inject(PreferencesService);

  p = this.prefsSvc.prefs;
  accents = ACCENTS;
  themes = [{ v: 'system', l: 'System' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }] as const;
  sizes = ['small', 'medium', 'large'] as const;
  spacings = ['comfortable', 'compact'] as const;
  todoLayouts = [{ v: 'list', l: 'List', i: 'list' }, { v: 'grid', l: 'Cards', i: 'grid' }, { v: 'kanban', l: 'Kanban', i: 'columns' }] as const;
  noteLayouts = [{ v: 'grid', l: 'Grid' }, { v: 'list', l: 'List' }, { v: 'document', l: 'Document' }] as const;
  apiUrl = location.origin;

  google = signal<GoogleStatus | null>(null);
  calendars = signal<GoogleCalendarInfo[]>([]);
  googleMsg = signal<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  busy = signal(false);
  tokens = signal<ApiTokenInfo[]>([]);
  newToken = signal<string | null>(null);
  tokenName = ''; canWrite = true; canDelete = false;

  syncLabel = computed(() => {
    const g = this.google();
    return g?.lastSyncUtc ? `Last synced ${relativeTime(g.lastSyncUtc)}` : 'Not synced yet';
  });

  constructor() {
    const result = this.route.snapshot.queryParamMap.get('google');
    if (result) {
      this.googleMsg.set(result === 'connected' ? { kind: 'ok', text: 'Google Calendar connected.' }
        : result === 'denied' ? { kind: 'warn', text: 'Google access was not granted.' }
        : { kind: 'error', text: 'Connecting to Google failed. Please try again.' });
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
    void this.loadGoogle();
    void this.loadTokens();
  }

  set(patch: Partial<Preferences>) { this.prefsSvc.update(patch); }
  rel(iso: string) { return relativeTime(iso); }
  perms(t: ApiTokenInfo) { return t.canDelete ? 'read, write, delete' : t.canWrite ? 'read, write' : 'read only'; }

  async loadGoogle() {
    try {
      const g = await this.api.googleStatus();
      this.google.set(g);
      if (g.connected) this.calendars.set(await this.api.googleCalendars().catch(() => []));
    } catch (e) { this.toasts.error(e, 'Could not load Google status'); }
  }

  async connect() {
    this.busy.set(true);
    try { location.href = (await this.api.googleConnectUrl()).url; }
    catch (e) { this.toasts.error(e); this.busy.set(false); }
  }

  async syncNow() {
    this.busy.set(true);
    try {
      const r = await this.api.googleSync();
      await this.loadGoogle();
      this.toasts.show(r.lastError ? `Sync failed: ${r.lastError}` : `Synced — ${r.added} new, ${r.changed} changed, ${r.removed} removed`, r.lastError ? 'error' : 'ok');
    } catch (e) { this.toasts.error(e, 'Sync failed'); }
    finally { this.busy.set(false); }
  }

  async toggleCalendar(c: GoogleCalendarInfo, on: boolean) {
    const next = this.calendars().map((x) => (x.id === c.id ? { ...x, selected: on } : x));
    const ids = next.filter((x) => x.selected).map((x) => (x.primary ? 'primary' : x.id));
    if (!ids.length) { this.toasts.show('Keep at least one calendar selected.', 'error'); this.calendars.set([...this.calendars()]); return; }
    await this.saveGoogle(ids, this.google()!.twoWaySync, () => this.calendars.set(next));
  }
  async setTwoWay(on: boolean) { await this.saveGoogle(this.google()!.selectedCalendars, on, () => this.google.update((g) => g && { ...g, twoWaySync: on })); }

  private async saveGoogle(ids: string[], twoWay: boolean, apply: () => void) {
    this.busy.set(true);
    try { await this.api.googleSettings(ids, twoWay); apply(); await this.loadGoogle(); this.toasts.show('Sync settings saved'); }
    catch (e) { this.toasts.error(e, 'Could not save sync settings'); await this.loadGoogle(); }
    finally { this.busy.set(false); }
  }

  async disconnect() {
    if (!(await this.confirm.ask('Disconnect Google Calendar? Meetings will disappear from Daymaker and linked tasks stop syncing. Your Google events are not deleted.', 'Disconnect'))) return;
    this.busy.set(true);
    try { await this.api.googleDisconnect(); this.calendars.set([]); await this.loadGoogle(); this.toasts.show('Google Calendar disconnected'); }
    catch (e) { this.toasts.error(e); }
    finally { this.busy.set(false); }
  }

  async loadTokens() { try { this.tokens.set(await this.api.apiTokens()); } catch { /* shown empty */ } }

  async createToken() {
    try {
      const r = await this.api.createApiToken(this.tokenName.trim(), this.canWrite, this.canDelete);
      this.newToken.set(r.token); this.tokenName = ''; await this.loadTokens();
    } catch (e) { this.toasts.error(e, 'Could not create the token'); }
  }

  async revoke(t: ApiTokenInfo) {
    if (!(await this.confirm.ask(`Revoke "${t.name}"? Anything using it will stop working.`, 'Revoke'))) return;
    try { await this.api.deleteApiToken(t.id); await this.loadTokens(); this.toasts.show('Token revoked'); }
    catch (e) { this.toasts.error(e); }
  }

  async copy(text: string) {
    try { await navigator.clipboard.writeText(text); this.toasts.show('Copied'); } catch { this.toasts.show('Select the text and copy it manually.', 'info'); }
  }
}
