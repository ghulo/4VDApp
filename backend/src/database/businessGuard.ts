import { CompiledQuery, type DatabaseConnection, type KyselyPlugin, type PluginTransformQueryArgs, type PluginTransformResultArgs, type QueryResult, type RootOperationNode, type UnknownRow } from 'kysely';
import { logger } from '../utils/logger.js';
import { currentContext } from './businessContext.js';
import { GLOBAL_TABLES } from './globalTables.js';

/** What each open connection was last told. Kysely keeps one connection object per pooled client. */
const told = new WeakMap<DatabaseConnection, string>();

/**
 * Tell each connection, every time it is taken from the pool, which business
 * the current work is for (or none, as ''): a pooled connection must never keep
 * the previous request's business. The setting is session-wide and set outside
 * any transaction (Kysely reserves before BEGIN), so when the connection
 * already holds this exact value the round trip is skipped (it doubled the
 * time of a simple query).
 */
export function businessSetter(outsideContextBusiness?: number) {
  return async (connection: DatabaseConnection): Promise<void> => {
    const context = currentContext();
    // Work outside any context (only test setup gets a default) has no business.
    const businessId = context ? context.businessId : (outsideContextBusiness ?? null);
    const value = businessId == null ? '' : String(businessId);
    // Before the business is known (signing in), the database lets business rows be read, never written.
    const system = context?.system && businessId == null ? 'on' : '';
    const key = `${value}|${system}`;
    if (told.get(connection) === key) return;
    told.delete(connection);
    await connection.executeQuery(
      CompiledQuery.raw(`select set_config('app.business_id', $1, false), set_config('app.system', $2, false)`, [value, system]),
    );
    told.set(connection, key);
  };
}

const GLOBAL = new Set(GLOBAL_TABLES);
const RAW_TABLE = /\b(?:from|join|into|update)\s+"?([a-z_]+)"?/gi;

function tablesIn(node: unknown, found: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) tablesIn(item, found);
    return;
  }
  const record = node as Record<string, unknown>;
  // A column reference like `u.email` names the alias, not a table.
  if (record.kind === 'ReferenceNode') return;
  if (record.kind === 'TableNode') {
    const name = (record.table as { identifier?: { name?: string } } | undefined)?.identifier?.name;
    if (name) found.add(name);
  } else if (record.kind === 'RawNode') {
    for (const match of (record.sqlFragments as string[]).join(' ').matchAll(RAW_TABLE)) found.add(match[1]!.toLowerCase());
  }
  for (const value of Object.values(record)) if (value && typeof value === 'object') tablesIn(value, found);
}

const WRITE_KINDS = new Set(['InsertQueryNode', 'UpdateQueryNode', 'DeleteQueryNode', 'MergeQueryNode']);
const RAW_WRITE = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;

function writes(node: RootOperationNode): boolean {
  if (WRITE_KINDS.has(node.kind)) return true;
  return node.kind === 'RawNode' && RAW_WRITE.test(node.sqlFragments.join(' '));
}

const warned = new Set<string>();

/**
 * Catch work that touches a business's tables without saying which business.
 * Inside a request that is a bug: tests fail on it, production logs it. Outside
 * a request (tests setting up data, one-off tools) it is only logged. Live it is
 * logged as an error (alert email, Sentry): under row security such a query
 * sees no rows and its writes fail.
 */
export const businessGuard: KyselyPlugin = {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const context = currentContext();
    if (context?.businessId != null) return args.node;
    // Before the business is known (signing in), business tables may be read, never written.
    if (context?.system && !writes(args.node)) return args.node;
    const tables = new Set<string>();
    tablesIn(args.node, tables);
    // Postgres's own catalog (pg_roles, pg_class…) belongs to no business.
    const scoped = [...tables].filter((table) => !GLOBAL.has(table) && !table.startsWith('pg_') && table !== 'information_schema');
    if (scoped.length === 0) return args.node;
    const message = `A query on ${scoped.join(', ')} ran without a business`;
    if (context?.inRequest && process.env.NODE_ENV === 'test') throw new Error(message);
    if (process.env.NODE_ENV !== 'test' && !warned.has(message)) {
      warned.add(message);
      logger.error(message, { inRequest: Boolean(context?.inRequest), stack: new Error().stack?.split('\n').slice(2, 8).join(' | ') });
    }
    return args.node;
  },
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  },
};
