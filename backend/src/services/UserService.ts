import type { UserRole, UserRow } from '../database/types.js';
import { formatEuro } from '../utils/money.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import type { PublicUser } from '../types/auth.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { hashPassword } from '../utils/password.js';
import { canHandOut, canManage, MANAGER_ROLES } from '../utils/roles.js';
import { toMoneyOrNull, toPublicUser } from './mappers.js';

const TOP_ROLE_MESSAGE = 'Only the developer can add or change an owner, admin or developer';

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  password: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
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

  async list(query: PageRequest & { role?: UserRole }): Promise<Paginated<PublicUser>> {
    const { users, total } = await this.userRepository.findAll({
      role: query.role,
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: users.map(toPublicUser), meta: toPaginationMeta(query, total) };
  }

  async create(input: CreateUserInput, actorId: number): Promise<PublicUser> {
    const existing = await this.userRepository.findByEmail(input.email);
    if (existing) throw new ConflictError(`An account for ${input.email} already exists`);
    const passwordHash = await hashPassword(input.password);
    const actor = await this.userRepository.findById(actorId);
    if (!actor) throw new NotFoundError(`User ${actorId} does not exist`);
    if (!canHandOut(actor.role, input.role)) throw new ForbiddenError(TOP_ROLE_MESSAGE);

    try {
      return await this.transactions.run(async (repos) => {
        // Made by the owner, who vouches for the address, so it counts as verified.
        const user = await repos.users.create({
          email: input.email,
          name: input.name,
          role: input.role,
          password_hash: passwordHash,
          business_id: actor.business_id,
          email_verified_at: new Date(),
        });
        await repos.activityLog.create({
          userId: actorId,
          action: 'user.created',
          entityType: 'user',
          entityId: user.id,
          summary: `Added ${user.name} as ${user.role}`,
          details: { email: user.email, role: user.role },
        });
        return toPublicUser(user);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError(`An account for ${input.email} already exists`);
      throw error;
    }
  }

  async update(id: number, input: UpdateUserInput, actingUserId: number): Promise<PublicUser> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError(`User ${id} does not exist`);

    await this.keepSomeoneInCharge(user, input, id === actingUserId);
    const actor = id === actingUserId ? user : await this.userRepository.findById(actingUserId);
    if (!actor) throw new NotFoundError(`User ${actingUserId} does not exist`);
    // People may always change their own details; changing someone with a top
    // role, or giving anyone a top role, is for the developer.
    if (id !== actingUserId && !canHandOut(actor.role, user.role)) throw new ForbiddenError(TOP_ROLE_MESSAGE);
    if (input.role && input.role !== user.role && !canHandOut(actor.role, input.role)) {
      throw new ForbiddenError(TOP_ROLE_MESSAGE);
    }
    const passwordHash = input.password === undefined ? undefined : await hashPassword(input.password);

    const updated = await this.transactions.run(async (repos) => {
      const result = await repos.users.update(id, {
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
        summary: describeUserChanges(user, input),
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
        },
      });
      return result;
    });

    // A new password or lost access should end their other sessions straight away.
    if (input.password !== undefined || input.isActive === false || (input.role && input.role !== user.role)) {
      await this.refreshTokenRepository.revokeAllForUser(id);
    }
    return toPublicUser(updated);
  }

  async delete(id: number, actingUserId: number): Promise<void> {
    if (id === actingUserId) throw new ValidationError("You can't delete your own account");

    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError(`User ${id} does not exist`);
    const actor = await this.userRepository.findById(actingUserId);
    if (!actor) throw new NotFoundError(`User ${actingUserId} does not exist`);
    if (!canHandOut(actor.role, user.role)) throw new ForbiddenError(TOP_ROLE_MESSAGE);
    await this.keepSomeoneInCharge(user, { isActive: false }, false);

    await this.transactions.run(async (repos) => {
      await repos.users.softDelete(id);
      await repos.activityLog.create({
        userId: actingUserId,
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
        summary: `Removed ${user.name}`,
      });
    });
    await this.refreshTokenRepository.revokeAllForUser(id);
  }

  /** Never let the app end up with nobody who can manage it. */
  /**
   * The shop always keeps a developer and someone who can manage it, so nobody
   * can lock everyone out by demoting, blocking or removing the last one.
   */
  private async keepSomeoneInCharge(user: UserRow, change: UpdateUserInput, isSelf: boolean): Promise<void> {
    const leaves = (keeps: (role: UserRole) => boolean) =>
      keeps(user.role) && ((change.role !== undefined && !keeps(change.role)) || change.isActive === false);

    if (leaves((role) => role === 'developer') && (await this.userRepository.countActive(['developer'])) <= 1) {
      throw new ConflictError(
        isSelf
          ? "You're the only developer. Make someone else a developer first."
          : 'This is the only developer left. Make someone else a developer first.',
      );
    }
    if (leaves(canManage) && (await this.userRepository.countActive(MANAGER_ROLES)) <= 1) {
      throw new ConflictError(
        isSelf
          ? "You're the only admin. Make someone else an admin first."
          : 'This is the only admin left. Make someone else an admin first.',
      );
    }
  }
}

function describeUserChanges(user: UserRow, input: UpdateUserInput): string {
  const { name, role, is_active: isActive } = user;
  const parts: string[] = [];
  if (input.name !== undefined && input.name !== name) parts.push(`renamed ${name} to ${input.name}`);
  if (input.role !== undefined && input.role !== role) parts.push(`changed ${name}'s role from ${role} to ${input.role}`);
  if (input.isActive === false && isActive) parts.push(`blocked ${name}`);
  if (input.isActive === true && !isActive) parts.push(`let ${name} back in`);
  if (input.password !== undefined) parts.push(`set a new password for ${name}`);
  if (input.monthlyTarget !== undefined && input.monthlyTarget !== toMoneyOrNull(user.monthly_target)) {
    parts.push(input.monthlyTarget === null ? `removed ${name}'s monthly target` : `set ${name}'s monthly target to ${formatEuro(input.monthlyTarget)}`);
  }
  const commission = user.commission_percent === null ? null : Number(user.commission_percent);
  if (input.commissionPercent !== undefined && input.commissionPercent !== commission) {
    parts.push(input.commissionPercent === null ? `removed ${name}'s commission` : `set ${name}'s commission to ${input.commissionPercent}%`);
  }
  const sentence = parts.length > 0 ? parts.join('; ') : `saved ${name} with no changes`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
