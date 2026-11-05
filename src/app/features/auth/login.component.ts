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
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import {
  AuthResponse,
  AuthService,
  LoginCredentials,
} from "../../core/auth.service";
import { StateManagerService } from "../../core/state-manager.service";

@Component({
  selector: "rc-login",
  imports: [FormsModule, RouterLink],
  templateUrl: "./login.component.html",
  styleUrl: "./login.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly state = inject(StateManagerService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly username = signal<string>("");
  public readonly password = signal<string>("");
  public readonly showPassword = signal<boolean>(false);
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

  public readonly isFormValid = computed<boolean>(() => {
    return this.username().trim().length > 0 && this.password().length > 0;
  });

  public togglePasswordVisibility(): void {
    this.showPassword.update((visible) => !visible);
  }

  public onSubmit(): void {
    if (!this.isFormValid()) {
      this.errorMessage.set("Please provide both username and password.");
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const credentials = this.buildCredentials();

    this.authService
      .login(credentials)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: AuthResponse) => this.handleLoginSuccess(response),
        error: (error: unknown) => this.handleLoginError(error),
      });
  }

  private changeBackground(): string {
    const number = Math.random() * this.images.length;
    const index = Math.floor(number);
    return `url(${this.images[index]}) ${this.size}`;
  }

  private buildCredentials(): LoginCredentials {
    return {
      username: this.username().trim(),
      password: this.password(),
    };
  }

  private handleLoginSuccess(response: AuthResponse): void {
    this.isSubmitting.set(false);
    const displayName = response.user.fullName || response.user.username;
    this.successMessage.set(`Welcome back, ${displayName}!`);
    this.state.announce(`Signed in as ${response.user.username}`);

    const targetUrl = this.resolveReturnUrl();
    setTimeout(() => {
      this.router.navigateByUrl(targetUrl);
    }, 300);
  }

  private handleLoginError(error: unknown): void {
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
      "Invalid username or password. Please verify your credentials."
    );
  }

  private resolveReturnUrl(): string {
    return this.route.snapshot.queryParams["returnUrl"] || "/report-builder";
  }
}
