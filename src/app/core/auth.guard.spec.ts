import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Component({ template: '' })
class DummyLoginComponent {}

describe('authGuard', () => {
  let authService: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.resetTestingModule();
    window.localStorage.clear();
    window.sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: DummyLoginComponent }])
      ]
    });

    authService = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  it('allows access when user is authenticated', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ sub: 'operator', exp: futureExp })).replace(/=/g, '');
    const validToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
    authService.token.set(validToken);

    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/report-builder' } as RouterStateSnapshot;

    const result = TestBed.runInInjectionContext(() => authGuard(route, state));
    expect(result).toBe(true);
  });

  it('redirects to /login when user is unauthenticated', () => {
    const route = {} as ActivatedRouteSnapshot;
    const state = { url: '/report-builder' } as RouterStateSnapshot;

    let navigatedUrl = '';
    router.navigate = ((commands: any[]) => {
      navigatedUrl = commands[0];
      return Promise.resolve(true);
    }) as any;

    const result = TestBed.runInInjectionContext(() => authGuard(route, state));
    expect(result).toBe(false);
    expect(navigatedUrl).toBe('/login');
  });
});
