import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default(''),
  SENTRY_DSN: z.string().optional(),
  /** The shop's own time zone: days of the week in forecasts, and when the daily summary goes out. */
  SHOP_TIME_ZONE: z
    .string()
    .default('Europe/Budapest')
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, 'must be a time zone like Europe/Budapest'),
  /** Where the dashboard and the employee app live; links in emails point here. */
  DASHBOARD_URL: z.url().default('http://localhost:5173'),
  TEAM_APP_URL: z.url().default('http://localhost:8081'),
  /** Emails are printed to the log until this is set. */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('4VD <onboarding@resend.dev>'),
  /** The weekly backup job tells the API it finished with this secret, so the launch checklist can see it. */
  BACKUP_PING_TOKEN: z
    .string()
    .optional()
    .refine((value) => !value || value.length >= 20, 'must be at least 20 characters, or left empty'),
  /** Public "create your shop" sign-up. Off while 4VD serves one shop. */
  ALLOW_SIGNUP: z.enum(['true', 'false']).default('false'),
  /** Google sign-in (OAuth client ID from Google Cloud). Off when not set. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  /** Claude (Anthropic), for the AI helpers. Used first when set. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Only for keys made outside a workspace: which workspace to bill. */
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  /** Google Gemini, used when there's no Anthropic key. Without either, the AI helpers are off. */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenTtlDays: number;
  corsOrigins: string[];
  sentryDsn?: string;
  shopTimeZone: string;
  dashboardUrl: string;
  teamAppUrl: string;
  email: { resendApiKey?: string; from: string };
  /** Secret the weekly backup job sends to say it finished; unset means the app can't tell. */
  backupPingToken?: string;
  allowSignup: boolean;
  googleClientId?: string;
  /** Null when no AI key is set, which switches the AI helpers off. */
  ai?: { provider: 'anthropic' | 'gemini'; apiKey: string; model: string; workspaceId?: string };
  /** Web push is switched off unless all three are set. */
  webPush?: { publicKey: string; privateKey: string; subject: string };
}

/**
 * Validate environment variables once at startup so a missing secret fails
 * loudly on boot instead of halfway through a request.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    sentryDsn: env.SENTRY_DSN || undefined,
    shopTimeZone: env.SHOP_TIME_ZONE,
    dashboardUrl: env.DASHBOARD_URL.replace(/\/$/, ''),
    teamAppUrl: env.TEAM_APP_URL.replace(/\/$/, ''),
    email: { resendApiKey: env.RESEND_API_KEY || undefined, from: env.EMAIL_FROM },
    backupPingToken: env.BACKUP_PING_TOKEN || undefined,
    allowSignup: env.ALLOW_SIGNUP === 'true',
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    ai: env.ANTHROPIC_API_KEY
      ? {
          provider: 'anthropic',
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.ANTHROPIC_MODEL,
          workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined,
        }
      : env.GEMINI_API_KEY
        ? { provider: 'gemini', apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }
        : undefined,
    webPush:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
        : undefined,
  };
}
