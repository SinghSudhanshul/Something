/**
 * Auth Module — Types
 */

export interface RegisterInput {
  email: string;
  phone: string;
  password: string;
  full_name: string;
}

export interface VerifyEmailInput {
  email: string;
  otp: string;
}

export interface LoginInput {
  email: string;
  password: string;
  device_fingerprint?: string;
}

export interface RefreshInput {
  refresh_token: string;
}

export interface ResendOtpInput {
  email: string;
  purpose: 'registration' | 'password_reset';
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  email: string;
  otp: string;
  new_password: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface UserProfile {
  id: string;
  email: string;
  phone: string | null;
  full_name: string;
  campus_id: string;
  campus_name?: string;
  verification_level: number;
  trust_score: number;
  trust_tier: string;
  status: string;
  created_at: string;
}

export interface AuthResult {
  tokens: TokenPair;
  user: UserProfile;
}
