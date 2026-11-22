import { Component } from "@angular/core";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AuthService } from "./auth.service";

@Component({ template: "" })
class DummyLoginComponent {}

describe("AuthService", () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    window.localStorage.clear();
    window.sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: "login", component: DummyLoginComponent }]),
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("initializes in unauthenticated state when storage is empty", () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
    expect(service.getUser()).toBeNull();
  });

  function buildToken(username: string = "testuser"): string {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(
      JSON.stringify({ sub: username, exp }),
    );
    return `${header}.${payload}.signature`;
  }

  it("performs login successfully via backend API", async () => {
    const validToken = buildToken("testuser");
    const loginPromise = new Promise<void>((resolve) => {
      service
        .login({ username: "testuser", password: "password123" })
        .subscribe((res) => {
          expect(res.token).toBe(validToken);
          expect(res.user.username).toBe("testuser");
          expect(service.isAuthenticated()).toBe(true);
          expect(service.getToken()).toBe(validToken);
          resolve();
        });
    });

    const req = httpMock.expectOne("/api/auth/login");
    expect(req.request.method).toBe("POST");
    req.flush({
      token: validToken,
      tokenType: "Bearer",
      user: {
        id: "usr-1",
        username: "testuser",
        email: "testuser@enterprise.eu",
        fullName: "Test User",
      },
    });

    await loginPromise;
  });

  it("performs signup successfully via backend API", async () => {
    const validToken = buildToken("newuser");
    const signupPromise = new Promise<void>((resolve) => {
      service
        .signup({
          username: "newuser",
          email: "newuser@enterprise.eu",
          password: "Password123!",
          fullName: "New User",
        })
        .subscribe((res) => {
          expect(res.token).toBe(validToken);
          expect(res.user.username).toBe("newuser");
          expect(service.isAuthenticated()).toBe(true);
          resolve();
        });
    });

    const req = httpMock.expectOne("/api/auth/signup");
    expect(req.request.method).toBe("POST");
    req.flush({
      token: validToken,
      tokenType: "Bearer",
      user: {
        id: "usr-new",
        username: "newuser",
        email: "newuser@enterprise.eu",
        fullName: "New User",
      },
    });

    await signupPromise;
  });

  it("handles logout by clearing tokens, resetting signals, and notifying server", () => {
    const validToken = buildToken("testuser");
    service.token.set(validToken);
    service.logout();

    const logoutReq = httpMock.expectOne("/api/auth/logout");
    expect(logoutReq.request.method).toBe("POST");
    logoutReq.flush({ message: "Logged out successfully." });

    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
    expect(service.getUser()).toBeNull();
    expect(window.sessionStorage.getItem("rc_logged_out")).toBe("true");
  });
});
