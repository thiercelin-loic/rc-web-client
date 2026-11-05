import { Injectable, computed, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { Observable, catchError, of, tap, throwError } from "rxjs";

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  tenantId?: string;
}

export interface AuthResponse {
  token: string;
  tokenType: string;
  user: UserProfile;
  message?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface SignupData {
  username: string;
  email: string;
  password: string;
  fullName: string;
  role?: string;
}

export interface JwtClaims {
  sub?: string;
  userId?: string;
  fullName?: string;
  exp?: number;
  iat?: number;
  role?: string;
  email?: string;
  tenantId?: string;
}

/**
 * Authentication & Authorization Service.
 * Follows modern Angular practices (Matheus Luna, 2024).
 * Manages reactive signals, token lifecycle, role checking and route guards.
 */
@Injectable({
  providedIn: "root",
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly authUrl = "/api/auth";

  public readonly token = signal<string | null>(this.loadStoredToken());
  public readonly currentUser = signal<UserProfile | null>(
    this.loadStoredUser(),
  );

  public readonly isAuthenticated = computed(() => {
    const t = this.token();
    if (!t) return false;
    return !this.isTokenExpired(t);
  });

  public readonly userRole = computed(() => {
    return this.currentUser()?.role ?? null;
  });

  public readonly userInitials = computed(() => {
    const user = this.currentUser();
    if (!user) return "";
    if (user.fullName && user.fullName.trim().length > 0) {
      const parts = user.fullName.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return user.fullName.substring(0, 2).toUpperCase();
    }
    return user.username.substring(0, 2).toUpperCase();
  });

  public login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.authUrl}/login`, credentials)
      .pipe(
        tap((res) => {
          this.saveAuthSession(res.token, res.user);
        }),
      );
  }

  public signup(data: SignupData): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.authUrl}/signup`, data).pipe(
      tap((res) => {
        this.saveAuthSession(res.token, res.user);
      }),
    );
  }

  public logout(): void {
    if (this.token()) {
      this.http.post(`${this.authUrl}/logout`, {}).subscribe({
        next: () => {},
        error: () => {},
      });
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem("rc_auth_token");
      window.sessionStorage.removeItem("rc_auth_token");
      window.localStorage.removeItem("token");
      window.localStorage.removeItem("rc_user");
      window.sessionStorage.removeItem("rc_user");
      window.sessionStorage.setItem("rc_logged_out", "true");
    }

    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(["/login"]);
  }

  public getToken(): string | null {
    return this.token();
  }

  public getUserRole(): string | null {
    return this.userRole();
  }

  public getCurrentUser(): UserProfile | null {
    return this.currentUser();
  }

  public hasRole(role: string): boolean {
    const current = this.userRole();
    if (!current) return false;
    const normalizedTarget = role.startsWith("ROLE_")
      ? role
      : `ROLE_${role.toUpperCase()}`;
    const normalizedCurrent = current.startsWith("ROLE_")
      ? current
      : `ROLE_${current.toUpperCase()}`;
    return (
      normalizedCurrent === normalizedTarget ||
      normalizedCurrent === "ROLE_ADMIN"
    );
  }

  public decodeToken(token: string): JwtClaims | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join(""),
      );
      return JSON.parse(jsonPayload) as JwtClaims;
    } catch {
      return null;
    }
  }

  private isTokenExpired(token: string): boolean {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.exp) return true;
      const currentSeconds = Math.floor(Date.now() / 1000);
      return currentSeconds >= decoded.exp;
    } catch {
      return true;
    }
  }

  public setSession(token: string, user: UserProfile): void {
    this.saveAuthSession(token, user);
  }

  public saveAuthSession(token: string, user: UserProfile): void {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("rc_auth_token", token);
      window.sessionStorage.setItem("rc_auth_token", token);
      window.localStorage.setItem("token", token);
      window.localStorage.setItem("rc_user", JSON.stringify(user));
      window.sessionStorage.setItem("rc_user", JSON.stringify(user));
      window.sessionStorage.removeItem("rc_logged_out");
    }
    this.token.set(token);
    this.currentUser.set(user);
  }

  private loadStoredToken(): string | null {
    if (typeof window === "undefined") {
      return null;
    }
    if (window.sessionStorage.getItem("rc_logged_out") === "true") {
      return null;
    }
    return (
      window.localStorage.getItem("rc_auth_token") ||
      window.sessionStorage.getItem("rc_auth_token") ||
      window.localStorage.getItem("token") ||
      null
    );
  }

  private loadStoredUser(): UserProfile | null {
    if (typeof window === "undefined") {
      return null;
    }
    if (window.sessionStorage.getItem("rc_logged_out") === "true") {
      return null;
    }

    const storedUserJson =
      window.localStorage.getItem("rc_user") ||
      window.sessionStorage.getItem("rc_user");
    if (storedUserJson) {
      try {
        return JSON.parse(storedUserJson);
      } catch {
        // proceed
      }
    }

    const token = this.loadStoredToken();
    if (token) {
      const decoded = this.decodeToken(token);
      if (decoded && decoded.sub) {
        return {
          id: decoded.userId || "usr-" + decoded.sub,
          username: decoded.sub,
          email: decoded.email || `${decoded.sub}@rollercoaster.com`,
          fullName: decoded.fullName || decoded.sub,
          role: decoded.role || "ROLE_OPERATOR",
          tenantId: decoded.tenantId || "ws-90124-enterprise",
        };
      }
    }
    return null;
  }
}
