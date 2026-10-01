import type { UserRole } from '../database/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/httpErrors.js';
import type { RefreshTokenRepository } from '../repositories/RefreshTokenRepository.js';
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
  ) {}

  async list(query: PageRequest & { role?: UserRole }): Promise<Paginated<PublicUser>> {
    const { users, total } = await this.userRepository.findAll({
      role: query.role,
      limit: query.limit,
      offset: toOffset(query),
    });
    return { items: users.map(toPublicUser), meta: toPaginationMeta(query, total) };
  }

  async create(input: CreateUserInput): Promise<PublicUser> {
    const existing = await this.userRepository.findByEmail(input.email);
    if (existing) throw new ConflictError(`An account for ${input.email} already exists`);

    try {
      const user = await this.userRepository.create({
        email: input.email,
        name: input.name,
        role: input.role,
        password_hash: await hashPassword(input.password),
      });
      return toPublicUser(user);
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

    const updated = await this.userRepository.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
      ...(input.password !== undefined && { password_hash: await hashPassword(input.password) }),
    });
    if (!updated) throw new NotFoundError(`User ${id} does not exist`);

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

    await this.userRepository.softDelete(id);
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
