import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { enterBusiness } from '../database/businessContext.js';
import type { DatabaseClient } from '../database/connection.js';
import type { PasskeyRow, UserRow } from '../database/types.js';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/httpErrors.js';
import { messages } from '../i18n/messages.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { verifyPassword } from '../utils/password.js';
import { mayChangePerson } from '../utils/roles.js';
import { NOT_HOME_MESSAGE } from './UserService.js';
import type { AuthService, DeviceInfo, LoginResult, SignInResult } from './AuthService.js';
import type { EmailService } from './email/EmailService.js';
import { emailTemplates } from './email/templates.js';
import type { TwoStepService } from './TwoStepService.js';

/** Most passkeys one person can have. */
const MAX_PASSKEYS = 10;
/** How long the device prompt may stay open. */
const CHALLENGE_MS = 5 * 60 * 1000;
/** Open challenges kept at once (the sign-in one is public): beyond this, wait. */
const MAX_OPEN_CHALLENGES = 5000;

type Purpose = 'signIn' | 'twoStep' | 'add';

export interface PasskeyInfo {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Synced to the person's other devices (iCloud Keychain, Google Password Manager…). */
  synced: boolean;
}

export interface PasskeyList {
  passkeys: PasskeyInfo[];
  /** What adding one asks for first: the two-step code, the password, or nothing (Google-only people). */
  confirmWith: 'code' | 'password' | null;
}

export interface PasskeyConfig {
  /** The site passkeys belong to: the dashboard's host name (4vd.app; localhost in development). */
  rpId: string;
  /** Pages allowed to use them: the dashboard's addresses. */
  origins: string[];
  dashboardUrl: string;
}

/**
 * Well-known passkey providers (by the AAGUID the device reports), for a
 * friendly default name. Anything else is named after the device the person
 * was on.
 */
const PROVIDERS: Record<string, string> = {
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Microsoft Password Manager',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
};

function deviceName(aaguid: string | null, userAgent: string | null | undefined): string {
  const known = aaguid ? PROVIDERS[aaguid] : undefined;
  if (known) return known;
  const ua = userAgent ?? '';
  if (/iPhone|iPad/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}

/** The user handle a passkey keeps for the person: their id, never their email. */
function userHandle(userId: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(`4vd:${userId}`, 'utf8'));
}

function toInfo(row: PasskeyRow): PasskeyInfo {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    synced: row.backed_up,
  };
}

/**
 * Passkeys: sign-in with the device's own lock (Windows Hello, Touch ID,
 * Face ID, an Android fingerprint). A passkey sign-in counts as both steps
 * (the device checks the person), so it needs no two-step code; after a
 * password it can stand in for the code. Passkeys belong to the person, in
 * every business they work for.
 */
