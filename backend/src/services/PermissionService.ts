import type { UserRole } from '../database/types.js';
import type { ActivityLogRepository } from '../repositories/ActivityLogRepository.js';
import type { SettingsRepository } from '../repositories/SettingsRepository.js';
import type { TransactionManager } from '../repositories/TransactionManager.js';
import type { PublicUser } from '../types/auth.js';
import { applyGrants, currentGrants, DEFAULT_GRANTS, EDITABLE_ROLES, type Grants, LOCKED_POWERS, POWERS, type Power } from '../utils/roles.js';

const KEY = 'role_permissions';

/** What is saved: which editable roles hold each power, and the menu pages whose roles differ from the usual. */
export interface StoredPermissions {
  powers: Partial<Grants>;
  /** Menu address → the roles that see it. Only pages changed from the usual are kept; the dashboard knows the usual. */
  pages: Record<string, UserRole[]>;
}

export interface RolePermissions {
  powers: Grants;
  pages: Record<string, UserRole[]>;
  defaults: Grants;
  editableRoles: UserRole[];
  lockedPowers: Power[];
}

export interface RoleChange {
  role: UserRole;
  power: Power;
  on: boolean;
}

/**
 * What each role may do, as the developer set it in Settings → Roles. Loaded
 * once into utils/roles.ts (where every check reads it) and swapped in place on
 * each change, so a change applies to the very next request.
 */
export class PermissionService {
  private loading: Promise<void> | null = null;
  private pages: Record<string, UserRole[]> = {};

  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly activityLogRepository: ActivityLogRepository,
    private readonly transactions: TransactionManager,
  ) {}

  /** Read the saved rules the first time anyone asks; later calls cost nothing. */
  ensureLoaded(): Promise<void> {
    this.loading ??= this.load().catch((error: unknown) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  /** Forget what was read, so the next request reads the database again (tests reset the data underneath). */
  forget(): void {
    this.loading = null;
  }

  async get(): Promise<RolePermissions> {
    await this.ensureLoaded();
    return { powers: currentGrants(), pages: this.pages, defaults: DEFAULT_GRANTS, editableRoles: EDITABLE_ROLES, lockedPowers: LOCKED_POWERS };
  }

  async update(input: StoredPermissions, actor: PublicUser, restoredFrom?: number): Promise<RolePermissions> {
    await this.ensureLoaded();
    const before = this.stored();
    const after = tidy(input);
    const changes = roleChanges(before.powers, after.powers);
    const pages = changedPages(before.pages, after.pages);
    if (changes.length > 0 || pages > 0) {
      await this.transactions.run(async (repos) => {
        await repos.settings.set(KEY, after, actor.id);
        await repos.activityLog.create({
          userId: actor.id,
          action: 'roles.updated',
          entityType: 'settings',
          entityId: null,
          say: { key: 'rolesChanged', params: { changes, pages } },
          details: { before, after, ...(restoredFrom !== undefined && { restoredFrom }) },
        });
      });
      this.use(after);
    }
    return this.get();
  }

  /** The last changes, newest first, each with what it was before so it can be put back. */
  async history() {
    const { entries } = await this.activityLogRepository.findMany({ actions: ['roles.updated'], limit: 10, offset: 0 });
    return entries.map((entry) => ({
      id: entry.id,
      at: entry.created_at,
      by: entry.user_name,
      summary: entry.summary_say,
      changes: (entry.summary_say?.params as { changes?: RoleChange[] } | undefined)?.changes ?? [],
      pages: (entry.summary_say?.params as { pages?: number } | undefined)?.pages ?? 0,
    }));
  }

  /** Put the rules back as they were before change `entryId`. */
  async restore(entryId: number, actor: PublicUser): Promise<RolePermissions | null> {
    const { entries } = await this.activityLogRepository.findMany({ id: entryId, actions: ['roles.updated'], limit: 1, offset: 0 });
    const before = entries[0]?.details?.before as StoredPermissions | undefined;
    if (!before) return null;
    return this.update(before, actor, entryId);
  }

  private async load(): Promise<void> {
    const saved = (await this.settingsRepository.all()).get(KEY) as Partial<StoredPermissions> | undefined;
    this.use(tidy({ powers: saved?.powers ?? {}, pages: saved?.pages ?? {} }));
  }

  private use(stored: StoredPermissions): void {
    applyGrants(stored.powers);
    this.pages = stored.pages;
  }

  /** The rules in force, as they would be saved. */
  private stored(): StoredPermissions {
    const grants = currentGrants();
    const powers = Object.fromEntries(POWERS.map((power) => [power, grants[power].filter((role) => EDITABLE_ROLES.includes(role))]));
    return { powers, pages: this.pages };
  }
}

/** Only editable roles, only known powers, locked powers as usual; a power that isn't mentioned keeps its usual roles. */
function tidy(input: StoredPermissions): StoredPermissions {
  const editable = (roles: UserRole[] | undefined) => EDITABLE_ROLES.filter((role) => roles?.includes(role));
  const powers = Object.fromEntries(
    POWERS.map((power) => [power, editable(LOCKED_POWERS.includes(power) ? DEFAULT_GRANTS[power] : (input.powers[power] ?? DEFAULT_GRANTS[power]))]),
  );
  const pages = Object.fromEntries(Object.entries(input.pages).map(([page, roles]) => [page, editable(roles)]));
  return { powers, pages };
}

function roleChanges(before: Partial<Grants>, after: Partial<Grants>): RoleChange[] {
  const changes: RoleChange[] = [];
  for (const power of POWERS) {
    for (const role of EDITABLE_ROLES) {
      const had = before[power]?.includes(role) ?? false;
      const has = after[power]?.includes(role) ?? false;
      if (had !== has) changes.push({ role, power, on: has });
    }
  }
  return changes;
}

function changedPages(before: Record<string, UserRole[]>, after: Record<string, UserRole[]>): number {
  const key = (roles: UserRole[] | undefined) => (roles ? [...roles].sort().join(',') : null);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((page) => key(before[page]) !== key(after[page])).length;
}
