import { z } from 'zod';
import { USER_ROLES } from '../database/types.js';
import { MIN_PASSWORD_LENGTH } from '../utils/password.js';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

/** Tokens from emailed links: base64url, 43 characters for 32 bytes. */
export const linkTokenParamsSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'not a valid link') });

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(USER_ROLES),
});

export const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  password: newPasswordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(500),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).max(500).optional(),
});
