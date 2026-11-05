import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Functional Role-Based Authorization Guard.
 * Follows modern Angular practices (Matheus Luna, 2024).
 * Enforces role prerequisites (e.g. ROLE_ADMIN, ROLE_OPERATOR).
 */
export const roleGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  const expectedRoles = (route.data?.['roles'] as string[]) || [];
  if (expectedRoles.length === 0) {
    return true;
  }

  const hasMatchingRole = expectedRoles.some((role) => authService.hasRole(role));
  if (hasMatchingRole) {
    return true;
  }

  router.navigate(['/report-builder']);
  return false;
};
