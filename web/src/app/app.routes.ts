import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from './core/auth.service';

const authGuard: CanActivateFn = () => (inject(AuthService).isLoggedIn ? true : inject(Router).createUrlTree(['/login']));

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./login/login').then((m) => m.Login), title: 'Sign in · Daymaker' },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard), title: 'Dashboard · Daymaker' },
      { path: 'settings', loadComponent: () => import('./settings/settings').then((m) => m.Settings), title: 'Settings · Daymaker' },
      { path: 'calendar', loadComponent: () => import('./calendar/calendar').then((m) => m.Calendar), title: 'Calendar · Daymaker' },
      { path: 'todos', loadComponent: () => import('./todos/todos').then((m) => m.Todos), title: 'Todos · Daymaker' },
    ],
  },
  { path: '**', redirectTo: '' },
];
