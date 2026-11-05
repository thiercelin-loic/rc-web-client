import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SignupComponent } from './signup.component';
import { StateManagerService } from '../../core/state-manager.service';

describe('SignupComponent', () => {
  let fixture: ComponentFixture<SignupComponent>;
  let component: SignupComponent;
  let httpMock: HttpTestingController;
  let router: Router;
  let stateService: StateManagerService;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    window.localStorage.clear();
    window.sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [SignupComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SignupComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    stateService = TestBed.inject(StateManagerService);

    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  describe('Template & Accessibility Rendering', () => {
    it('renders all registration form controls, inputs, and accessible elements', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const fullNameInput = compiled.querySelector('#signup-fullname-input') as HTMLInputElement;
      const usernameInput = compiled.querySelector('#signup-username-input') as HTMLInputElement;
      const emailInput = compiled.querySelector('#signup-email-input') as HTMLInputElement;
      const passwordInput = compiled.querySelector('#signup-password-input') as HTMLInputElement;
      const confirmPasswordInput = compiled.querySelector('#signup-confirm-password-input') as HTMLInputElement;
      const roleSelect = compiled.querySelector('#signup-role-select') as HTMLSelectElement;
      const consentCheckbox = compiled.querySelector('#signup-gdpr-consent') as HTMLInputElement;
      const submitBtn = compiled.querySelector('#signup-submit-btn') as HTMLButtonElement;
      const signinLink = compiled.querySelector('#signup-to-login-link') as HTMLAnchorElement;

      expect(fullNameInput).not.toBeNull();
      expect(usernameInput).not.toBeNull();
      expect(emailInput).not.toBeNull();
      expect(passwordInput).not.toBeNull();
      expect(confirmPasswordInput).not.toBeNull();
      expect(roleSelect).not.toBeNull();
      expect(consentCheckbox).not.toBeNull();
      expect(submitBtn).not.toBeNull();
      expect(signinLink).not.toBeNull();
      expect(compiled.textContent).toContain('Create your account');
      expect(compiled.textContent).toContain('RollerCoaster');
    });

    it('toggles password and confirm password visibilities independently', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const passwordInput = compiled.querySelector('#signup-password-input') as HTMLInputElement;
      const confirmPasswordInput = compiled.querySelector('#signup-confirm-password-input') as HTMLInputElement;
      const passToggle = compiled.querySelector('#signup-password-toggle-btn') as HTMLButtonElement;
      const confirmPassToggle = compiled.querySelector('#signup-confirm-password-toggle-btn') as HTMLButtonElement;

      expect(passwordInput.type).toBe('password');
      expect(confirmPasswordInput.type).toBe('password');

      passToggle.click();
      fixture.detectChanges();
      expect(passwordInput.type).toBe('text');
      expect(confirmPasswordInput.type).toBe('password');

      confirmPassToggle.click();
      fixture.detectChanges();
      expect(passwordInput.type).toBe('text');
      expect(confirmPasswordInput.type).toBe('text');

      passToggle.click();
      confirmPassToggle.click();
      fixture.detectChanges();
      expect(passwordInput.type).toBe('password');
      expect(confirmPasswordInput.type).toBe('password');
    });
  });

  describe('Password Strength Computation', () => {
    it('evaluates password strength according to length and character entropy', () => {
      component.password.set('');
      expect(component.passwordStrength().percent).toBe(0);
      expect(component.passwordStrength().label).toBe('Empty');

      component.password.set('abc');
      expect(component.passwordStrength().percent).toBe(25);
      expect(component.passwordStrength().label).toContain('Too short');

      component.password.set('simplepass');
      expect(component.passwordStrength().percent).toBe(50);
      expect(component.passwordStrength().label).toBe('Fair');

      component.password.set('SimplePass123');
      expect(component.passwordStrength().percent).toBe(75);
      expect(component.passwordStrength().label).toBe('Good');

      component.password.set('EnterpriseP@ssw0rd!');
      expect(component.passwordStrength().percent).toBe(100);
      expect(component.passwordStrength().label).toBe('Strong');
    });
  });

  describe('Reactive Form Validation (isFormValid)', () => {
    it('correctly tracks form validity as input signals update', () => {
      expect(component.isFormValid()).toBe(false);

      component.fullName.set('Marie Curie');
      component.username.set('mcurie');
      component.email.set('mcurie@enterprise.eu');
      component.password.set('Password123!');
      expect(component.isFormValid()).toBe(false);

      component.confirmPassword.set('DifferentPassword!');
      expect(component.isFormValid()).toBe(false);

      component.confirmPassword.set('Password123!');
      expect(component.isFormValid()).toBe(true);

      component.consentGiven.set(false);
      expect(component.isFormValid()).toBe(false);

      component.consentGiven.set(true);
      expect(component.isFormValid()).toBe(true);
    });

    it('disables the submit button until all validation criteria are met', () => {
      const submitBtn = fixture.nativeElement.querySelector('#signup-submit-btn') as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);

      component.fullName.set('Ada Lovelace');
      component.username.set('alovelace');
      component.email.set('ada@enterprise.eu');
      component.password.set('AnalyticalEngine1843!');
      component.confirmPassword.set('AnalyticalEngine1843!');
      component.consentGiven.set(true);
      fixture.detectChanges();

      expect(submitBtn.disabled).toBe(false);
    });
  });

  describe('Registration Submission Flow', () => {
    it('sets validation error when submitting with mismatched passwords', () => {
      component.fullName.set('Ada Lovelace');
      component.username.set('alovelace');
      component.email.set('ada@enterprise.eu');
      component.password.set('Secret123!');
      component.confirmPassword.set('Mismatch123!');

      component.onSubmit();
      fixture.detectChanges();

      expect(component.errorMessage()).toBe('Passwords do not match.');
      expect(component.isSubmitting()).toBe(false);
      httpMock.expectNone('/api/auth/signup');
    });

    it('sets generic validation error when submitting with empty required fields', () => {
      component.fullName.set('');

      component.onSubmit();
      fixture.detectChanges();

      expect(component.errorMessage()).toBe('Please fill out all required fields correctly.');
      expect(component.isSubmitting()).toBe(false);
      httpMock.expectNone('/api/auth/signup');
    });

    it('successfully registers account, announces state, and navigates to workspace', () => {
      vi.useFakeTimers();
      const navigateSpy = vi.spyOn(router, 'navigate');
      const announceSpy = vi.spyOn(stateService, 'announce');

      component.fullName.set('Marie Curie');
      component.username.set('mcurie');
      component.email.set('mcurie@enterprise.eu');
      component.password.set('Radium1898!');
      component.confirmPassword.set('Radium1898!');
      component.role.set('ROLE_OPERATOR');
      component.consentGiven.set(true);

      component.onSubmit();
      expect(component.isSubmitting()).toBe(true);

      const req = httpMock.expectOne('/api/auth/signup');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        fullName: 'Marie Curie',
        username: 'mcurie',
        email: 'mcurie@enterprise.eu',
        password: 'Radium1898!',
        role: 'ROLE_OPERATOR'
      });

      req.flush({
        token: 'new-user-token',
        tokenType: 'Bearer',
        user: {
          id: 'usr-new',
          username: 'mcurie',
          email: 'mcurie@enterprise.eu',
          fullName: 'Marie Curie',
          role: 'ROLE_OPERATOR',
          tenantId: 'ws-enterprise'
        }
      });

      expect(component.isSubmitting()).toBe(false);
      expect(component.successMessage()).toBe('Account registered! Redirecting to workspace...');
      expect(announceSpy).toHaveBeenCalledWith('Account created for mcurie');

      vi.advanceTimersByTime(450);
      expect(navigateSpy).toHaveBeenCalledWith(['/report-builder']);
    });

    it('handles registration failure from backend API', () => {
      component.fullName.set('Marie Curie');
      component.username.set('mcurie');
      component.email.set('mcurie@enterprise.eu');
      component.password.set('Radium1898!');
      component.confirmPassword.set('Radium1898!');
      component.consentGiven.set(true);

      component.onSubmit();
      const req = httpMock.expectOne('/api/auth/signup');
      req.flush(
        { error: 'Username or email already exists in this workspace.' },
        { status: 409, statusText: 'Conflict' }
      );

      expect(component.isSubmitting()).toBe(false);
      expect(component.errorMessage()).toBe('Username or email already exists in this workspace.');
      expect(component.successMessage()).toBeNull();
    });

    it('displays network failure notification when service is unreachable', () => {
      component.fullName.set('Marie Curie');
      component.username.set('mcurie');
      component.email.set('mcurie@enterprise.eu');
      component.password.set('Radium1898!');
      component.confirmPassword.set('Radium1898!');
      component.consentGiven.set(true);

      component.onSubmit();
      const req = httpMock.expectOne('/api/auth/signup');
      req.flush({}, { status: 504, statusText: 'Gateway Timeout' });

      expect(component.isSubmitting()).toBe(false);
      expect(component.errorMessage()).toBe(
        'Authentication service is unreachable. Please verify network or service status.'
      );
    });
  });
});
