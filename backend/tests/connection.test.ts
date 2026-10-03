import { describe, expect, it } from 'vitest';
import { createPool } from '../src/database/connection.js';

describe('database pool', () => {
  it('should survive the database dropping an idle connection (restart, upgrade, maintenance)', async () => {
    const pool = createPool('postgres://nobody@127.0.0.1:1/none');

    // pg emits 'error' on the pool when an idle client's connection dies;
    // with no listener, Node turns that into a crash of the whole server.
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();

    await pool.end();
  });
});
