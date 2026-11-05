import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    });
  });

  it('renders login form elements and accessible controls', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const usernameInput = fixture.nativeElement.querySelector('#login-username-input') as HTMLInputElement;
    const passwordInput = fixture.nativeElement.querySelector('#login-password-input') as HTMLInputElement;
    const submitBtn = fixture.nativeElement.querySelector('#login-submit-btn') as HTMLButtonElement;
    const passwordToggle = fixture.nativeElement.querySelector('#login-password-toggle-btn') as HTMLButtonElement;

    expect(usernameInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    expect(submitBtn).not.toBeNull();
    expect(passwordToggle).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Log In');
  });

  it('toggles password visibility', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const passwordInput = fixture.nativeElement.querySelector('#login-password-input') as HTMLInputElement;
    const passwordToggle = fixture.nativeElement.querySelector('#login-password-toggle-btn') as HTMLButtonElement;

    expect(passwordInput.type).toBe('password');
    passwordToggle.click();
    fixture.detectChanges();
    expect(passwordInput.type).toBe('text');
  });

  it('populates credentials accurately via signals', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.username.set('analyst');
    comp.password.set('Analyst123!');
    expect(comp.username()).toBe('analyst');
    expect(comp.password()).toBe('Analyst123!');
  });
});

