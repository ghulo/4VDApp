import type { StoredRole, UserRole, UserRow } from '../database/types.js';
import { currentBusinessId } from '../database/businessContext.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import type { PublicUser } from '../types/auth.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { hashPassword } from '../utils/password.js';
import { canHandOut, canManage, mayChangePerson, rolesWith } from '../utils/roles.js';
import { toMoneyOrNull, toPublicUser } from './mappers.js';
import type { Say, UserChange } from '../i18n/activityText.js';

const TOP_ROLE_MESSAGE = 'Only a main admin can add or change a main admin, owner, admin or accountant';
export const NOT_HOME_MESSAGE = "This person's account belongs to another business. Here you can change only their role, block them or take them off this business.";

export interface CreateUserInput {
  email: string;
  name: string;
  role: StoredRole;
  password: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: StoredRole;
  isActive?: boolean;
  password?: string;
  monthlyTarget?: number | null;
  commissionPercent?: number | null;
}

export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly transactions: TransactionManager,
  ) {}

  /** Everyone, each with when they last used 4VD on any device (null if never). */
  async list(query: PageRequest & { role?: UserRole }): Promise<Paginated<PublicUser & { lastActiveAt: string | null; passkeys: boolean; homeHere: boolean }>> {
    const [{ users, total }, lastUsed] = await Promise.all([
      this.userRepository.findAll({ role: query.role, limit: query.limit, offset: toOffset(query) }),
      this.refreshTokenRepository.lastUsedByUser(),
    ]);
    const withPasskeys = await this.userRepository.withPasskeys(users.map((user) => user.id));
    return {
      items: users.map((user) => ({
        ...toPublicUser(user),
        lastActiveAt: lastUsed.get(user.id)?.toISOString() ?? null,
        passkeys: withPasskeys.has(user.id),
        // Their account belongs to this business (else only their role and access here change).
        homeHere: user.business_id === currentBusinessId(),
      })),
      meta: toPaginationMeta(query, total),
    };
  }

  async create(input: CreateUserInput, actorId: number): Promise<PublicUser> {
    const existing = await this.userRepository.findByEmail(input.email);
    if (existing) throw new ConflictError(`An account for ${input.email} already exists`);
    const passwordHash = await hashPassword(input.password);
    const { actor } = await this.userRepository.inThisBusiness(actorId, actorId);
    if (!actor) throw new NotFoundError(`User ${actorId} does not exist`);
    if (!canHandOut(actor.is_platform_developer ? 'developer' : actor.role, input.role)) throw new ForbiddenError(TOP_ROLE_MESSAGE);
    const businessId = currentBusinessId();
    if (businessId === null) throw new Error('Adding someone needs a business');

    try {
      return await this.transactions.run(async (repos) => {
        // Made by the owner, who vouches for the address, so it counts as verified.
        const user = await repos.users.create({
          email: input.email,
          name: input.name,
          role: input.role,
          password_hash: passwordHash,
          business_id: businessId,
          email_verified_at: new Date(),
        });
        await repos.activityLog.create({
          userId: actorId,
          action: 'user.created',
          entityType: 'user',
          entityId: user.id,
          say: { key: 'userAdded', params: { name: user.name, role: user.role } },
          details: { email: user.email, role: user.role },
        });
        return toPublicUser(user);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError(`An account for ${input.email} already exists`);
      throw error;
    }
  }

  /** `logExtra` is added to the logged details (a restore marks its own change with it). */
  async update(id: number, input: UpdateUserInput, actingUserId: number, logExtra?: Record<string, unknown>): Promise<PublicUser> {
    const { actor, target: user, home } = await this.userRepository.inThisBusiness(actingUserId, id);
    if (!user) throw new NotFoundError(`User ${id} does not exist`);
    if (!actor) throw new NotFoundError(`User ${actingUserId} does not exist`);
    // Someone whose home is another business: only their place here changes.
    const accountChange = input.name !== undefined || input.password !== undefined || input.monthlyTarget !== undefined || input.commissionPercent !== undefined;
    if (!home && accountChange) throw new ForbiddenError(NOT_HOME_MESSAGE);

    await this.keepSomeoneInCharge(user, input, id === actingUserId);
    // People may always change their own details; changing someone with a top
    // role, or giving anyone a top role, is for a main admin.
    if (id !== actingUserId && !mayChangePerson(actor, user)) throw new ForbiddenError(TOP_ROLE_MESSAGE);
    if (input.role && input.role !== user.role && !canHandOut(actor.is_platform_developer ? 'developer' : actor.role, input.role)) {
      throw new ForbiddenError(TOP_ROLE_MESSAGE);
    }
    const passwordHash = input.password === undefined ? undefined : await hashPassword(input.password);

    const updated = await this.transactions.run(async (repos) => {
      if (!home && (input.role !== undefined || input.isActive !== undefined)) {
        const changed = await repos.users.updateMembership(id, {
          ...(input.role !== undefined && { role: input.role }),
          ...(input.isActive !== undefined && { is_active: input.isActive }),
        });
        if (!changed) throw new NotFoundError(`User ${id} does not exist`);
      }
      const result = !home
        ? await repos.users.person(id)
        : await repos.users.update(id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.isActive !== undefined && { is_active: input.isActive }),
        ...(passwordHash !== undefined && { password_hash: passwordHash }),
        ...(input.monthlyTarget !== undefined && { monthly_target: input.monthlyTarget }),
        ...(input.commissionPercent !== undefined && { commission_percent: input.commissionPercent }),
      });
      if (!result) throw new NotFoundError(`User ${id} does not exist`);
      await repos.activityLog.create({
        userId: actingUserId,
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        say: describeUserChanges(user, input),
        // Never the password itself, only that it changed.
        details: {
          ...(input.name !== undefined && { name: { from: user.name, to: input.name } }),
          ...(input.role !== undefined && { role: { from: user.role, to: input.role } }),
          ...(input.isActive !== undefined && { isActive: { from: user.is_active, to: input.isActive } }),
          ...(input.password !== undefined && { passwordChanged: true }),
          ...(input.monthlyTarget !== undefined && { monthlyTarget: { from: toMoneyOrNull(user.monthly_target), to: input.monthlyTarget } }),
          ...(input.commissionPercent !== undefined && {
            commissionPercent: { from: user.commission_percent === null ? null : Number(user.commission_percent), to: input.commissionPercent },
          }),
          ...logExtra,
        },
      });
      return result;
    });

    // A new password or lost access should end their other sessions straight away.
    if (input.password !== undefined || input.isActive === false || (input.role && input.role !== user.role)) {
      await this.endSessions(id, home);
    }
    return toPublicUser(updated);
  }

  async delete(id: number, actingUserId: number): Promise<void> {
    if (id === actingUserId) throw new ValidationError("You can't delete your own account");

    const { actor, target: user, home } = await this.userRepository.inThisBusiness(actingUserId, id);
    if (!user) throw new NotFoundError(`User ${id} does not exist`);
    if (!actor) throw new NotFoundError(`User ${actingUserId} does not exist`);
    if (!mayChangePerson(actor, user)) throw new ForbiddenError(TOP_ROLE_MESSAGE);
    await this.keepSomeoneInCharge(user, { isActive: false }, false);

    await this.transactions.run(async (repos) => {
      // Their home business deletes the account; any other business only takes them off its own list.
      if (home) await repos.users.softDelete(id);
      else await repos.users.removeMembership(id);
      await repos.activityLog.create({
        userId: actingUserId,
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
        say: { key: 'userRemoved', params: { name: user.name } },
      });
    });
    await this.endSessions(id, home);
  }

  /** Signed out everywhere when it is their home business, else only from their sessions in this business. */
  private async endSessions(userId: number, home: boolean): Promise<void> {
    const businessId = currentBusinessId();
    if (home || businessId === null) await this.refreshTokenRepository.revokeAllForUser(userId);
    else await this.refreshTokenRepository.revokeForUserIn(userId, businessId);
  }

  /** Never let the app end up with nobody who can manage it. */
  /**
   * The shop always keeps a main admin and someone who can manage it, so nobody
   * can lock everyone out by demoting, blocking or removing the last one.
   */
  private async keepSomeoneInCharge(user: UserRow, change: UpdateUserInput, isSelf: boolean): Promise<void> {
    const leaves = (keeps: (role: UserRole) => boolean) =>
      keeps(user.role) && ((change.role !== undefined && !keeps(change.role)) || change.isActive === false);

    if (leaves((role) => role === 'main_admin') && (await this.userRepository.countActive(['main_admin'])) <= 1) {
      throw new ConflictError(
        isSelf
          ? "You're the only main admin. Make someone else a main admin first."
          : 'This is the only main admin left. Make someone else a main admin first.',
      );
    }
    if (leaves(canManage) && (await this.userRepository.countActive(rolesWith('manage'))) <= 1) {
      throw new ConflictError(
        isSelf
          ? "You're the only admin. Make someone else an admin first."
          : 'This is the only admin left. Make someone else an admin first.',
      );
    }
  }
}

