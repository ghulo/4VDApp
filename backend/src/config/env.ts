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
  /** Claude (Anthropic), for the AI helpers. Used first when set. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
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
