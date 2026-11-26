import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { PreferencesService } from '../core/ui.services';
import { Icon } from '../shared/icon';
import { ConfirmDialog, ToastHost } from '../shared/overlays';

@Component({
  selector: 'dm-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, ToastHost, ConfirmDialog],
  template: `
    <div class="shell">
      <aside class="side" [class.open]="menu()">
        <a class="brand" routerLink="/"><span class="logo">D</span> Daymaker</a>
        <nav aria-label="Main">
          @for (n of nav; track n.path) {
            <a [routerLink]="n.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: n.path === '/' }">
              <dm-icon [name]="n.icon" /> {{ n.label }}
            </a>
          }
        </nav>
        <div class="spacer"></div>
        <div class="me">
          <div class="who"><strong>{{ auth.user()?.name }}</strong><span class="muted small">{{ auth.user()?.email }}</span></div>
          <button class="icon-btn" (click)="auth.logout()" aria-label="Sign out" title="Sign out"><dm-icon name="logout" /></button>
        </div>
      </aside>
      @if (menu()) { <div class="scrim" (click)="menu.set(false)"></div> }
      <div class="main">
        <header class="top">
          <button class="icon-btn menu-btn" (click)="menu.set(!menu())" aria-label="Menu"><dm-icon name="menu" [size]="22" /></button>
          <div class="slot-search"><!--search--></div>
          <div class="spacer"></div>
          <div class="slot-actions"><!--actions--></div>
        </header>
        <main><router-outlet /></main>
      </div>
    </div>
    <dm-toasts /><dm-confirm />`,
  styleUrl: './shell.css',
})
export class Shell {
  auth = inject(AuthService);
  menu = signal(false);
  nav = [
    { path: '/', label: 'Dashboard', icon: 'home' },
    { path: '/todos', label: 'Todos', icon: 'check-circle' },
    { path: '/calendar', label: 'Calendar', icon: 'calendar' },
    { path: '/notes', label: 'Notes', icon: 'note' },
    { path: '/today', label: 'Today', icon: 'sun' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ];

  constructor() {
    inject(PreferencesService).load();
    inject(Router).events.subscribe((e) => { if (e instanceof NavigationEnd) this.menu.set(false); });
  }
}
