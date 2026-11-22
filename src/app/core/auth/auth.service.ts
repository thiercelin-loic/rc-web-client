import { HttpClient } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { Observable, tap } from "rxjs";
import {
  AUTH_LOGIN_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_SIGNUP_PATH,
  LEGACY_TOKEN_STORAGE_KEY,
  LOGGED_OUT_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
} from "./auth.constants";
import {
  AuthResponse,
  JwtClaims,
  LoginCredentials,
  SignupData,
  UserProfile,
} from "./auth.interface";

export type {
  AuthResponse,
  JwtClaims,
  LoginCredentials,
  SignupData,
  UserProfile,
} from "./auth.interface";

@Injectable({
  providedIn: "root",
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  public readonly token = signal<string | null>(this.loadToken());
  public readonly currentUser = signal<UserProfile | null>(this.loadUser());

  public readonly isAuthenticated = computed(() => {
    const activeToken = this.token();
    if (!activeToken) {
      return false;
    }
    return !this.isExpired(activeToken);
  });

  public readonly userInitials = computed(() => {
    const user = this.currentUser();
    if (!user) {
      return "";
    }
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
    return this.http.post<AuthResponse>(AUTH_LOGIN_PATH, credentials).pipe(
      tap((res) => {
        this.saveSession(res.token, res.user);
      }),
    );
  }

  public signup(data: SignupData): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(AUTH_SIGNUP_PATH, data).pipe(
      tap((res) => {
        this.saveSession(res.token, res.user);
      }),
    );
  }

  public logout(): void {
    if (this.token()) {
      this.http.post(AUTH_LOGOUT_PATH, {}).subscribe({
        next: () => {},
        error: () => {},
      });
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(USER_STORAGE_KEY);
      window.sessionStorage.removeItem(USER_STORAGE_KEY);
      window.sessionStorage.setItem(LOGGED_OUT_STORAGE_KEY, "true");
    }

    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(["/login"]);
  }

  public getToken(): string | null {
    return this.token();
  }

  public getUser(): UserProfile | null {
    return this.currentUser();
  }

  public decodeToken(token: string): JwtClaims | null {
    if (!token) {
      return null;
    }
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }
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

  private isExpired(token: string): boolean {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.exp) {
        return true;
      }
      const currentSeconds = Math.floor(Date.now() / 1000);
      return currentSeconds >= decoded.exp;
    } catch {
      return true;
    }
  }

  public setSession(token: string, user: UserProfile): void {
    this.saveSession(token, user);
  }

  public saveSession(token: string, user: UserProfile): void {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      window.sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      window.sessionStorage.removeItem(LOGGED_OUT_STORAGE_KEY);
    }
    this.token.set(token);
    this.currentUser.set(user);
  }

  private loadToken(): string | null {
    if (typeof window === "undefined") {
      return null;
    }
    if (window.sessionStorage.getItem(LOGGED_OUT_STORAGE_KEY) === "true") {
      return null;
    }
    return (
      window.localStorage.getItem(TOKEN_STORAGE_KEY) ||
      window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY) ||
      null
    );
  }

  private loadUser(): UserProfile | null {
    if (typeof window === "undefined") {
      return null;
    }
    if (window.sessionStorage.getItem(LOGGED_OUT_STORAGE_KEY) === "true") {
      return null;
    }

    const storedUserJson =
      window.localStorage.getItem(USER_STORAGE_KEY) ||
      window.sessionStorage.getItem(USER_STORAGE_KEY);
    if (storedUserJson) {
      try {
        return JSON.parse(storedUserJson) as UserProfile;
      } catch {
        // proceed to token fallback
      }
    }

    const token = this.loadToken();
    if (token) {
      const decoded = this.decodeToken(token);
      if (decoded && decoded.sub) {
        return {
          id: decoded.userId || "usr-" + decoded.sub,
          username: decoded.sub,
          email: decoded.email || `${decoded.sub}@rollercoaster.com`,
          fullName: decoded.fullName || decoded.sub,
        };
      }
    }
    return null;
  }
}