export class PasskeyService {
  /** Open challenges (the API runs as one process): each works once, for one purpose and person. */
  private readonly challenges = new Map<string, { purpose: Purpose; userId: number | null; until: number }>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly users: UserRepository,
    private readonly authService: AuthService,
    private readonly twoStepService: TwoStepService,
    private readonly activity: ActivityLogRepository,
    private readonly emailService: EmailService,
    private readonly config: PasskeyConfig,
  ) {}

  // ---- Signing in ----

  /** The device prompt for signing in with any passkey saved for 4VD (no email needed). */
  async signInOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const options = await generateAuthenticationOptions({ rpID: this.config.rpId, userVerification: 'required', timeout: CHALLENGE_MS });
    this.remember(options.challenge, 'signIn', null);
    return options;
  }

  async signIn(response: AuthenticationResponseJSON, device: DeviceInfo): Promise<SignInResult> {
    const { user, passkey } = await this.check(response, 'signIn', null);
    // The person is known: from here on this request works in their business.
    enterBusiness(user.business_id);
    await this.markUsed(passkey);
    // A passkey skips the code step, but not "set two-step sign-in up again".
    return this.authService.signIn(user, device, 'passkey');
  }

  /** After the password: the prompt for one of this person's passkeys instead of the code, or null when they have none. */
  async twoStepOptions(challenge: string): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
    const { user } = await this.twoStepService.readChallenge(challenge);
    const keys = await this.listRows(user.id);
    if (keys.length === 0) return null;
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: 'required',
      timeout: CHALLENGE_MS,
      allowCredentials: keys.map((key) => ({ id: key.credential_id, transports: key.transports })),
    });
    this.remember(options.challenge, 'twoStep', user.id);
    return options;
  }

  async twoStep(challenge: string, response: AuthenticationResponseJSON, device: DeviceInfo): Promise<LoginResult> {
    const { user, how } = await this.twoStepService.readChallenge(challenge);
    const { passkey } = await this.check(response, 'twoStep', user.id);
    enterBusiness(user.business_id);
    await this.markUsed(passkey);
    return this.authService.startSession(user, device, how);
  }

  // ---- The person's own passkeys (Profile) ----

  async list(userId: number): Promise<PasskeyList> {
    const user = await this.findUser(userId);
    const rows = await this.listRows(userId);
    return { passkeys: rows.map(toInfo), confirmWith: user.totp_secret ? 'code' : user.password_hash ? 'password' : null };
  }

  /**
   * Step one of adding a passkey: re-confirm who it is (the two-step code when
   * that is on, otherwise the password), then the device prompt.
   */
  async addOptions(userId: number, proof: { code?: string; password?: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.findUser(userId);
    if (user.totp_secret) {
      // A wrong code is the person's mistake, not an ended session: 400, so the dashboard doesn't try to sign in again.
      await this.twoStepService.confirmCode(user, proof.code ?? '').catch((error: unknown) => {
        if (error instanceof AppError && error.statusCode === 401) throw new AppError(error.message, 400, error.code);
        throw error;
      });
    } else if (user.password_hash && !(await verifyPassword(proof.password ?? '', user.password_hash))) {
      throw new AppError('That password is not right', 400, 'WRONG_PASSWORD');
    }
    const keys = await this.listRows(userId);
    if (keys.length >= MAX_PASSKEYS) throw new AppError(`You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.`, 409, 'TOO_MANY_PASSKEYS');
    const options = await generateRegistrationOptions({
      rpName: '4VD',
      rpID: this.config.rpId,
      userID: userHandle(user.id),
      userName: user.email,
      userDisplayName: user.name,
      timeout: CHALLENGE_MS,
      attestationType: 'none',
      // The same device never gets a second passkey for the same person.
      excludeCredentials: keys.map((key) => ({ id: key.credential_id, transports: key.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.remember(options.challenge, 'add', user.id);
    return options;
  }

  async add(userId: number, response: RegistrationResponseJSON, device: DeviceInfo): Promise<PasskeyInfo> {
    const user = await this.findUser(userId);
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: (challenge) => this.consume(challenge, 'add', user.id),
        expectedOrigin: this.config.origins,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new AppError('The device did not save the passkey. Try again.', 400, 'PASSKEY_NOT_SAVED');
    }
    if (!verified.verified) throw new AppError('The device did not save the passkey. Try again.', 400, 'PASSKEY_NOT_SAVED');
    const info = verified.registrationInfo;
    const aaguid = info.aaguid === '00000000-0000-0000-0000-000000000000' ? null : info.aaguid;
    const name = deviceName(aaguid, device.userAgent);
    const row = await this.db
      .insertInto('passkeys')
      .values({
        user_id: user.id,
        credential_id: info.credential.id,
        public_key: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        backed_up: info.credentialBackedUp,
        aaguid,
        name,
      })
      .onConflict((oc) => oc.column('credential_id').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new AppError('This passkey is already saved', 409, 'PASSKEY_EXISTS');
    await this.activity.create({ userId, action: 'auth.passkey_added', entityType: 'user', entityId: userId, say: { key: 'passkeyAdded', params: { device: name } } });
    await this.emailService.queue(
      user.email,
      emailTemplates.passkeyAdded({ name: user.name, device: name, link: `${this.config.dashboardUrl}/profile` }, messages[user.language]),
    );
    return toInfo(row);
  }

  async rename(userId: number, id: number, name: string): Promise<PasskeyInfo> {
    const row = await this.db.updateTable('passkeys').set({ name }).where('id', '=', id).where('user_id', '=', userId).returningAll().executeTakeFirst();
    if (!row) throw new NotFoundError('Passkey');
    return toInfo(row);
  }

  async remove(userId: number, id: number): Promise<void> {
    const row = await this.db.deleteFrom('passkeys').where('id', '=', id).where('user_id', '=', userId).returning('name').executeTakeFirst();
    if (!row) throw new NotFoundError('Passkey');
    await this.activity.create({ userId, action: 'auth.passkey_removed', entityType: 'user', entityId: userId, say: { key: 'passkeyRemoved', params: { device: row.name } } });
  }

  /** A manager removes someone's passkeys (a lost or shared device). Same rule as the two-step reset. */
  async reset(actorId: number, userId: number): Promise<{ removed: number }> {
    const { actor, target: user, home } = await this.users.inThisBusiness(actorId, userId);
    if (!actor || !user) throw new NotFoundError('User');
    if (!home) throw new ForbiddenError(NOT_HOME_MESSAGE);
    if (!mayChangePerson(actor, user)) throw new ForbiddenError('Only a main admin can reset this for a main admin, owner, admin or accountant');
    const result = await this.db.deleteFrom('passkeys').where('user_id', '=', userId).executeTakeFirst();
    const removed = Number(result.numDeletedRows);
    await this.activity.create({
      userId: actorId,
      action: 'auth.passkeys_reset',
      entityType: 'user',
      entityId: userId,
      say: { key: 'passkeysReset', params: { name: user.name, count: removed } },
    });
    return { removed };
  }

  // ---- Inside ----

  /** Checks a sign-in answer: a known passkey, the person still active, the device's check done, signed for our challenge. */
  private async check(response: AuthenticationResponseJSON, purpose: Purpose, userId: number | null): Promise<{ user: UserRow; passkey: PasskeyRow & { newCounter: number } }> {
    const passkey = await this.db.selectFrom('passkeys').selectAll().where('credential_id', '=', response.id).executeTakeFirst();
    if (!passkey || (userId !== null && passkey.user_id !== userId)) {
      throw new AppError('This passkey is not saved in 4VD any more. Sign in with your password.', 401, 'PASSKEY_UNKNOWN');
    }
    const user = await this.users.findById(passkey.user_id);
    if (!user || !user.is_active) throw new UnauthorizedError('Your account is no longer active');
    const handle = response.response.userHandle;
    if (handle && handle !== Buffer.from(userHandle(user.id)).toString('base64url')) {
      throw new AppError('This passkey is not saved in 4VD any more. Sign in with your password.', 401, 'PASSKEY_UNKNOWN');
    }
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (challenge) => this.consume(challenge, purpose, userId),
        expectedOrigin: this.config.origins,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: Number(passkey.counter),
          transports: passkey.transports,
        },
      });
    } catch (error) {
      // The device's use count went backwards: this passkey looks copied to another device.
      if (error instanceof Error && /counter/i.test(error.message)) {
        enterBusiness(user.business_id);
        await this.activity.create({
          userId: user.id,
          action: 'auth.passkey_refused',
          entityType: 'user',
          entityId: user.id,
          say: { key: 'passkeyRefused', params: { name: user.name, device: passkey.name } },
        });
        throw new AppError('This passkey was refused. Sign in with your password and remove it on your profile.', 401, 'PASSKEY_REFUSED');
      }
      throw new AppError('That passkey didn’t work. Try again or use your password.', 401, 'PASSKEY_FAILED');
    }
    if (!result.verified) throw new AppError('That passkey didn’t work. Try again or use your password.', 401, 'PASSKEY_FAILED');
    return { user, passkey: { ...passkey, newCounter: result.authenticationInfo.newCounter, backed_up: result.authenticationInfo.credentialBackedUp } };
  }

  private async markUsed(passkey: PasskeyRow & { newCounter: number }): Promise<void> {
    await this.db
      .updateTable('passkeys')
      .set({ counter: passkey.newCounter, backed_up: passkey.backed_up, last_used_at: new Date() })
      .where('id', '=', passkey.id)
      .execute();
  }

  private listRows(userId: number): Promise<PasskeyRow[]> {
    return this.db.selectFrom('passkeys').selectAll().where('user_id', '=', userId).orderBy('created_at').orderBy('id').execute();
  }

  private async findUser(userId: number): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User');
    return user;
  }

  private remember(challenge: string, purpose: Purpose, userId: number | null): void {
    const now = Date.now();
    if (this.challenges.size >= MAX_OPEN_CHALLENGES) {
      for (const [key, value] of this.challenges) if (value.until <= now) this.challenges.delete(key);
      if (this.challenges.size >= MAX_OPEN_CHALLENGES) throw new AppError('Too many requests, please try again later', 429, 'RATE_LIMITED');
    }
    this.challenges.set(challenge, { purpose, userId, until: now + CHALLENGE_MS });
  }

  /** True once per challenge, and only for what it was made for. */
  private consume(challenge: string, purpose: Purpose, userId: number | null): boolean {
    const open = this.challenges.get(challenge);
    if (!open) return false;
    this.challenges.delete(challenge);
    return open.purpose === purpose && open.userId === userId && open.until > Date.now();
  }
}