/** What an edit changed about someone, for the activity sentence. */
function describeUserChanges(user: UserRow, input: UpdateUserInput): Say {
  const { name, role, is_active: isActive } = user;
  const changes: UserChange[] = [];
  if (input.name !== undefined && input.name !== name) changes.push({ kind: 'renamed', to: input.name });
  if (input.role !== undefined && input.role !== role) changes.push({ kind: 'role', from: role, to: input.role });
  if (input.isActive === false && isActive) changes.push({ kind: 'blocked' });
  if (input.isActive === true && !isActive) changes.push({ kind: 'allowed' });
  if (input.password !== undefined) changes.push({ kind: 'password' });
  if (input.monthlyTarget !== undefined && input.monthlyTarget !== toMoneyOrNull(user.monthly_target)) {
    changes.push(input.monthlyTarget === null ? { kind: 'targetRemoved' } : { kind: 'target', to: input.monthlyTarget });
  }
  const commission = user.commission_percent === null ? null : Number(user.commission_percent);
  if (input.commissionPercent !== undefined && input.commissionPercent !== commission) {
    changes.push(input.commissionPercent === null ? { kind: 'commissionRemoved' } : { kind: 'commission', to: input.commissionPercent });
  }
  return { key: 'userChanged', params: { name, changes } };
}
