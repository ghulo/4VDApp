// Windows are in milliseconds.
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const RATE_LIMIT_WINDOW_MS = FIFTEEN_MINUTES_MS;

export const RATE_LIMITS = {
  PUBLIC: 100,
  AUTHENTICATED: 500,
  ADMIN: 1000,
  // Failed logins per IP. Low on purpose to slow down password guessing.
  FAILED_LOGINS: 10,
  // AI questions per person; each one uses the AI service's (free) quota.
  AI_QUESTIONS: 20,
  // The business customers' portal: everything, per signed-in phone or IP.
  PORTAL: 300,
  // Sign-in links asked for or opened, per IP, and asked for per email address.
  PORTAL_LINKS: 10,
  PORTAL_LINKS_PER_EMAIL: 3,
} as const;
