import { type Kysely, sql } from 'kysely';

/**
 * Many businesses, phase 5e: All logs, the 4VD developer's view of every
 * business's history and of his own support visits.
 *
 * Row security keeps every request inside one business, and no session-wide
 * switch reads across them (app.system and app.maintenance stay closed to the
 * app's role). Instead two functions owned by the migration role read across
 * businesses, SECURITY DEFINER:
 * - each first checks, in the database, that the user it is given has
 *   users.is_platform_developer; the API passes only the signed-in user (re-read
 *   by requireAuth), never an id from the request;
 * - inside, app.maintenance is switched on for the owner role only (the policies
 *   honour it only for the owner), then put back;
 * - each call is written to all_logs_reads (who, what filters, when).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE all_logs_reads (
      id SERIAL PRIMARY KEY,
      developer_id INT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('activity', 'support')),
      filters JSONB NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE FUNCTION all_logs_open(p_user_id INT, p_kind TEXT, p_filters JSONB) RETURNS TEXT
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
      previous TEXT := current_setting('app.maintenance', true);
    BEGIN
      PERFORM set_config('app.maintenance', 'on', true);
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND is_platform_developer) THEN
        PERFORM set_config('app.maintenance', coalesce(previous, ''), true);
        RAISE EXCEPTION 'All logs are for the 4VD developer only' USING ERRCODE = '42501';
      END IF;
      INSERT INTO all_logs_reads (developer_id, kind, filters) VALUES (p_user_id, p_kind, p_filters);
      RETURN coalesce(previous, '');
    END
    $$
  `.execute(db);

  await sql`
    CREATE FUNCTION all_activity(
      p_user_id INT, p_business INT, p_actions TEXT[], p_exclude TEXT[], p_words TEXT[], p_limit INT, p_offset INT
    ) RETURNS TABLE (
      id INT, business_id INT, business_name TEXT, user_id INT, user_name TEXT, user_is_developer BOOLEAN,
      action TEXT, entity_type TEXT, entity_id INT, summary TEXT, summary_say JSONB, details JSONB,
      created_at TIMESTAMPTZ, undone_at TIMESTAMPTZ, total BIGINT
    )
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    #variable_conflict use_column
    DECLARE
      previous TEXT;
    BEGIN
      previous := all_logs_open(p_user_id, 'activity', jsonb_build_object(
        'business', p_business, 'actions', p_actions, 'exclude', p_exclude, 'words', p_words, 'offset', p_offset));
      RETURN QUERY
        SELECT a.id, a.business_id, b.name::text, a.user_id, u.name::text, coalesce(u.is_platform_developer, false),
               a.action::text, a.entity_type::text, a.entity_id, a.summary::text, a.summary_say, a.details,
               a.created_at, a.undone_at, count(*) OVER ()
        FROM activity_log a
        JOIN businesses b ON b.id = a.business_id
        LEFT JOIN users u ON u.id = a.user_id
        WHERE (p_business IS NULL OR a.business_id = p_business)
          AND (p_actions IS NULL OR cardinality(p_actions) = 0 OR EXISTS (
            SELECT 1 FROM unnest(p_actions) x WHERE a.action = x OR (position('.' IN x) = 0 AND a.action LIKE x || '.%')))
          AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(p_exclude, '{}')) x WHERE a.action = x OR (position('.' IN x) = 0 AND a.action LIKE x || '.%'))
          AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(p_words, '{}')) w
            WHERE NOT (a.summary ILIKE '%' || w || '%' OR coalesce(a.summary_say::text, '') ILIKE '%' || w || '%' OR b.name ILIKE '%' || w || '%'))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT p_limit OFFSET p_offset;
      PERFORM set_config('app.maintenance', previous, true);
    END
    $$
  `.execute(db);

  await sql`
    CREATE FUNCTION all_support(p_user_id INT, p_business INT, p_limit INT, p_offset INT)
    RETURNS TABLE (
      id INT, business_id INT, business_name TEXT, developer_id INT, developer_name TEXT, reason TEXT,
      started_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ, actions JSONB, total BIGINT
    )
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    #variable_conflict use_column
    DECLARE
      previous TEXT;
    BEGIN
      previous := all_logs_open(p_user_id, 'support', jsonb_build_object('business', p_business, 'offset', p_offset));
      RETURN QUERY
        SELECT v.id, v.business_id, b.name::text, v.developer_id, v.developer_name::text, v.reason::text,
               v.started_at, v.last_seen_at,
               coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', s.id, 'at', s.at, 'method', s.method, 'path', s.path,
                          'entity', s.entity, 'entityId', s.entity_id, 'status', s.status) ORDER BY s.at)
                 FROM support_actions s WHERE s.visit_id = v.id), '[]'::jsonb),
               count(*) OVER ()
        FROM support_visits v
        JOIN businesses b ON b.id = v.business_id
        WHERE p_business IS NULL OR v.business_id = p_business
        ORDER BY v.last_seen_at DESC, v.id DESC
        LIMIT p_limit OFFSET p_offset;
      PERFORM set_config('app.maintenance', previous, true);
    END
    $$
  `.execute(db);

  // Only the roles granted it may call them (the app's role gets EXECUTE from the owner's default privileges).
  for (const fn of ['all_logs_open(INT, TEXT, JSONB)', 'all_activity(INT, INT, TEXT[], TEXT[], TEXT[], INT, INT)', 'all_support(INT, INT, INT, INT)']) {
    await sql`REVOKE EXECUTE ON FUNCTION ${sql.raw(fn)} FROM PUBLIC`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION all_support(INT, INT, INT, INT)`.execute(db);
  await sql`DROP FUNCTION all_activity(INT, INT, TEXT[], TEXT[], TEXT[], INT, INT)`.execute(db);
  await sql`DROP FUNCTION all_logs_open(INT, TEXT, JSONB)`.execute(db);
  await sql`DROP TABLE all_logs_reads`.execute(db);
}
