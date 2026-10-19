import { randomUUID } from 'node:crypto';
import type { UserRole } from '../database/types.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { CounterRepository } from '../repositories/CounterRepository.js';
import type { PinPersonRow, PinRepository } from '../repositories/PinRepository.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { canOversee, canSell } from '../utils/roles.js';
import type { AuthService, DeviceInfo, LoginResult } from './AuthService.js';
import type { GoogleAuthService, SecurityDto } from './GoogleAuthService.js';

/** Wrong PINs for one person before they are locked, and for how long. */
export const PERSON_LOCK = { failures: 5, minutes: 15 };
/** Wrong PINs on one PC within an hour before PIN switching stops there. */
export const DEVICE_LOCK = { failures: 20, minutes: 60 };
/** How long an owner's yes to a rabat lasts. */
export const APPROVAL_MINUTES = 5;

const minutesAgo = (minutes: number, now: Date) => new Date(now.getTime() - minutes * 60_000);

export interface PinPersonDto {
  id: number;
  name: string;
  role: UserRole;
  locked: boolean;
}

export interface RabatApprovalDto {
  token: string;
  by: string;
  percent: number;
  expiresAt: string;
}

/** The person at the Counter, as the server knows them from their session. */
export interface CounterActor {
  id: number;
  name: string;
  sessionId: string;
}

class WrongPinError extends AppError {
  constructor(message: string) {
    super(message, 422, 'WRONG_PIN');
  }
}

class PinLockedError extends AppError {
  constructor(message: string) {
    super(message, 429, 'PIN_LOCKED');
  }
}

/**
 * Counter PINs. A PIN never signs anyone in on its own: it only works on a PC
 * where someone is already signed in at the Counter, to hand the till to
 * another person (Switch person) or for an owner to allow a bigger rabat.
 */
export class CounterPinService {
  constructor(
    private readonly pins: PinRepository,
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly activity: ActivityLogRepository,
    private readonly counter: CounterRepository,
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
  ) {}

  /** Set (or with null, remove) one's own PIN, after typing the account password. */
  async setPin(userId: number, input: { password: string; pin: string | null }): Promise<SecurityDto> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`User ${userId} does not exist`);
    if (!user.password_hash) throw new ConflictError('Set a password first: the PIN is saved only after you type it.');
    if (!(await verifyPassword(input.password, user.password_hash))) throw new WrongPinError('That password is wrong');
    await this.pins.setPin(userId, input.pin === null ? null : await hashPassword(input.pin));
    await this.activity.create({
      userId,
      action: input.pin === null ? 'pin.removed' : 'pin.set',
      entityType: 'user',
      entityId: userId,
      say: { key: input.pin === null ? 'pinRemoved' : 'pinSet' },
    });
    return this.google.security(userId);
  }

  /** Who may take over the Counter here (or, with `approvers`, allow a rabat), never the person asking. */
  async people(actorId: number, approvers: boolean, now = new Date()): Promise<PinPersonDto[]> {
    const rows = await this.pins.people(minutesAgo(PERSON_LOCK.minutes, now));
    return rows
      .filter((row) => row.id !== actorId && (approvers ? canOversee(row.role) : canSell(row.role)))
      .map((row) => ({ id: row.id, name: row.name, role: row.role, locked: row.recent_failures >= PERSON_LOCK.failures }));
  }

  /** Hand the Counter to someone else: their PIN starts their session on this PC and ends the one asking. */
  async switchTo(actor: CounterActor, input: { userId: number; pin: string }, device: DeviceInfo, now = new Date()): Promise<LoginResult> {
    if (input.userId === actor.id) throw new ValidationError('You are at the Counter already');
    const deviceId = await this.refreshTokens.deviceOf(actor.sessionId);
    const person = await this.check(deviceId, input, 'switch', (row) => canSell(row.role), now);
    const user = (await this.users.findById(person.id))!;
    await this.refreshTokens.revokeSession(actor.id, actor.sessionId);
    const result = await this.auth.startSession(user, device, 'pin', deviceId);
    await this.counter.create([{ kind: 'person_switched', userId: person.id, productId: null, quantity: null, amount: null, reason: actor.name, documentId: null }]);
    return result;
  }

  /** An owner or admin allows a rabat over the limit on one basket, once, for a few minutes. */
  async allowRabat(actor: CounterActor, input: { userId: number; pin: string; percent: number; basketId: string }, now = new Date()): Promise<RabatApprovalDto> {
    const deviceId = await this.refreshTokens.deviceOf(actor.sessionId);
    const owner = await this.check(deviceId, input, 'rabat', (row) => canOversee(row.role), now);
    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + APPROVAL_MINUTES * 60_000);
    await this.pins.createApproval({ id: token, approvedBy: owner.id, askedBy: actor.id, basketId: input.basketId, percent: input.percent, expiresAt });
    await this.counter.create([{ kind: 'rabat_allowed', userId: actor.id, productId: null, quantity: null, amount: null, reason: `${owner.name} · ${input.percent}%`, documentId: null }]);
    await this.activity.create({
      userId: owner.id,
      action: 'counter.rabat_allowed',
      entityType: 'counter',
      entityId: null,
      say: { key: 'rabatAllowed', params: { percent: input.percent, seller: actor.name } },
      details: { percent: input.percent, sellerId: actor.id, basketId: input.basketId },
    });
    return { token, by: owner.name, percent: input.percent, expiresAt: expiresAt.toISOString() };
  }

  /** The locks, then the PIN itself; every PIN typed is recorded. */
  private async check(
    deviceId: string,
    input: { userId: number; pin: string },
    purpose: 'switch' | 'rabat',
    allowed: (row: PinPersonRow) => boolean,
    now: Date,
  ): Promise<PinPersonRow> {
    if ((await this.pins.deviceFailures(deviceId, minutesAgo(DEVICE_LOCK.minutes, now))) >= DEVICE_LOCK.failures) {
      throw new PinLockedError('Too many wrong PINs on this PC. Sign in with a password to use PINs here again.');
    }
    const person = (await this.pins.people(minutesAgo(PERSON_LOCK.minutes, now))).find((row) => row.id === input.userId);
    if (!person || !allowed(person)) throw new NotFoundError('That person has no Counter PIN here');
    if (person.recent_failures >= PERSON_LOCK.failures) {
      throw new PinLockedError(`Too many wrong PINs for ${person.name}. Try again in ${PERSON_LOCK.minutes} minutes, or sign in with the password.`);
    }
    const ok = await verifyPassword(input.pin, person.pin_hash);
    await this.pins.recordAttempt({ userId: person.id, deviceId, purpose, ok });
    if (ok) return person;
    const left = PERSON_LOCK.failures - person.recent_failures - 1;
    if (left === 0) {
      await this.activity.create({
        userId: person.id,
        action: 'pin.locked',
        entityType: 'user',
        entityId: person.id,
        say: { key: 'pinLocked', params: { name: person.name } },
      });
      throw new PinLockedError(`Too many wrong PINs for ${person.name}. Try again in ${PERSON_LOCK.minutes} minutes, or sign in with the password.`);
    }
    throw new WrongPinError(`That PIN is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left before ${person.name} is locked for ${PERSON_LOCK.minutes} minutes.`);
  }
}
