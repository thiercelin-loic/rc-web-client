import {
  HttpErrorResponse,
  HttpEventType,
  HttpInterceptorFn,
} from "@angular/common/http";
import { inject } from "@angular/core";
import { catchError, tap, throwError } from "rxjs";
import { StateManagerService } from "./state-manager.service";
import { AuthService } from "./auth.service";

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const state = inject(StateManagerService);
  const startedAt = performance.now();
  const exchangeUrl = `${req.urlWithParams}`;
  const method = req.method.toUpperCase();

  state.recordExchange("request", method, exchangeUrl, null, 0);

  const token = authService.getToken();

  const headers: Record<string, string> = {
    "Accept-Language": "fr-FR,de-DE;q=0.9,en-GB;q=0.8",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const cloned = req.clone({
    withCredentials: true,
    setHeaders: headers,
  });

  return next(cloned).pipe(
    tap((event) => {
      if (event.type === HttpEventType.Response) {
        state.recordExchange(
          event.ok ? "success" : "error",
          method,
          exchangeUrl,
          event.status,
          performance.now() - startedAt,
        );
      }
    }),
    catchError((error: HttpErrorResponse) => {
      state.recordExchange(
        "error",
        method,
        exchangeUrl,
        error.status || null,
        performance.now() - startedAt,
      );

      if (
        error.status === 401 &&
        !req.url.includes("/api/auth/login") &&
        !req.url.includes("/api/auth/signup")
      ) {
        authService.logout();
      }

      return throwError(() => error);
    }),
  );
};
