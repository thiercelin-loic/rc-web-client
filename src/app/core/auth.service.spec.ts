import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AuthService } from './auth.service';

@Component({ template: '' })
class DummyLoginComponent {}

describe('AuthService', () => {
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
        provideRouter([{ path: 'login', component: DummyLoginComponent }])
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('initializes in unauthenticated state when storage is empty', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
    expect(service.getCurrentUser()).toBeNull();
  });

function createValidTestToken(username: string = 'testuser'): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = btoa(JSON.stringify({ sub: username, exp, role: 'ROLE_OPERATOR' }));
  return `${header}.${payload}.signature`;
}

  it('performs login successfully via backend API', async () => {
    const validToken = createValidTestToken('testuser');
    const loginPromise = new Promise<void>((resolve) => {
      service.login({ username: 'testuser', password: 'password123' }).subscribe((res) => {
        expect(res.token).toBe(validToken);
        expect(res.user.username).toBe('testuser');
        expect(service.isAuthenticated()).toBe(true);
        expect(service.getToken()).toBe(validToken);
        resolve();
      });
    });

    const req = httpMock.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    req.flush({
      token: validToken,
      tokenType: 'Bearer',
      user: {
        id: 'usr-1',
        username: 'testuser',
        email: 'testuser@enterprise.eu',
        fullName: 'Test User',
        role: 'ROLE_OPERATOR',
        tenantId: 'ws-90124-enterprise'
      }
    });

    await loginPromise;
  });

  it('performs signup successfully via backend API', async () => {
    const validToken = createValidTestToken('newuser');
    const signupPromise = new Promise<void>((resolve) => {
      service
        .signup({
          username: 'newuser',
          email: 'newuser@enterprise.eu',
          password: 'Password123!',
          fullName: 'New User',
          role: 'ROLE_OPERATOR'
        })
        .subscribe((res) => {
          expect(res.token).toBe(validToken);
          expect(res.user.username).toBe('newuser');
          expect(service.isAuthenticated()).toBe(true);
          resolve();
        });
    });

    const req = httpMock.expectOne('/api/auth/signup');
    expect(req.request.method).toBe('POST');
    req.flush({
      token: validToken,
      tokenType: 'Bearer',
      user: {
        id: 'usr-new',
        username: 'newuser',
        email: 'newuser@enterprise.eu',
        fullName: 'New User',
        role: 'ROLE_OPERATOR',
        tenantId: 'ws-90124-enterprise'
      }
    });

    await signupPromise;
  });

  it('handles logout by clearing tokens, resetting signals, and notifying server', () => {
    const validToken = createValidTestToken('testuser');
    service.token.set(validToken);
    service.logout();

    const logoutReq = httpMock.expectOne('/api/auth/logout');
    expect(logoutReq.request.method).toBe('POST');
    logoutReq.flush({ message: 'Logged out successfully.' });

    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
    expect(service.getCurrentUser()).toBeNull();
    expect(window.sessionStorage.getItem('rc_logged_out')).toBe('true');
  });

  it('correctly evaluates user roles with hasRole()', () => {
    expect(service.hasRole('ROLE_ADMIN')).toBe(false);

    service.currentUser.set({
      id: 'usr-admin',
      username: 'admin',
      email: 'admin@rollercoaster.com',
      fullName: 'Admin User',
      role: 'ROLE_ADMIN',
      tenantId: 'ws-90124-enterprise'
    });

    expect(service.hasRole('ROLE_ADMIN')).toBe(true);
    expect(service.hasRole('ROLE_OPERATOR')).toBe(true);
  });
});
