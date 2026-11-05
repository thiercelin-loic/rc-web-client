import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Functional Guest Guard.
 * Redirects already authenticated operators/users from /login or /signup directly to the workspace.
 */
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    router.navigate(['/report-builder']);
    return false;
  }

  return true;
};
