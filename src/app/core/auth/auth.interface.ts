export interface UserProfile {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
}

export interface AuthResponse {
  readonly token: string;
  readonly tokenType: string;
  readonly user: UserProfile;
  readonly message?: string;
}

export interface LoginCredentials {
  readonly username: string;
  readonly password: string;
}

export interface SignupData {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
}

export interface JwtClaims {
  readonly sub?: string;
  readonly userId?: string;
  readonly fullName?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly email?: string;
}
