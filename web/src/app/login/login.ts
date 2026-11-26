import { AfterViewInit, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'dm-login',
  template: `
    <div class="wrap">
      <div class="card box">
        <div class="logo">D</div>
        <h1>Daymaker</h1>
        <p class="muted">Todos, calendar and notes in one calm place.</p>

        @if (loading()) {
          <p class="muted">Loading…</p>
        } @else {
          <div #gbtn class="gbtn"></div>
          @if (!googleReady()) {
            <p class="banner warn small">Google sign-in is not configured on the server (<code>Google:ClientId</code>).</p>
          }
          @if (devLogin()) {
            <button class="btn" (click)="dev()">Continue as dev user</button>
            <p class="muted small">Development only — hidden in production.</p>
          }
        }
        @if (error()) { <p class="err small" role="alert">{{ error() }}</p> }
      </div>
    </div>`,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
    .box { width: min(100%, 380px); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.9rem; padding: 2rem; }
    .logo { display: grid; place-items: center; width: 3rem; height: 3rem; border-radius: 14px; background: var(--accent); color: var(--on-accent); font-weight: 700; font-size: 1.4rem; }
    p { margin: 0; } .gbtn { min-height: 44px; display: flex; justify-content: center; }`,
})
export class Login implements AfterViewInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private btn = viewChild<ElementRef<HTMLElement>>('gbtn');

  loading = signal(true);
  googleReady = signal(false);
  devLogin = signal(false);
  error = signal('');

  constructor() { if (this.auth.isLoggedIn) this.router.navigateByUrl('/'); }

  async ngAfterViewInit() {
    try {
      const cfg = await this.auth.config();
      this.devLogin.set(cfg.devLogin);
      this.googleReady.set(!!cfg.googleClientId);
      this.loading.set(false);
      if (cfg.googleClientId) {
        // wait one tick so the button container exists after loading=false
        setTimeout(() => this.auth.renderGoogleButton(this.btn()!.nativeElement, cfg.googleClientId!, () => this.router.navigateByUrl('/'),
          (m) => this.error.set(m)).catch(() => this.error.set('Could not load Google sign-in.')));
      }
    } catch {
      this.loading.set(false);
      this.error.set('Cannot reach the Daymaker server. Is the API running?');
    }
  }

  async dev() {
    try { await this.auth.devLogin(); this.router.navigateByUrl('/'); }
    catch { this.error.set('Dev login failed.'); }
  }
}
