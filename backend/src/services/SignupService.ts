import { ConflictError, NotFoundError } from '../errors/httpErrors.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { UserRepository } from '../repositories/UserRepository.js';
import { hashPassword } from '../utils/password.js';
import type { AccountService } from './AccountService.js';

export interface SignupInput {
  shopName: string;
  name: string;
  email: string;
  password: string;
}

/**
 * "Create your shop": a new business and its owner. Switched off with
 * ALLOW_SIGNUP while 4VD serves one shop; it's here so turning 4VD into a
 * product for other shops is a setting, not a rewrite.
 */
export class SignupService {
  constructor(
    private readonly enabled: boolean,
    private readonly userRepository: UserRepository,
    private readonly accountService: AccountService,
    private readonly transactions: TransactionManager,
  ) {}

  async signup(input: SignupInput): Promise<void> {
    if (!this.enabled) throw new NotFoundError('Sign-up is not open');
    if (await this.userRepository.findByEmail(input.email)) {
      throw new ConflictError(`${input.email} already has an account. Log in instead.`);
    }
    const passwordHash = await hashPassword(input.password);
    const owner = await this.transactions.run(async (repos) => {
      const businessId = await repos.users.createBusiness(input.shopName);
      return repos.users.create({
        email: input.email,
        name: input.name,
        role: 'developer',
        password_hash: passwordHash,
        business_id: businessId,
        email_verified_at: null,
      });
    });
    await this.accountService.sendVerification(owner.id);
  }
}
