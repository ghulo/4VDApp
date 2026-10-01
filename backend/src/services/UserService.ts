import type { UserRole } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import type { PublicUser } from '../types/auth.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { type Paginated, type PageRequest, toOffset, toPaginationMeta } from '../utils/pagination.js';
import { hashPassword } from '../utils/password.js';
import { toPublicUser } from './mappers.js';

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

    try {
      return await this.transactions.run(async (repos) => {
        const user = await repos.users.create({
          email: input.email,
          name: input.name,
          role: input.role,
          password_hash: passwordHash,
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

    const losesAdmin = user.role === 'admin' && ((input.role && input.role !== 'admin') || input.isActive === false);
    if (losesAdmin) await this.ensureAnotherAdminRemains(id === actingUserId);
    const passwordHash = input.password === undefined ? undefined : await hashPassword(input.password);

    const updated = await this.transactions.run(async (repos) => {
      const result = await repos.users.update(id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.isActive !== undefined && { is_active: input.isActive }),
        ...(passwordHash !== undefined && { password_hash: passwordHash }),
      });
      if (!result) throw new NotFoundError(`User ${id} does not exist`);
      await repos.activityLog.create({
        userId: actingUserId,
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        summary: describeUserChanges(user.name, user.role, user.is_active, input),
        // Never the password itself, only that it changed.
        details: {
          ...(input.name !== undefined && { name: { from: user.name, to: input.name } }),
          ...(input.role !== undefined && { role: { from: user.role, to: input.role } }),
          ...(input.isActive !== undefined && { isActive: { from: user.is_active, to: input.isActive } }),
          ...(input.password !== undefined && { passwordChanged: true }),
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
    if (user.role === 'admin') await this.ensureAnotherAdminRemains(false);

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
  private async ensureAnotherAdminRemains(isSelf: boolean): Promise<void> {
    if ((await this.userRepository.countActiveAdmins()) <= 1) {
      throw new ConflictError(
        isSelf
          ? "You're the only admin. Make someone else an admin first."
          : 'This is the only admin left. Make someone else an admin first.',
      );
    }
  }
}

function describeUserChanges(name: string, role: UserRole, isActive: boolean, input: UpdateUserInput): string {
  const parts: string[] = [];
  if (input.name !== undefined && input.name !== name) parts.push(`renamed ${name} to ${input.name}`);
  if (input.role !== undefined && input.role !== role) parts.push(`changed ${name}'s role from ${role} to ${input.role}`);
  if (input.isActive === false && isActive) parts.push(`blocked ${name}`);
  if (input.isActive === true && !isActive) parts.push(`let ${name} back in`);
  if (input.password !== undefined) parts.push(`set a new password for ${name}`);
  const sentence = parts.length > 0 ? parts.join('; ') : `saved ${name} with no changes`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
