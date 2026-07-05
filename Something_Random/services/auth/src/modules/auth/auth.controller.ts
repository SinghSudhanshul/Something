/**
 * Auth Module — Controller
 *
 * Thin handlers that delegate to auth.service.ts.
 * No business logic — only request parsing, response formatting.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import * as authService from './auth.service.js';
import type {
  RegisterInput,
  VerifyEmailInput,
  LoginInput,
  RefreshInput,
  ResendOtpInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.types.js';

export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.register(request.server, request, request.body);
  void reply.status(201).send(result);
}

export async function verifyEmailHandler(
  request: FastifyRequest<{ Body: VerifyEmailInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.verifyEmail(request.server, request, request.body);
  void reply.send(result);
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.login(request.server, request, request.body);
  void reply.send(result);
}

export async function refreshHandler(
  request: FastifyRequest<{ Body: RefreshInput }>,
  reply: FastifyReply,
): Promise<void> {
  const tokens = await authService.refreshTokens(request.server, request, request.body);
  void reply.send(tokens);
}

export async function logoutHandler(
  request: FastifyRequest<{ Body: { refresh_token?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user as { sub: string; jti: string };
  await authService.logout(request.server, user.sub, user.jti, request.body.refresh_token);
  void reply.status(204).send();
}

export async function logoutAllHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user as { sub: string };
  await authService.logoutAll(request.server, user.sub);
  void reply.status(204).send();
}

export async function resendOtpHandler(
  request: FastifyRequest<{ Body: ResendOtpInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.resendOtp(request.server, request.body.email, request.body.purpose);
  void reply.send(result);
}

export async function forgotPasswordHandler(
  request: FastifyRequest<{ Body: ForgotPasswordInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.forgotPassword(request.server, request.body.email);
  void reply.send(result);
}

export async function resetPasswordHandler(
  request: FastifyRequest<{ Body: ResetPasswordInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await authService.resetPassword(request.server, request.body);
  void reply.send(result);
}

export async function getMeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user as { sub: string };
  const profile = await authService.getMe(request.server, user.sub);
  void reply.send(profile);
}
