import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AuthResponse, AuthService, SignupData } from "../../core/auth.service";
import { StateManagerService } from "../../core/state-manager.service";

export interface PasswordStrength {
  readonly percent: number;
  readonly color: string;
  readonly label: string;
}

@Component({
  selector: "rc-signup",
  imports: [FormsModule, RouterLink],
  templateUrl: "./signup.component.html",
  styleUrl: "./signup.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignupComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly state = inject(StateManagerService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly fullName = signal<string>("");
  public readonly username = signal<string>("");
  public readonly email = signal<string>("");
  public readonly password = signal<string>("");
  public readonly confirmPassword = signal<string>("");
  public readonly role = signal<string>("ROLE_OPERATOR");
  public readonly consentGiven = signal<boolean>(true);

  public readonly showPassword = signal<boolean>(false);
  public readonly showConfirmPassword = signal<boolean>(false);
  public readonly isSubmitting = signal<boolean>(false);
  public readonly errorMessage = signal<string | null>(null);
  public readonly successMessage = signal<string | null>(null);

  private readonly images = [
    "/assets/analyst.webp",
    "/assets/pythagore.webp",
    "/assets/office.webp",
  ];
  public readonly size = "center center / cover no-repeat fixed";
  public readonly background = this.changeBackground();

  public readonly passwordStrength = computed<PasswordStrength>(() => {
    const rawPassword = this.password();
    if (!rawPassword) {
      return { percent: 0, color: "#6c757d", label: "Empty" };
    }
    if (rawPassword.length < 6) {
      return { percent: 25, color: "#dc3545", label: "Too short (min 6)" };
    }

    const hasLetter = /[a-zA-Z]/.test(rawPassword);
    const hasNumber = /[0-9]/.test(rawPassword);
    const hasSpecial = /[^a-zA-Z0-9]/.test(rawPassword);
    const complexityScore =
      (hasLetter ? 1 : 0) +
      (hasNumber ? 1 : 0) +
      (hasSpecial ? 1 : 0) +
      (rawPassword.length >= 8 ? 1 : 0);

    if (complexityScore <= 2) {
      return { percent: 50, color: "#ffc107", label: "Fair" };
    }
    if (complexityScore === 3) {
      return { percent: 75, color: "#0dcaf0", label: "Good" };
    }
    return { percent: 100, color: "#198754", label: "Strong" };
  });

  public readonly isFormValid = computed<boolean>(() => {
    return (
      this.fullName().trim().length > 0 &&
      this.username().trim().length >= 3 &&
      this.email().includes("@") &&
      this.password().length >= 6 &&
      this.password() === this.confirmPassword() &&
      this.consentGiven()
    );
  });

  public togglePasswordVisibility(): void {
    this.showPassword.update((visible) => !visible);
  }

  public toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((visible) => !visible);
  }

  public onSubmit(): void {
    if (!this.isFormValid()) {
      this.handleValidationError();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const signupData = this.buildSignupPayload();

    this.authService
      .signup(signupData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: AuthResponse) => this.handleSignupSuccess(response),
        error: (error: unknown) => this.handleSignupError(error),
      });
  }

  private changeBackground(): string {
    const randomIndex = Math.floor(Math.random() * this.images.length);
    return `url(${this.images[randomIndex]}) ${this.size}`;
  }

  private handleValidationError(): void {
    if (this.password() !== this.confirmPassword()) {
      this.errorMessage.set("Passwords do not match.");
    } else {
      this.errorMessage.set("Please fill out all required fields correctly.");
    }
  }

  private buildSignupPayload(): SignupData {
    return {
      fullName: this.fullName().trim(),
      username: this.username().trim().toLowerCase(),
      email: this.email().trim().toLowerCase(),
      password: this.password(),
      role: this.role(),
    };
  }

  private handleSignupSuccess(response: AuthResponse): void {
    this.isSubmitting.set(false);
    this.successMessage.set("Account registered! Redirecting to workspace...");
    this.state.announce(`Account created for ${response.user.username}`);

    setTimeout(() => {
      this.router.navigate(["/report-builder"]);
    }, 400);
  }

  private handleSignupError(error: unknown): void {
    this.isSubmitting.set(false);
    this.errorMessage.set(this.extractErrorMessage(error));
  }

  private extractErrorMessage(error: unknown): string {
    const httpError = error as {
      status?: number;
      error?: { error?: string; message?: string };
    };

    if (
      httpError?.status === 0 ||
      httpError?.status === 502 ||
      httpError?.status === 503 ||
      httpError?.status === 504
    ) {
      return "Authentication service is unreachable. Please verify network or service status.";
    }

    return (
      httpError?.error?.error ||
      httpError?.error?.message ||
      "Registration could not be completed. Please try again."
    );
  }
}
