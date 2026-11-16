#!/usr/bin/env bash
# Restores a 4VD backup (an unencrypted pg_dump custom-format file) into an EMPTY
# database and checks it looks like the real thing. Exits non-zero, with a clear
# ::error:: line, when anything is off.
#
# Usage: restore-check.sh <file.dump> <empty database url>
# Needs pg_restore and psql of the same major version as the dump (17).
# Used by .github/workflows/restore-check.yml; can also be run by hand (docs/DEPLOYMENT.md).
set -euo pipefail

DUMP="$1"
DB="$2"

fail() { echo "::error::$1"; exit 1; }

echo "Restoring $(du -h "$DUMP" | cut -f1) into the empty database..."
# Without --exit-on-error so every problem is listed, then any error fails the run.
set +e
pg_restore --no-owner --no-privileges --dbname "$DB" "$DUMP" 2> restore-errors.txt
code=$?
set -e
if [ "$code" -ne 0 ] || grep -q "error:" restore-errors.txt; then
  cat restore-errors.txt
  fail "pg_restore reported errors (listed above); this backup did not restore cleanly"
fi

q() { psql "$DB" --no-psqlrc --tuples-only --no-align --quiet --command "$1"; }

# Every table in the dump must be back.
expected=$(pg_restore --list "$DUMP" | grep -c ' TABLE DATA public ')
restored=$(q "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
echo "Tables: $restored restored, $expected with data in the dump."
[ "$restored" -ge "$expected" ] || fail "Only $restored of $expected tables came back"

# The tables a shop can't work without must have rows.
problems=0
printf '%-20s %10s\n' table rows
for t in kysely_migration businesses users products inventory sales; do
  n=$(q "select count(*) from public.$t" 2>/dev/null || echo missing)
  printf '%-20s %10s\n' "$t" "$n"
  if [ "$n" = missing ] || [ "$n" -eq 0 ]; then
    echo "::error::Table $t is missing or empty in the restored backup"
    problems=1
  fi
done
[ "$problems" -eq 0 ] || exit 1

# Show how fresh the data is (newest sale), for the run summary.
newest=$(q "select coalesce(max(created_at)::text, 'none') from public.sales")
migration=$(q "select name from public.kysely_migration order by name desc limit 1")
echo "Newest sale: $newest. Last migration: $migration."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Backup restored and checked"
    echo "- File: \`$(basename "$DUMP")\`"
    echo "- Tables: $restored"
    echo "- Newest sale: $newest"
    echo "- Last migration: \`$migration\`"
  } >> "$GITHUB_STEP_SUMMARY"
fi
echo "Restore check passed."
