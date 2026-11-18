import { runAsBusiness } from '../database/businessContext.js';
import type { Language } from '../i18n/language.js';
import type { LegalForm } from '../database/types.js';
import { ConflictError } from '../errors/httpErrors.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import { isUniqueViolation } from '../utils/databaseErrors.js';
import { billAddressOf } from './BillEmailService.js';
import type { InviteService } from './InviteService.js';

export interface AddBusinessInput {
  name: string;
  shortName: string;
  nui?: string | null;
  legalForm: LegalForm;
  /** Invited as the new business's main admin once it exists. */
  mainAdminEmail?: string | null;
  language?: Language;
}

export interface AddedBusinessDto {
  id: number;
  name: string;
  shortName: string;
  billAddress: string;
  /** Who got the main admin invite, if anyone. */
  invited: string | null;
}

/**
 * 4VD's developer makes a business for a customer: its own tenant, the new
 * business seed (chart, till, safe, bank, Shop floor), its short name for the
 * bill address, and optionally an invite for its first main admin.
 */
export class AddBusinessService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly inviteService: InviteService,
  ) {}

  async add(developer: { id: number; name: string; sessionId: string }, input: AddBusinessInput): Promise<AddedBusinessDto> {
    const actorId = developer.id;
    const address = billAddressOf(input.shortName);
    const id = await this.transactions
      .inNewBusiness(
        input.name,
        async (repos, businessId) => {
          // Making it is the developer's first visit: its people see it in Support visits like any other.
          await repos.db
            .insertInto('support_visits')
            .values({ developer_id: developer.id, developer_name: developer.name, session_id: developer.sessionId, reason: 'Created the business' })
            .execute();
          await repos.activityLog.create({
            userId: actorId,
            action: 'business.created',
            entityType: 'business',
            entityId: businessId,
            say: { key: 'businessCreated', params: { name: input.name } },
            details: { name: input.name, shortName: input.shortName, nui: input.nui ?? null, legalForm: input.legalForm },
          });
          return businessId;
        },
        { shortName: input.shortName, nui: input.nui ?? null, legalForm: input.legalForm },
      )
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'businesses_short_name_key')) throw new ConflictError(`${address} is already used by another business. Pick another short name.`);
        throw error;
      });
    // After the business is saved, so a failed invite email never undoes it; sent from inside the new business.
    const invited = input.mainAdminEmail
      ? (await runAsBusiness(id, () => this.inviteService.invite(actorId, input.mainAdminEmail!, 'main_admin', input.language))).email
      : null;
    return { id, name: input.name, shortName: input.shortName, billAddress: address, invited };
  }
}
