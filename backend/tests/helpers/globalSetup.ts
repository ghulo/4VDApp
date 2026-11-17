import { buildTemplate } from './testDatabases.js';

/** Once per run, before any worker starts: migrate the template every test file copies. Rebuilt each run, so a new migration is always in it. */
export default async function setup(): Promise<void> {
  await buildTemplate();
}
