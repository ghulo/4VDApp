import { z } from 'zod';
import { USER_ROLES } from '../database/types.js';
import { MIN_PASSWORD_LENGTH } from '../utils/password.js';
import { LANGUAGES } from '../i18n/language.js';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

/** Tokens from emailed links: base64url, 43 characters for 32 bytes. */
export const linkTokenParamsSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'not a valid link') });

export const forgotPasswordSchema = z.object({ email: emailSchema });

const linkToken = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'not a valid link');

export const resetPasswordSchema = z.object({ token: linkToken, password: newPasswordSchema });

export const linkTokenBodySchema = z.object({ token: linkToken });

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: newPasswordSchema,
});

export const changeEmailSchema = z.object({
  password: z.string().max(200).optional(),
  newEmail: emailSchema,
});

const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));

export const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    phone: optionalText(50),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    language: z.enum(LANGUAGES).optional(),
    emailWeeklyReport: z.boolean().optional(),
  })
  .strict();

export const businessSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    address: optionalText(500),
    phone: optionalText(50),
    timeZone: z.string().refine(isTimeZone, 'not a time zone, e.g. Europe/Belgrade').nullable().optional(),
  })
  .strict();

export const mediaParamsSchema = z.object({ id: z.uuid() });

export const googleCredentialSchema = z.object({ credential: z.string().min(1).max(5000) });

/** Accepting an invite: the language the invite page was shown in becomes the account's. */
export const googleInviteSchema = googleCredentialSchema.extend({ language: z.enum(LANGUAGES).optional() });

export const signupSchema = z.object({
  shopName: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  email: emailSchema,
  password: newPasswordSchema,
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(USER_ROLES),
  /** The invite email and the new account's language; the inviter's own when left out. */
  language: z.enum(LANGUAGES).optional(),
});

export const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(255),
  password: newPasswordSchema,
  /** The language the invite page was shown in; the invite's own when left out. */
  language: z.enum(LANGUAGES).optional(),
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
