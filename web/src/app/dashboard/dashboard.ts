import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'dm-dashboard',
  template: `
    <div class="page">
      <h1>Hello, {{ firstName() }}</h1>
      <p class="muted">Your dashboard will appear here.</p>
    </div>`,
})
export class Dashboard {
  private auth = inject(AuthService);
  firstName() { return (this.auth.user()?.name ?? '').replace(/^Dev /, '').split(' ')[0]; }
}
