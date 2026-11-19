import { currentBusinessId } from '../database/businessContext.js';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '../database/types.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { CounterRepository } from '../repositories/CounterRepository.js';
import type { PinPersonRow, PinRepository } from '../repositories/PinRepository.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { canOversee, canSell, mayChangePerson } from '../utils/roles.js';
import { type AuthService, type DeviceInfo, type LoginResult, setupNeededError } from './AuthService.js';
import type { GoogleAuthService, SecurityDto } from './GoogleAuthService.js';

/** Wrong PINs for one person before they are locked, and for how long. */
export const PERSON_LOCK = { failures: 5, minutes: 15 };
/**
 * The daily cap: wrong PINs for one person in one business within a rolling
 * 24 hours before their PIN stops working there until a manager unlocks it on
 * People (or the tries age out). A right PIN or a password sign-in doesn't
 * reset it, so a guesser can't wait for the real person to use the till.
 * Password, Google and passkey sign-in keep working, and nobody is signed out.
 */
export const DAY_LOCK = { failures: 10, hours: 24 };
/** Wrong PINs on one PC within an hour before PIN switching stops there. */
export const DEVICE_LOCK = { failures: 20, minutes: 60 };
/** How long an owner's yes to a rabat lasts. */
export const APPROVAL_MINUTES = 5;

const minutesAgo = (minutes: number, now: Date) => new Date(now.getTime() - minutes * 60_000);
const dayStart = (now: Date) => minutesAgo(DAY_LOCK.hours * 60, now);

/** People here whose PIN the daily cap has locked (for To do and People). */
export const pinsLockedToday = (pins: PinRepository, now = new Date()) => pins.dayLocked(dayStart(now), DAY_LOCK.failures);

export interface PinPersonDto {
  id: number;
  name: string;
  role: UserRole;
  /** Their PIN doesn't work now (either lock). */
  locked: boolean;
  /** Locked by the daily cap: until a manager unlocks it, not just for a few minutes. */
  lockedToday: boolean;
}

export interface PayLaterApprovalDto {
  token: string;
  by: string;
  customerId: number;
  amount: number;
  expiresAt: string;
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

/** The daily cap: the dashboard words it in the reader's language (admin utils/errors.ts). */
class PinDayLockedError extends AppError {
  constructor(name: string) {
    super(`Too many wrong PINs today for ${name}. The PIN is locked: ask the owner to unlock it on People, or sign in with the password.`, 429, 'PIN_LOCKED_DAY');
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

  /** PIN checks for one person in one business, one at a time, so parallel guesses can't all slip under the caps. */
  private readonly checking = new Map<string, Promise<unknown>>();

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
    const rows = await this.pins.people(minutesAgo(PERSON_LOCK.minutes, now), dayStart(now));
    return rows
      .filter((row) => row.id !== actorId && (approvers ? canOversee(row.role) : canSell(row.role)))
      .map((row) => {
        const lockedToday = row.day_failures >= DAY_LOCK.failures;
        return { id: row.id, name: row.name, role: row.role, locked: lockedToday || row.recent_failures >= PERSON_LOCK.failures, lockedToday };
      });
  }

  /** A manager (or the person themselves, signed in) unlocks a PIN in this business: both locks end at once. */
  async unlock(actorId: number, userId: number): Promise<void> {
    const { actor, target } = await this.users.inThisBusiness(actorId, userId);
    if (!actor || !target) throw new NotFoundError('User');
    // Same rule as the other keys on someone's page; one's own PIN is always one's own to unlock.
    if (userId !== actorId && !mayChangePerson(actor, target)) throw new ForbiddenError('Only a main admin can unlock this for a main admin, owner, admin or accountant');
    await this.pins.unlock(userId);
    await this.activity.create({
      userId: actorId,
      action: 'pin.unlocked',
      entityType: 'user',
      entityId: userId,
      say: { key: 'pinUnlocked', params: { name: target.name } },
    });
  }

  /** Hand the Counter to someone else: their PIN starts their session on this PC and ends the one asking. */
  async switchTo(actor: CounterActor, input: { userId: number; pin: string }, device: DeviceInfo, now = new Date()): Promise<LoginResult> {
    if (input.userId === actor.id) throw new ValidationError('You are at the Counter already');
    const deviceId = await this.refreshTokens.deviceOf(actor.sessionId);
    const person = await this.check(deviceId, input, 'switch', (row) => canSell(row.role), now);
    const user = (await this.users.findById(person.id))!;
    // Checked before the PC changes hands, so a refused takeover leaves the one asking signed in.
    if (user.two_step_required) throw setupNeededError();
    await this.refreshTokens.revokeSession(actor.id, actor.sessionId);
    // The Counter stays in its business: someone whose home is another business sells here, not there.
    const result = await this.auth.startSession(user, device, 'pin', deviceId, currentBusinessId() ?? undefined);
    await this.counter.create([{ kind: 'person_switched', userId: person.id, productId: null, quantity: null, amount: null, reason: actor.name, documentId: null }]);
    return result;
  }

