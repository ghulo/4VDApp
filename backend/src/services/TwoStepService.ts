import { sql } from 'kysely';
import { enterBusiness } from '../database/businessContext.js';
import jwt from 'jsonwebtoken';
import type { DatabaseClient } from '../database/connection.js';
import type { UserRow } from '../database/types.js';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/httpErrors.js';
import { canHandOut } from '../utils/roles.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { hashRecoveryCode, matchCode, newRecoveryCodes, newTotpSecret, otpauthUrl, type SecretBox } from '../utils/totp.js';
import type { ActivityAction } from '../constants/activity.js';
import type { Say } from '../i18n/activityText.js';
import { type AuthService, type DeviceInfo, type LoginResult, TWO_STEP_AUDIENCE } from './AuthService.js';

/** Wrong codes in a row before the person waits. */
const MAX_WRONG = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface TwoStepStatus {
  on: boolean;
  backupCodesLeft: number;
}

/**
 * Optional two-step sign-in: after the password (or Google), a six-digit code
 * from an authenticator app, or one of ten single-use backup codes. A Counter
 * PIN takeover doesn't ask again: the PC is already signed in.
 */
export class TwoStepService {
  /** Wrong codes per person and secret, in memory (the API runs as one process). */
  private readonly wrong = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly users: UserRepository,
    private readonly authService: AuthService,
    private readonly activity: ActivityLogRepository,
    private readonly box: SecretBox,
    private readonly jwtSecret: string,
  ) {}

  /** Second step: the code (or a backup code) for a challenge from signIn. */
  async finish(challenge: string, code: string, device: DeviceInfo): Promise<LoginResult> {
    let claims: { uid?: unknown; how?: unknown };
    try {
      claims = jwt.verify(challenge, this.jwtSecret, { audience: TWO_STEP_AUDIENCE, algorithms: ['HS256'] }) as typeof claims;
    } catch {
      throw new AppError('This sign-in took too long. Start again with your password.', 401, 'TWO_STEP_EXPIRED');
    }
    const user = typeof claims.uid === 'number' ? await this.users.findById(claims.uid) : undefined;
    if (!user || !user.is_active) throw new UnauthorizedError('Your account is no longer active');
    if (!user.totp_secret) return this.authService.startSession(user, device, claims.how === 'google' ? 'google' : 'password');
    await this.checkCode(user, code);
    return this.authService.startSession(user, device, claims.how === 'google' ? 'google' : 'password');
  }

  async status(userId: number): Promise<TwoStepStatus> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User');
    return { on: user.totp_secret !== null, backupCodesLeft: user.totp_recovery.length };
  }

  /** Step one of turning it on: a new secret for the app (not used until confirmed). */
  async start(userId: number): Promise<{ secret: string; url: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User');
    if (user.totp_secret) throw new AppError('Two-step sign-in is already on', 409, 'TWO_STEP_ON');
    const secret = newTotpSecret();
    await this.users.update(userId, { totp_pending: this.box.seal(secret) });
    return { secret, url: otpauthUrl(secret, user.email) };
  }

  /** Step two: the first code proves the app has the secret. Returns the backup codes, shown once. */
  async confirm(userId: number, code: string): Promise<{ backupCodes: string[] }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User');
    if (user.totp_secret) throw new AppError('Two-step sign-in is already on', 409, 'TWO_STEP_ON');
    if (!user.totp_pending) throw new AppError('Start again: scan the new QR code first', 409, 'TWO_STEP_NOT_STARTED');
    const step = matchCode(this.box.open(user.totp_pending), code.trim(), null);
    if (step === null) throw new AppError('That code is not right. Check the time on your phone and try the newest code.', 400, 'WRONG_CODE');
    const backupCodes = newRecoveryCodes();
    await this.users.update(userId, {
      totp_secret: user.totp_pending,
      totp_pending: null,
      totp_enabled_at: new Date(),
      totp_last_step: step,
      totp_recovery: backupCodes.map(hashRecoveryCode),
    });
    await this.log(userId, 'auth.two_step_on', { key: 'twoStepOn' });
    return { backupCodes };
  }

  async turnOff(userId: number, code: string): Promise<void> {
    const user = await this.withTwoStep(userId);
    await this.checkCode(user, code);
    await this.clear(userId);
    await this.log(userId, 'auth.two_step_off', { key: 'twoStepOff' });
  }

  async renewBackupCodes(userId: number, code: string): Promise<{ backupCodes: string[] }> {
    const user = await this.withTwoStep(userId);
    await this.checkCode(user, code);
    const backupCodes = newRecoveryCodes();
    await this.users.update(userId, { totp_recovery: backupCodes.map(hashRecoveryCode) });
    await this.log(userId, 'auth.two_step_codes', { key: 'twoStepCodes' });
    return { backupCodes };
  }

  /** A manager switches it off for someone who lost their phone and their backup codes. */
  async reset(actorId: number, userId: number): Promise<void> {
    const [actor, user] = await Promise.all([this.users.findById(actorId), this.users.findById(userId)]);
    if (!actor || !user) throw new NotFoundError('User');
    // Same rule as changing someone: an owner, admin or developer only by the developer.
    if (!canHandOut(actor.role, user.role)) throw new ForbiddenError('Only the developer can reset this for an owner, admin or developer');
    await this.clear(userId);
    await this.activity.create({
      userId: actorId,
      action: 'auth.two_step_reset',
      entityType: 'user',
      entityId: userId,
      say: { key: 'twoStepReset', params: { name: user.name } },
    });
  }

  private async withTwoStep(userId: number): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User');
    if (!user.totp_secret) throw new AppError('Two-step sign-in is off', 409, 'TWO_STEP_OFF');
    return user;
  }

  private async clear(userId: number): Promise<void> {
    await this.users.update(userId, { totp_secret: null, totp_pending: null, totp_enabled_at: null, totp_last_step: null, totp_recovery: [] });
  }

  /** An app code (each works once) or a backup code (used up). Throws when wrong; locks after five. */
  private async checkCode(user: UserRow, code: string): Promise<void> {
    const now = Date.now();
    // A new secret (turned off and on, or reset) starts the count again.
    const key = `${user.id}:${user.totp_secret}`;
    const tries = this.wrong.get(key);
    if (tries && tries.until > now) throw new AppError('Too many wrong codes. Wait 15 minutes and try again.', 429, 'TOO_MANY_CODES');

    const typed = code.trim();
    if (await this.useCode(user, typed)) {
      this.wrong.delete(key);
      return;
    }
    const count = (tries && tries.until > now ? 0 : (tries?.count ?? 0)) + 1;
    this.wrong.set(key, { count, until: count >= MAX_WRONG ? now + LOCK_MS : 0 });
    if (count >= MAX_WRONG) {
      // Still before sign-in: the log entry goes to the person's business.
      enterBusiness(user.business_id);
      await this.log(user.id, 'auth.two_step_locked', { key: 'twoStepLocked', params: { name: user.name } });
    }
    throw new AppError('That code is not right', 401, 'WRONG_CODE');
  }

  private async useCode(user: UserRow, typed: string): Promise<boolean> {
    if (/^\d{6}$/.test(typed)) {
      const last = user.totp_last_step === null ? null : Number(user.totp_last_step);
      const step = matchCode(this.box.open(user.totp_secret!), typed, last);
      if (step === null) return false;
      // Only one request can move the step forward, so the same code can't sign in twice at once.
      const moved = await this.db
        .updateTable('users')
        .set({ totp_last_step: step })
        .where('id', '=', user.id)
        .where((eb) => eb.or([eb('totp_last_step', 'is', null), eb('totp_last_step', '<', String(step))]))
        .executeTakeFirst();
      return Number(moved.numUpdatedRows) === 1;
    }
    const hash = hashRecoveryCode(typed);
    const used = await this.db
      .updateTable('users')
      .set({ totp_recovery: sql<string[]>`array_remove(totp_recovery, ${hash})` })
      .where('id', '=', user.id)
      .where(sql<boolean>`${hash} = ANY(totp_recovery)`)
      .executeTakeFirst();
    return Number(used.numUpdatedRows) === 1;
  }

  private log(userId: number, action: ActivityAction, say: Say) {
    return this.activity.create({ userId, action, entityType: 'user', entityId: userId, say });
  }
}
