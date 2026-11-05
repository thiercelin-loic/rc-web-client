import { HttpErrorResponse, HttpEventType, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { StateManagerService } from './state-manager.service';
import { AuthService } from './auth.service';

/**
 * Functional HTTP Authentication Interceptor.
 * Follows modern Angular practices (Matheus Luna, 2024).
 * Injects token from AuthService, manages security headers and handles 401 errors.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const state = inject(StateManagerService);
  const startedAt = performance.now();
  const exchangeUrl = `${req.urlWithParams}`;
  const method = req.method.toUpperCase();

  state.recordExchange('request', method, exchangeUrl, null, 0);

  const token = authService.getToken();
  const user = authService.getCurrentUser();
  const tenantId = user?.tenantId || 'ws-90124-enterprise';
  const role = user?.role || 'ROLE_OPERATOR';

  const headers: Record<string, string> = {
    'Accept-Language': 'fr-FR,de-DE;q=0.9,en-GB;q=0.8',
    'X-RollerCoaster-Tenant': tenantId,
    'X-RollerCoaster-RLS-Role': role
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cloned = req.clone({
    withCredentials: true,
    setHeaders: headers
  });

  return next(cloned).pipe(
    tap((event) => {
      if (event.type === HttpEventType.Response) {
        state.recordExchange(
          event.ok ? 'success' : 'error',
          method,
          exchangeUrl,
          event.status,
          performance.now() - startedAt
        );
      }
    }),
    catchError((error: HttpErrorResponse) => {
      state.recordExchange(
        'error',
        method,
        exchangeUrl,
        error.status || null,
        performance.now() - startedAt
      );

      // Handle 401 Unauthorized for authenticated endpoints
      if (error.status === 401 && !req.url.includes('/api/auth/login') && !req.url.includes('/api/auth/signup')) {
        authService.logout();
      }

      return throwError(() => error);
    })
  );
};
