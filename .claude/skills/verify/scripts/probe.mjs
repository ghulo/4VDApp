// Which database does port 3000 serve right now?
//   node .claude/skills/verify/scripts/probe.mjs                      -> prints one line, exit 0
//   node .claude/skills/verify/scripts/probe.mjs --expect demo --wait 90
// With --expect it polls until the state matches (or --wait seconds pass) and
// exits 1 on a mismatch. Use --expect down after preview_stop: the old server
// must really be gone before the other one starts.
import { probe, sleep } from './lib.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const expect = arg('--expect');
const waitMs = Number(arg('--wait') ?? (expect ? 60 : 0)) * 1000;
const label = { demo: 'four_vd_app_demo', real: 'four_vd_app', down: 'nothing (down)', unknown: 'unknown (up, demo login or list failed)', limited: 'unknown (API rate limit hit; wait 15 min or restart the API)' };
const started = Date.now();

let state = await probe();
while (expect && state !== expect && Date.now() - started < waitMs) {
  await sleep(1500);
  state = await probe();
}
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (expect && state !== expect) {
  console.log(`probe: FAIL port 3000 serves ${label[state]}, expected ${label[expect]} (waited ${secs}s)`);
  process.exit(1);
}
console.log(`probe: port 3000 serves ${label[state]}${expect ? ` (${secs}s)` : ''}`);
