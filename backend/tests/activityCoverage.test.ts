// Every change that matters writes an Activity entry, or History and Undo miss it. The architecture map's call graph
// (docs/architecture-map) lists, for each endpoint, the tables its call tree writes; this test fails when an endpoint
// writes tables but never activity_log, unless it is on the reviewed list in helpers/activityAllowlist.ts. The map
// reads the code as text: calls through interfaces aren't followed (its blindSpots), so a pass is not a proof.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_ALLOWLIST } from './helpers/activityAllowlist.js';

interface Endpoint {
  method: string;
  path: string;
  writes: string[];
}

function mapEndpoints(): Endpoint[] {
  const out = mkdtempSync(join(tmpdir(), 'archmap-'));
  try {
    execFileSync(process.execPath, [resolve(__dirname, '../../docs/architecture-map/generate.mjs')], { env: { ...process.env, MAP_OUT_DIR: out }, stdio: 'pipe' });
    const map = JSON.parse(readFileSync(join(out, 'architecture.json'), 'utf8')) as { backend: { mounts: Array<{ endpoints: Endpoint[] }> } };
    return map.backend.mounts.flatMap((mount) => mount.endpoints);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

describe('every edit writes its History entry', () => {
  const endpoints = mapEndpoints();
  const offenders = endpoints.filter((ep) => ep.writes.length > 0 && !ep.writes.includes('activity_log')).map((ep) => `${ep.method} ${ep.path}`);

  it('finds the endpoints (the map still reads the routes)', () => {
    expect(endpoints.length).toBeGreaterThan(300);
  });

  it('has no endpoint that changes data without an Activity entry, other than the reviewed list', () => {
    const unexplained = offenders.filter((key) => !(key in ACTIVITY_ALLOWLIST));
    // Log the change (repos.activityLog.create) so it shows in History, or add it to helpers/activityAllowlist.ts with a reason.
    expect(unexplained).toEqual([]);
  });

  it('keeps the reviewed list honest: every entry still writes without an Activity entry', () => {
    const stale = Object.keys(ACTIVITY_ALLOWLIST).filter((key) => !offenders.includes(key));
    expect(stale).toEqual([]);
  });
});
