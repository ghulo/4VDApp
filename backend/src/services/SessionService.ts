import { NotFoundError } from '../errors/httpErrors.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';

export interface SessionDto {
  id: string;
  /** e.g. "Chrome on Windows" */
  device: string;
  ip: string | null;
  lastUsedAt: string | null;
  startedAt: string;
  /** The device asking. */
  current: boolean;
}

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/Linux/, 'Linux'],
];

/** A browser and system in plain words, from the User-Agent header. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  // The phone app talks to the API through these HTTP libraries.
  if (/okhttp|Expo|CFNetwork|Dalvik/i.test(userAgent)) return '4VD app';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}

/** The devices someone is logged in on, and logging them out. */
export class SessionService {
  constructor(private readonly refreshTokenRepository: RefreshTokenRepository) {}

  async list(userId: number, currentSessionId: string | undefined): Promise<SessionDto[]> {
    const sessions = await this.refreshTokenRepository.activeSessions(userId);
    return sessions
      .map((session) => ({
        id: session.session_id,
        device: describeDevice(session.user_agent),
        ip: session.ip,
        lastUsedAt: session.last_used_at?.toISOString() ?? null,
        startedAt: session.started_at.toISOString(),
        current: session.session_id === currentSessionId,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
  }

  async end(userId: number, sessionId: string): Promise<void> {
    if (!(await this.refreshTokenRepository.revokeSession(userId, sessionId))) {
      throw new NotFoundError('That device is not logged in to your account');
    }
  }

  async endOthers(userId: number, currentSessionId: string | undefined): Promise<void> {
    await this.refreshTokenRepository.revokeAllForUserExcept(userId, currentSessionId);
  }
}