  /** An owner or admin allows a rabat over the limit on one basket, once, for a few minutes. */
  async allowRabat(actor: CounterActor, input: { userId: number; pin: string; percent: number; basketId: string }, now = new Date()): Promise<RabatApprovalDto> {
    const deviceId = await this.refreshTokens.deviceOf(actor.sessionId);
    const owner = await this.check(deviceId, input, 'rabat', (row) => canOversee(row.role), now);
    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + APPROVAL_MINUTES * 60_000);
    await this.pins.createApproval({ id: token, purpose: 'rabat', approvedBy: owner.id, askedBy: actor.id, basketId: input.basketId, percent: input.percent, expiresAt });
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

  /** An owner or admin lets this basket go on a customer's tab (over their limit, or for someone not let pay later), once, for a few minutes. */
  async allowPayLater(
    actor: CounterActor,
    input: { userId: number; pin: string; customerId: number; amount: number; basketId: string },
    now = new Date(),
  ): Promise<PayLaterApprovalDto> {
    const deviceId = await this.refreshTokens.deviceOf(actor.sessionId);
    const customerName = await this.pins.customerName(input.customerId);
    if (customerName === undefined) throw new NotFoundError(`Customer ${input.customerId} does not exist`);
    const owner = await this.check(deviceId, input, 'pay_later', (row) => canOversee(row.role), now);
    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + APPROVAL_MINUTES * 60_000);
    await this.pins.createApproval({
      id: token,
      purpose: 'pay_later',
      approvedBy: owner.id,
      askedBy: actor.id,
      basketId: input.basketId,
      customerId: input.customerId,
      amount: input.amount,
      expiresAt,
    });
    await this.counter.create([
      { kind: 'pay_later_allowed', userId: actor.id, productId: null, quantity: null, amount: input.amount, reason: `${owner.name} · ${customerName}`, documentId: null },
    ]);
    await this.activity.create({
      userId: owner.id,
      action: 'counter.pay_later_allowed',
      entityType: 'customer',
      entityId: input.customerId,
      say: { key: 'payLaterAllowed', params: { name: customerName, amount: input.amount, seller: actor.name } },
      details: { amount: input.amount, sellerId: actor.id, basketId: input.basketId },
    });
    return { token, by: owner.name, customerId: input.customerId, amount: input.amount, expiresAt: expiresAt.toISOString() };
  }

  /** The locks, then the PIN itself; every PIN typed is recorded. */
  private async check(
    deviceId: string,
    input: { userId: number; pin: string },
    purpose: 'switch' | 'rabat' | 'pay_later',
    allowed: (row: PinPersonRow) => boolean,
    now: Date,
  ): Promise<PinPersonRow> {
    // One process serves the API, so an in-memory queue is enough to make "count, check, record" one step.
    const key = `${currentBusinessId()}:${input.userId}`;
    const before = this.checking.get(key) ?? Promise.resolve();
    const run = before.then(() => this.checkNow(deviceId, input, purpose, allowed, now));
    const settled = run.catch(() => undefined);
    this.checking.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.checking.get(key) === settled) this.checking.delete(key);
    }
  }

  private async checkNow(
    deviceId: string,
    input: { userId: number; pin: string },
    purpose: 'switch' | 'rabat' | 'pay_later',
    allowed: (row: PinPersonRow) => boolean,
    now: Date,
  ): Promise<PinPersonRow> {
    if ((await this.pins.deviceFailures(deviceId, minutesAgo(DEVICE_LOCK.minutes, now))) >= DEVICE_LOCK.failures) {
      throw new PinLockedError('Too many wrong PINs on this PC. Sign in with a password to use PINs here again.');
    }
    const person = (await this.pins.people(minutesAgo(PERSON_LOCK.minutes, now), dayStart(now))).find((row) => row.id === input.userId);
    if (!person || !allowed(person)) throw new NotFoundError('That person has no Counter PIN here');
    // The daily cap first: even the right PIN is refused until a manager unlocks it.
    if (person.day_failures >= DAY_LOCK.failures) throw new PinDayLockedError(person.name);
    if (person.recent_failures >= PERSON_LOCK.failures) {
      throw new PinLockedError(`Too many wrong PINs for ${person.name}. Try again in ${PERSON_LOCK.minutes} minutes, or sign in with the password.`);
    }
    const ok = await verifyPassword(input.pin, person.pin_hash);
    await this.pins.recordAttempt({ userId: person.id, deviceId, purpose, ok });
    if (ok) return person;
    const leftToday = DAY_LOCK.failures - person.day_failures - 1;
    if (leftToday === 0) {
      await this.activity.create({
        userId: person.id,
        action: 'pin.day_locked',
        entityType: 'user',
        entityId: person.id,
        say: { key: 'pinDayLocked', params: { name: person.name } },
      });
      throw new PinDayLockedError(person.name);
    }
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
    if (leftToday < left) {
      throw new WrongPinError(`That PIN is wrong. ${leftToday} ${leftToday === 1 ? 'try' : 'tries'} left today before the PIN of ${person.name} is locked until the owner unlocks it.`);
    }
    throw new WrongPinError(`That PIN is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left before ${person.name} is locked for ${PERSON_LOCK.minutes} minutes.`);
  }
}
