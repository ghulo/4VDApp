import { z } from 'zod';

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
