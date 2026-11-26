import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface AuthUser { id: number; email: string; name: string; pictureUrl: string | null }
interface LoginResult { token: string; user: AuthUser }
interface AuthConfig { googleClientId: string | null; devLogin: boolean }

const TOKEN_KEY = 'daymaker.token';
const USER_KEY = 'daymaker.user';

declare const google: any; // Google Identity Services, loaded on demand

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly user = signal<AuthUser | null>(this.read());
  get token(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
  get isLoggedIn() { return !!this.token && !!this.user(); }

  config() { return firstValueFrom(this.http.get<AuthConfig>('/api/v1/auth/config')); }

  async loginWithGoogleCredential(idToken: string) {
    this.store(await firstValueFrom(this.http.post<LoginResult>('/api/v1/auth/google', { idToken })));
  }

  async devLogin() {
    this.store(await firstValueFrom(this.http.post<LoginResult>('/api/v1/auth/dev', {})));
  }

  /** Renders the Google sign-in button into the element. */
  async renderGoogleButton(el: HTMLElement, clientId: string, onDone: () => void, onError: (m: string) => void) {
    await this.loadGsi();
    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (r: { credential: string }) => {
        try { await this.loginWithGoogleCredential(r.credential); onDone(); }
        catch { onError('Google sign-in failed. Please try again.'); }
      },
    });
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
  }

  private gsiLoaded?: Promise<void>;
  private loadGsi() {
    return (this.gsiLoaded ??= new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load Google sign-in'));
      document.head.appendChild(s);
    }));
  }

  logout() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
    this.user.set(null);
    this.router.navigateByUrl('/login');
  }

  private store(r: LoginResult) {
    try { localStorage.setItem(TOKEN_KEY, r.token); localStorage.setItem(USER_KEY, JSON.stringify(r.user)); } catch { /* ignore */ }
    this.user.set(r.user);
  }

  private read(): AuthUser | null {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'); } catch { return null; }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token;
  const authed = token && req.url.startsWith('/api') ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    tap({
      error: (e) => {
        if (e instanceof HttpErrorResponse && e.status === 401 && !req.url.includes('/auth/')) auth.logout();
      },
    }),
  );
};
