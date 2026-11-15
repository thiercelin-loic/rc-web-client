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
