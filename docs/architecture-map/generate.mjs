// Builds architecture.json (and the data inside index.html) from the code itself.
// Run from the repo root:  node docs/architecture-map/generate.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCallGraph, closeBrace, reach as tablesReached } from './callgraph.mjs';
import { FLOWS } from './flows.mjs';
import { DECISIONS, KNOWN_LIMITS } from './decisions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// The git hooks run this silently: a crash leaves the old map and writes why here.
const ERROR_FILE = join(HERE, 'last-error.txt');
process.on('uncaughtException', (e) => {
  writeFileSync(ERROR_FILE, `${new Date().toISOString()}\n${e.stack ?? e}\n`);
  console.error(e);
  process.exit(1);
});
const ROOT = join(HERE, '..', '..');
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
const read = (p) => readFileSync(p, 'utf8');
const walk = (dir, test = () => true) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, test) : test(p) ? [p] : [];
  });
};
const isCode = (p) => /\.(ts|tsx|js|mjs)$/.test(p) && !/\.test\.|\.d\.ts$/.test(p);
const uniq = (a) => [...new Set(a)];

/** First sentence of the first doc comment in a file (or above `marker`). */
function docOf(src, marker) {
  let s = src;
  if (marker) {
    const i = src.indexOf(marker);
    if (i > 0) s = src.slice(Math.max(0, i - 1500), i);
    const all = [...s.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
    if (!all.length) return '';
    const last = all.at(-1);
    const between = s.slice(last.index + last[0].length) + src.slice(i, src.indexOf('\n', i));
    if (!/^\s*(export\s+)?(default\s+)?(abstract\s+)?(async\s+)?(class|function|const)\b[^\n]*$/.test(between)) return '';
    s = last[0];
  }
  const m = s.match(/\/\*\*([\s\S]*?)\*\//) ?? s.match(/^((?:\s*\/\/.*\n)+)/);
  if (!m) return '';
  const text = m[1].replace(/^\s*(\*|\/\/)\s?/gm, ' ').replace(/\s+/g, ' ').trim();
  return (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim().slice(0, 240);
}

/** The file's own header comment (before its first export), if any. */
function topDoc(src) {
  const c = src.indexOf('/**');
  const e = src.search(/^(export |interface |type |const |let |function |class |async )/m);
  return c >= 0 && (e < 0 || c < e) ? docOf(src.slice(c)) : '';
}

/** Text between a `(` at index `open` and its matching `)`. */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return '';
}

const TABLE_RE = /\b(?:selectFrom|insertInto|updateTable|deleteFrom|innerJoin|leftJoin|rightJoin|mergeInto|with)\(\s*'([a-z_][a-z0-9_]*)/g;
const tablesIn = (src) => uniq([...src.matchAll(TABLE_RE)].map((m) => m[1]));

// ---------- backend ----------
const B = join(ROOT, 'backend', 'src');
const containerSrc = read(join(B, 'container.ts'));

// imports: class name -> file
const importFile = {};
for (const m of containerSrc.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
  for (const n of m[1].split(',').map((x) => x.replace(/\btype\b/, '').trim().split(/\s+as\s+/).pop()).filter(Boolean)) {
    importFile[n] = 'backend/src/' + m[2].replace(/^\.\//, '').replace(/\.js$/, '.ts');
  }
}

// instances: `const x = new X(args)`
const instances = [];
for (const m of containerSrc.matchAll(/const\s+(\w+)\s*=\s*new\s+(\w+)\(/g)) {
  const args = balanced(containerSrc, m.index + m[0].length - 1);
  instances.push({ id: m[1], cls: m[2], args });
}
// `new XRepository(db)` written inline inside another constructor call
const camel = (c) => c[0].toLowerCase() + c.slice(1);
for (const inst of [...instances]) {
  for (const n of inst.args.matchAll(/new\s+(\w+)\(/g)) {
    const id = camel(n[1]);
    if (!importFile[n[1]]) continue;
    if (!instances.some((x) => x.id === id)) instances.push({ id, cls: n[1], args: balanced(inst.args, n.index + n[0].length - 1) });
    inst.args += ' ' + id;
  }
}
const instanceIds = new Set(instances.map((i) => i.id));
const kindOf = (cls) => (/Repository$|TransactionManager/.test(cls) ? 'repository' : /Service$|Poster$|Alert$|Builder$/.test(cls) ? 'service' : 'helper');

const services = [];
const repositories = [];
for (const inst of instances) {
  const deps = uniq([...inst.args.matchAll(/\b([a-zA-Z_]\w*)\b/g)].map((x) => x[1]).filter((n) => instanceIds.has(n) && n !== inst.id));
  const file = importFile[inst.cls] ?? null;
  const full = file && existsSync(join(ROOT, file)) ? join(ROOT, file) : null;
  const src = full ? read(full) : '';
  const node = {
    id: inst.id,
    class: inst.cls,
    kind: kindOf(inst.cls),
    file,
    doc: src ? docOf(src, `class ${inst.cls}`) || topDoc(src) : '',
    usesDb: /\bdb\b/.test(inst.args),
    deps,
    tables: src ? tablesIn(src) : [],
    lines: src ? src.split('\n').length : 0,
  };
  (node.kind === 'repository' ? repositories : services).push(node);
}

// service sub-folders (helpers not built by the container)
const serviceFolders = readdirSync(join(B, 'services'))
  .filter((d) => statSync(join(B, 'services', d)).isDirectory())
  .map((d) => {
    const files = walk(join(B, 'services', d), isCode);
    return {
      folder: `backend/src/services/${d}`,
      files: files.map((f) => ({ file: rel(f), doc: topDoc(read(f)), tables: tablesIn(read(f)) })),
    };
  });

// routes: mount -> factory -> file -> endpoints
const routesIndex = read(join(B, 'routes', 'index.ts'));
const factoryFile = {};
for (const m of routesIndex.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/(\w+)\.js'/g)) {
  for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) factoryFile[n] = `backend/src/routes/${m[2]}.ts`;
}
const appSrc = read(join(B, 'app.ts'));
const mounts = [];
const addMount = (prefix, factory) => {
  const file = factoryFile[factory] ?? (/createPortalRoutes/.test(factory) ? 'backend/src/routes/portalRoutes.ts' : /createHealthRoutes/.test(factory) ? 'backend/src/routes/healthRoutes.ts' : null);
  if (!file) return;
  const src = read(join(ROOT, file));
  // the factory body
  const start = src.search(new RegExp(`function\\s+${factory}\\s*\\(`));
  const body = start >= 0 ? src.slice(start, (src.indexOf('\nexport function', start + 10) + 1 || src.length + 1) - 1) : src;
  const destructured = body.match(/\(\s*\{([^}]*)\}\s*:\s*Container/);
  const uses = destructured ? destructured[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter((n) => n && n !== 'guards') : [];
  const endpoints = [];
  const guardsIn = (s) => uniq([...s.matchAll(/guards\.(\w+)|requireRole\(([^)]*)\)|requirePower\(\s*'([^']+)'|\b(requireAuth|systemRoute|requirePortal\w*|internalOnly\w*)\b/g)].map((g) => g[1] ?? g[4] ?? (g[2] ? `role(${g[2].replace(/['\s]/g, '')})` : `power:${g[3]}`)));
  const ctlVars = Object.fromEntries([...body.matchAll(/const\s+(\w+)\s*=\s*(create\w+Controller)\(/g)].map((m) => [m[1], m[2]]));
  // router-level guards (router.use(...)) apply to every route written after them
  const useGuards = [...body.matchAll(/\b(?:router|routes|r)\.use\(([^;]*)\);/g)].map((u) => ({ at: u.index, guards: guardsIn(u[1]) })).filter((u) => u.guards.length);
  for (const e of body.matchAll(/\b(?:router|routes|r)\.(get|post|put|patch|delete)\(\s*['`]([^'`]*)['`]/g)) {
    const paren = e.index + e[0].indexOf('(');
    const stmt = body.slice(paren, closeBrace(body, paren, '(', ')'));
    const before = useGuards.filter((u) => u.at < e.index).flatMap((u) => u.guards);
    const guards = uniq([...before, ...guardsIn(stmt)]);
    const refs = [...stmt.matchAll(/\b(\w+)\.(\w+)\b(?!\s*\()/g)].filter((m) => ctlVars[m[1]]);
    const handlerRef = refs.length ? `${ctlVars[refs.at(-1)[1]]}.${refs.at(-1)[2]}` : null;
    const inline = handlerRef ? null : stmt;
    endpoints.push({ method: e[1].toUpperCase(), path: (prefix + (e[2] === '/' ? '' : e[2])) || '/', guards, handler: handlerRef ? handlerRef.split('.')[1] : inline && /=>/.test(stmt) ? '(inline)' : null, handlerRef, inline });
  }
  const controllers = uniq([...src.matchAll(/from\s*'\.\.\/controllers\/(\w+)\.js'/g)].map((m) => `backend/src/controllers/${m[1]}.ts`));
  mounts.push({ prefix, factory, file, doc: docOf(src, `function ${factory}`), services: uses, controllers, endpoints });
};
for (const m of routesIndex.matchAll(/router\.use\(\s*'([^']+)'\s*,\s*(\w+)\(/g)) addMount('/api' + m[1], m[2]);
for (const m of appSrc.matchAll(/app\.use\(\s*'([^']+)'[^\n]*?(create\w+Routes)\(/g)) addMount(m[1], m[2]);

const middlewareChain = [
  { name: 'helmet', what: 'security headers' },
  { name: 'cors', what: 'only CORS_ORIGINS (4vd.app), with cookies' },
  { name: 'compression', what: 'gzip answers' },
  { name: 'bigBody', what: 'larger JSON limits only for uploads (bill scans 40 MB, imports 42 MB, statements 15 MB…)' },
  { name: 'express.json', what: '1 MB default body' },
  { name: 'requestContext', what: 'request id, logging, Sentry scope' },
  { name: 'refuseForeignOrigins', what: 'changes from another origin refused (CSRF)' },
  { name: 'identify', what: 'reads vd_access cookie or Bearer token' },
  { name: 'loadPermissions', what: 'the business’s powers grid for this role' },
  { name: 'rateLimiter', what: 'per-IP / per-user limits' },
  { name: 'requireAuth → enterBusiness', what: 'sets the business in AsyncLocalStorage; businessGuard sets app.business_id on the pooled connection (row security)' },
  { name: 'guards.* / requireRole / requirePower', what: 'per route' },
  { name: 'controller', what: 'zod-validates, calls one service, sendSuccess' },
  { name: 'service → repository → Kysely → Postgres', what: 'rules, then SQL' },
  { name: 'errorHandler', what: 'AppError → {success:false,…}; others → 500 + Sentry + alert email' },
];

// migrations
const migrations = readdirSync(join(B, 'database', 'migrations'))
  .filter((f) => /^\d{3}_.*\.ts$/.test(f))
  .sort()
  .map((f) => {
    const src = read(join(B, 'database', 'migrations', f));
    return { n: Number(f.slice(0, 3)), name: f.slice(4, -3), file: `backend/src/database/migrations/${f}`, doc: topDoc(src), creates: uniq([...src.matchAll(/createTable\(\s*'([a-z_0-9]+)'|CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)/g)].map((m) => m[1] ?? m[2])), alters: uniq([...src.matchAll(/alterTable\(\s*'([a-z_0-9]+)'|ALTER TABLE (?:IF EXISTS )?(?:ONLY )?([a-z_0-9]+)/g)].map((m) => m[1] ?? m[2])) };
  });

// tables: from migrations (createTable) + every query
const tableMap = {};
const touch = (t, by) => ((tableMap[t] ??= { name: t, createdIn: null, usedBy: [] }).usedBy.push(by));
for (const m of migrations) for (const t of m.creates) (tableMap[t] ??= { name: t, createdIn: null, usedBy: [] }).createdIn ??= m.n;
for (const n of [...repositories, ...services]) for (const t of n.tables) touch(t, n.id);
for (const f of serviceFolders) for (const x of f.files) for (const t of x.tables) touch(t, x.file);
const globalSrc = read(join(B, 'database', 'globalTables.ts'));
const globalTables = uniq([...globalSrc.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1])).filter((t) => tableMap[t]);
const tables = Object.values(tableMap)
  .filter((t) => t.createdIn !== null || t.usedBy.length > 0)
  .filter((t) => !/^(kysely_|pg_|information_schema)/.test(t))
  .map((t) => ({ ...t, usedBy: uniq(t.usedBy), global: globalTables.includes(t.name) }))
  .sort((a, b) => a.name.localeCompare(b.name));

// background jobs
const timersSrc = read(join(B, 'timers.ts'));
const jobs = [...timersSrc.matchAll(/export async function (\w+)/g)].map((m) => ({ name: m[1], doc: docOf(timersSrc, `export async function ${m[1]}`), calls: uniq([...timersSrc.slice(m.index, timersSrc.indexOf('\nexport', m.index + 5) >>> 0).matchAll(/container\.(\w+)/g)].map((x) => x[1])) }));

// scripts
const pkgBackend = JSON.parse(read(join(ROOT, 'backend', 'package.json')));

// ---------- database triggers (only in up(): down() drops them again) ----------
const triggers = [];
{
  const fnWrites = {};
  const ups = migrations.map((m) => {
    const src = read(join(ROOT, m.file));
    const a = src.indexOf('function up'), b = src.indexOf('function down');
    return { m, src: src.slice(a < 0 ? 0 : a, b > a ? b : src.length), whole: src };
  });
  for (const { src } of ups) for (const f of src.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (\w+)\([\s\S]*?\$\$([\s\S]*?)\$\$/g)) {
    fnWrites[f[1]] = uniq([...f[2].matchAll(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)/g)].map((x) => x[1]));
  }
  for (const { m, src, whole } of ups) {
    for (const t of src.matchAll(/CREATE (?:OR REPLACE )?TRIGGER\s+([^\s]+)[\s\S]*?\bON\s+(\$\{sql\.table\((\w+)\)\}|[a-z_][a-z0-9_]*)[\s\S]*?EXECUTE (?:FUNCTION|PROCEDURE)\s+(?:\w+\.)?(\w+)/g)) {
      let on = [t[2]];
      if (t[3]) { // inside `for (const <t[3]> of LIST)` or `of ['a', 'b']`
        const loop = src.slice(0, t.index).match(new RegExp(`for \\(const ${t[3]} of (\\w+|\\[[^\\]]*\\])\\)[^]*$`));
        const list = !loop ? null : loop[1].startsWith('[') ? [null, loop[1]] : whole.match(new RegExp(`const ${loop[1]}\\s*=\\s*\\[([^\\]]*)\\]`));
        on = list ? [...list[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]) : [];
      }
      for (const table of on) triggers.push({ table, name: t[1].includes('$') ? `${table}_ledger` : t[1], fn: t[4], writes: fnWrites[t[4]] ?? [], migration: m.n });
    }
    // a later up() that drops a trigger by name removes it (migrations run in order)
    for (const d of src.matchAll(/DROP TRIGGER (?:IF EXISTS )?([a-z_0-9]+) ON ([a-z_0-9]+)/g)) {
      for (let i = triggers.length - 1; i >= 0; i--) if (triggers[i].name === d[1] && triggers[i].table === d[2]) triggers.splice(i, 1);
    }
  }
}
/** Add what database triggers write when `set` is written (to a fixed point). */
const withTriggers = (set) => {
  let grew = true;
  while (grew) { grew = false; for (const t of triggers) if (set.has(t.table)) for (const w of t.writes) if (!set.has(w)) { set.add(w); grew = true; } }
  return set;
};

// ---------- method-level call graph ----------
const instanceClass = Object.fromEntries(instances.map((i) => [i.id, i.cls]));
const graph = buildCallGraph(ROOT, { knownTables: new Set(tables.map((t) => t.name)), mounts, instanceClass });
const M = graph.methods;
for (const m of mounts) for (const ep of m.endpoints) {
  ep.calls = graph.endpointCalls[`${ep.method} ${ep.path}`] ?? [];
  const t = { reads: new Set(), writes: new Set() };
  ep.calls.forEach((c) => { const r = tablesReached(M, c); r.reads.forEach((x) => t.reads.add(x)); r.writes.forEach((x) => t.writes.add(x)); });
  withTriggers(t.writes);
  ep.writes = [...t.writes].sort();
  ep.reads = [...t.reads].filter((x) => !t.writes.has(x)).sort();
  delete ep.handlerRef; delete ep.inline;
}
// services / repositories: tables through their own methods (transactions included)
for (const n of [...services, ...repositories]) {
  const own = Object.keys(M).filter((id) => id.startsWith(n.class + '.'));
  const r = { reads: new Set(), writes: new Set() };
  own.forEach((id) => { const x = tablesReached(M, id); x.reads.forEach((t) => r.reads.add(t)); x.writes.forEach((t) => r.writes.add(t)); });
  n.methods = own.map((id) => id.slice(n.class.length + 1));
  withTriggers(r.writes);
  n.writes = [...r.writes].sort();
  n.reads = [...r.reads].filter((t) => !r.writes.has(t)).sort();
  n.tables = uniq([...n.tables, ...n.writes, ...n.reads]);
}
// timers: container.x.method( -> Class.method
for (const j of jobs) {
  const start = timersSrc.indexOf(`function ${j.name}`);
  const body = timersSrc.slice(start, closeBrace(timersSrc, timersSrc.indexOf('{', timersSrc.indexOf(')', start))));
  // container.a.b(...) or container.a.field.b(...), possibly over several lines
  j.entry = uniq([...body.matchAll(/container\.(\w+)((?:\s*\.\s*\w+)+)\s*\(/g)].map((m) => {
    let type = instanceClass[m[1]];
    const chain = m[2].split('.').map((x) => x.trim()).filter(Boolean);
    const method = chain.pop();
    for (const field of chain) type = type && graph.classes[type]?.fields[field];
    return type && M[`${type}.${method}`] ? `${type}.${method}` : null;
  }).filter(Boolean));
}
// tables: who writes and who reads, by class (method ids in the graph); a table written in one
// place and read by a timer job is a hand-off (queue) the call graph alone can't show.
const ownerOf = (id) => id.split(/[.#]/)[0];
for (const t of tables) {
  const w = Object.entries(M).filter(([, n]) => n.w?.includes(t.name)).map(([id]) => id);
  const r = Object.entries(M).filter(([, n]) => n.r?.includes(t.name)).map(([id]) => id);
  t.writers = w; t.readers = r;
  t.usedBy = uniq([...t.usedBy, ...w.map(ownerOf), ...r.map(ownerOf)]);
}
const jobReach = Object.fromEntries(jobs.map((j) => [j.name, j.entry.reduce((acc, e) => { const x = tablesReached(M, e); x.reads.forEach((t) => acc.add(t)); x.writes.forEach((t) => acc.add(t)); return acc; }, new Set())]));
for (const j of jobs) j.touches = [...jobReach[j.name]].sort();
// tables everybody reads: not a hand-off
const SHARED = new Set(['settings', 'users', 'people', 'memberships', 'businesses', 'activity_log', 'products', 'ledger_accounts']);
// A hand-off: a request writes rows that a timer job picks up later. The job's own entry method
// (or a call two deep) both reads and writes that table, i.e. it works through it like a queue.
const handoffs = [];
for (const j of jobs) for (const entry of j.entry) {
  // what the job looks at first (the entry and the methods it calls directly)
  const near = tablesReached(M, entry, 1);
  // it must read the table or mark its rows done (update/delete): an insert alone is not a pick-up
  for (const t of new Set([...near.reads, ...near.changes])) {
    if (SHARED.has(t)) continue;
    const writtenBy = mounts.flatMap((m) => m.endpoints.filter((ep) => ep.writes.includes(t)).map((ep) => `${ep.method} ${ep.path}`));
    if (writtenBy.length) handoffs.push({ table: t, job: j.name, consumer: entry, writtenBy: writtenBy.length, examples: writtenBy.slice(0, 8) });
  }
}

// curated flows: every ref must resolve, else it is listed in meta.missingRefs
const allEndpoints = new Set(mounts.flatMap((m) => m.endpoints.map((ep) => `${ep.method} ${ep.path}`)));
const missingRefs = [];
const checkRef = (ref, flow) => {
  if (!ref) return true;
  let ok;
  if (ref.startsWith('GET ') || ref.startsWith('POST ') || ref.startsWith('PUT ') || ref.startsWith('PATCH ') || ref.startsWith('DELETE ')) ok = allEndpoints.has(ref);
  else if (ref.startsWith('table:')) ok = tables.some((t) => t.name === ref.slice(6));
  else if (ref.startsWith('job:')) ok = jobs.some((j) => j.name === ref.slice(4));
  else if (ref.includes(':') && !ref.includes('#')) { // file:symbol
    const cut = ref.indexOf(':'), file = ref.slice(0, cut), sym = ref.slice(cut + 1);
    ok = existsSync(join(ROOT, file)) && (!sym || read(join(ROOT, file)).includes(sym));
  } else ok = !!M[ref];
  if (!ok) missingRefs.push({ flow, ref });
  return ok;
};
const flows = FLOWS.map((f) => ({ ...f, steps: f.steps.map((s) => ({ ...s, ok: checkRef(s.ref, f.id) })) }));
const decisions = DECISIONS.map((d) => ({ ...d, where: d.where.map((ref) => ({ ref, ok: checkRef(ref, 'decision:' + d.id) })) }));

// blind spots the generator can measure
const stopsByType = {};
for (const [id, n] of Object.entries(M)) for (const s of n.s ?? []) { const type = s.split('.')[0]; (stopsByType[type] ??= { type, calls: new Set(), from: new Set() }); stopsByType[type].calls.add(s); stopsByType[type].from.add(id); }
const measured = {
  interfaceStops: Object.values(stopsByType).map((x) => ({ type: x.type, calls: [...x.calls].sort(), from: [...x.from].sort().slice(0, 12), fromCount: x.from.size })).sort((a, b) => b.fromCount - a.fromCount),
  dynamicTables: Object.entries(M).filter(([, n]) => n.x).map(([id, n]) => ({ method: id, names: n.x })),
  untracedEndpoints: mounts.flatMap((m) => m.endpoints.filter((ep) => !ep.calls.length).map((ep) => ({ endpoint: `${ep.method} ${ep.path}`, file: m.file }))),
};
const blindSpots = { known: KNOWN_LIMITS, measured };

// ---------- dashboard ----------
const A = join(ROOT, 'admin', 'src');
const appTsx = read(join(A, 'App.tsx'));
const componentFile = {};
for (const m of appTsx.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) for (const n of m[1].split(',').map((s) => s.trim())) componentFile[n] = `admin/src/${m[2]}.tsx`;
for (const m of appTsx.matchAll(/const\s+(\w+)\s*=\s*lazy\w*\(\s*\(\)\s*=>\s*import\('\.\/([^']+)'\)(?:\s*,\s*'(\w+)')?/g)) componentFile[m[1]] = `admin/src/${m[2]}.tsx`;

// parse <Route> nesting
const routes = [];
{
  const stack = [];
  let i = 0;
  while ((i = appTsx.indexOf('<', i)) >= 0) {
    if (appTsx.startsWith('</Route>', i)) { stack.pop(); i += 8; continue; }
    if (!appTsx.startsWith('<Route', i) || /\w/.test(appTsx[i + 6])) { i++; continue; }
    let j = i + 6, depth = 0;
    for (; j < appTsx.length; j++) {
      const c = appTsx[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (depth === 0 && c === '>') break;
    }
    const tag = appTsx.slice(i, j + 1);
    const selfClosing = tag.endsWith('/>');
    const path = tag.match(/\bpath="([^"]*)"/)?.[1] ?? null;
    const index = /\bindex\b/.test(tag.split('element=')[0]);
    let element = tag.match(/element=\{\s*<(\w+)/)?.[1] ?? null;
    let fileHint = null;
    if (element === 'ByLayout') {
      const st = tag.match(/staff=\{<(\w+)/)?.[1];
      const fu = tag.match(/full=\{<(\w+)/)?.[1];
      element = `${fu} · staff: ${st}`;
      fileHint = componentFile[fu] ?? componentFile[st] ?? null;
    } else if (element && element !== 'Navigate' && !componentFile[element] && new RegExp(`(function|const) ${element}\\b`).test(appTsx)) fileHint = 'admin/src/App.tsx';
    const parent = [...stack].reverse().find((s) => s.path !== null)?.full ?? '';
    const full = path === null ? parent : path.startsWith('/') ? path : `${parent.replace(/\/$/, '')}/${path}`;
    const wrappers = stack.map((s) => s.element).filter(Boolean);
    if (element && (path !== null || index)) {
      const layout = wrappers.find((w) => /Layout|Shell|RequireAuth|Guard|Only/.test(w)) ?? null;
      routes.push({ path: full || '/', element, file: fileHint ?? componentFile[element] ?? null, index, wrappers, layout, redirect: element === 'Navigate' ? tag.match(/to="([^"]+)"/)?.[1] : undefined });
    }
    if (!selfClosing) stack.push({ path, full, element });
    i = j + 1;
  }
}

// api objects -> backend prefixes
const apiClients = [];
for (const f of walk(join(A, 'services'), isCode)) {
  const src = read(f);
  const blocks = [...src.matchAll(/export const (\w+)\s*=\s*\{/g)];
  blocks.forEach((b, k) => {
    const body = src.slice(b.index, blocks[k + 1]?.index ?? src.length);
    const paths = uniq([...body.matchAll(/(?:apiRequest|apiDownload|apiUpload|portalRequest|request|fetch\w*)\w*(?:<[^()]*?>)?\(\s*[`'](\/[a-z0-9-]+(?:\/[a-z-]+)?)/g)].map((m) => m[1]));
    if (paths.length) apiClients.push({ name: b[1], file: rel(f), paths, prefixes: uniq(paths.map((p) => '/api' + p.match(/^\/[a-z0-9-]+/)[0])) });
  });
}
const apiByName = Object.fromEntries(apiClients.map((c) => [c.name, c]));

// every page/component -> which api objects it imports
const uiFiles = walk(A, (p) => isCode(p) && !p.includes(`${join(A, 'services')}`));
const uiUses = {};
for (const f of uiFiles) {
  const src = read(f);
  const names = uniq([...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'[^']*services\/[^']+'/g)].flatMap((m) => m[1].split(',').map((s) => s.replace(/\btype\b/, '').trim())).filter((n) => apiByName[n]));
  const comps = uniq([...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\.?\/[^']*(?:components|pages)\/[^']+|\.\/[^']+)'/g)].map((m) => m[2]));
  uiUses[rel(f)] = { apis: names, imports: comps.map((c) => rel(join(dirname(f), c)).replace(/(\.tsx?)?$/, '')) };
}
const resolveUi = (stem) => [stem + '.tsx', stem + '.ts', stem + '/index.tsx', stem + '/index.ts'].find((c) => uiUses[c]);
// a page's API reach = its own + its components' (2 levels)
function reach(file, depth = 0, seen = new Set()) {
  if (!file || seen.has(file) || depth > 2) return [];
  seen.add(file);
  const u = uiUses[file];
  if (!u) return [];
  return uniq([...u.apis, ...u.imports.flatMap((s) => reach(resolveUi(s), depth + 1, seen))]);
}
const pageFiles = uniq(routes.map((r) => r.file).filter(Boolean));
const pages = pageFiles.map((file) => {
  const apis = reach(file);
  return { file, apis, endpoints: uniq(apis.flatMap((n) => apiByName[n]?.prefixes ?? [])).sort(), lines: existsSync(join(ROOT, file)) ? read(join(ROOT, file)).split('\n').length : 0 };
});
const navSrc = read(join(A, 'navigation', 'sections.ts'));
const menu = [...navSrc.matchAll(/\{\s*to:\s*'([^']+)',\s*key:\s*'(\w+)'(?:,\s*icon:\s*(\w+))?/g)].map((m) => ({ to: m[1], key: m[2], icon: m[3] ?? null }));
const uiKit = walk(join(A, 'components', 'ui'), isCode).map((f) => basename(f).replace(/\.tsx?$/, ''));
const adminFolders = readdirSync(A).filter((d) => statSync(join(A, d)).isDirectory() && d !== 'node_modules').map((d) => ({ folder: `admin/src/${d}`, files: walk(join(A, d), isCode).length }));

// ---------- desktop, mail, e2e, CI ----------
const filesWithDoc = (dir) => walk(dir, isCode).map((f) => ({ file: rel(f), doc: topDoc(read(f)), lines: read(f).split('\n').length }));
const desktop = { package: JSON.parse(read(join(ROOT, 'desktop', 'package.json'))).version, files: filesWithDoc(join(ROOT, 'desktop', 'src')) };
const mail = { files: filesWithDoc(join(ROOT, 'mail', 'src')) };
const e2e = walk(join(ROOT, 'e2e'), (p) => /\.spec\.ts$/.test(p)).map(rel);
const workflows = walk(join(ROOT, '.github', 'workflows'), (p) => /\.ya?ml$/.test(p)).map((f) => {
  const src = read(f).replace(/\r/g, '');
  const parts = src.slice(src.indexOf('\njobs:') + 6).split(/\n  (?=[a-z0-9-]+:\s*\n)/).slice(1);
  const jobs = parts.map((p) => {
    const id = p.match(/^([a-z0-9-]+):/)[1];
    const name = (p.match(/\n    name:\s*([^\n]+)/)?.[1] ?? id).trim().replace(/^['"]|['"]$/g, '');
    const inline = p.match(/\n    needs:\s*\[([^\]]+)\]/)?.[1] ?? p.match(/\n    needs:\s*([a-z0-9-]+)\s*\n/)?.[1];
    const list = p.match(/\n    needs:\s*\n((?:\s+- [^\n]+\n)+)/)?.[1];
    const needs = (inline ? inline.split(',') : list ? list.split('\n').map((l) => l.replace(/^\s*-\s*/, '')) : []).map((x) => x.trim()).filter(Boolean);
    const ifc = p.match(/\n    if:\s*([^\n]+)/)?.[1].trim() ?? null;
    return { id, name, needs, if: ifc };
  });
  const onBlock = src.match(/^on:[^\n]*\n([\s\S]*?)\n(?=[a-z])/m)?.[1] ?? '';
  return { file: rel(f), name: src.match(/^name:\s*(.+)$/m)?.[1] ?? basename(f), on: [...onBlock.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]), cron: src.match(/cron:\s*'([^']+)'/)?.[1] ?? null, jobs };
});

// ---------- the system (hand-kept: hosting is not in the code) ----------
const system = {
  nodes: [
    { id: 'browser', label: 'Browser / phone', group: 'client', detail: 'Owners: full dashboard. Employees/family: StaffLayout (phone tabs). Business customers: /portal.' },
    { id: 'desktop', label: '4VD for Windows', group: 'client', detail: `Electron shell (desktop/, v${desktop.package}). Loads 4vd.app, starts offline from the service-worker saved copy, prints fiscal receipts through F-Link, keeps a print journal, updates from GitHub Releases.` },
    { id: 'printer', label: 'Datecs fiscal printer', group: 'device', detail: 'Driven by Enternet F-Link through files (.inp/.out) written by desktop/src/fiscal.js.' },
    { id: 'supplier', label: 'Supplier email', group: 'client', detail: 'Suppliers send bills to bills@4vd.app or bills+<short>@4vd.app.' },
    { id: 'cfdash', label: '4vd.app', group: 'edge', detail: 'Cloudflare Worker serving the static admin/ build (admin/wrangler.jsonc). Headers in admin/public/_headers (HSTS, CSP Report-Only). sw.js keeps a saved copy for offline starts. app.4vd.app redirects here.' },
    { id: 'mailworker', label: 'Email Worker', group: 'edge', detail: 'mail/ (Cloudflare Email Routing). Checks SPF/DKIM/DMARC, posts attachments to POST /api/internal/bill-email with BILL_EMAIL_TOKEN.' },
    { id: 'api', label: 'api.4vd.app', group: 'core', detail: `Render web service 4vd-api (Docker, Frankfurt, Starter). One Node process: Express 5 + Kysely + zod, ${mounts.length} route groups, ${mounts.reduce((s, m) => s + m.endpoints.length, 0)} endpoints, ${services.length} services, ${repositories.length} repositories. Timers: minuteJobs + pushJobs. Migrates on start.` },
    { id: 'db', label: 'Postgres 18', group: 'data', detail: `Render 4vd-db (basic-256mb). ${tables.length} tables, ${migrations.length} migrations. Row-level security per business (policy business_rows, migration 081); API connects as fourvd_app (no BYPASSRLS).` },
    { id: 'r2', label: 'Cloudflare R2', group: 'data', detail: 'Encrypted nightly backup (35 days + Sundays 90) from backup.yml; restore-check.yml restores it.' },
    { id: 'anthropic', label: 'Anthropic (Claude)', group: 'external', detail: 'services/ai/: bill reading, categorising, bank-statement PDFs, partner reader, Ask. Staff names masked first. Needs ANTHROPIC_API_KEY.' },
    { id: 'resend', label: 'Resend', group: 'external', detail: 'Email out (invites, resets, reports) via services/email; queued in the email outbox, sent by pushJobs.' },
    { id: 'webpush', label: 'Web Push', group: 'external', detail: 'VAPID push notifications (services/push).' },
    { id: 'google', label: 'Google sign-in', group: 'external', detail: 'GoogleAuthService verifies ID tokens.' },
    { id: 'sentry', label: 'Sentry', group: 'external', detail: 'Errors from API (4vd-api) and dashboard; CSP reports; uptime monitor on /health/db.' },
    { id: 'github', label: 'GitHub Actions', group: 'ops', detail: 'ci.yml (changed parts only, backend tests in 4 shards) → deploy-dashboard (wrangler) + deploy-api (Render deploy hook). backup.yml, restore-check.yml, uptime.yml. Releases host the Windows installer + latest.yml.' },
    { id: 'render', label: 'Render', group: 'ops', detail: 'Hosts 4vd-api and 4vd-db. Auto-deploy off; deploys come from the CI deploy hook.' },
  ],
  edges: [
    ['browser', 'cfdash', 'loads app'], ['desktop', 'cfdash', 'loads app'], ['browser', 'api', 'fetch + cookies'], ['desktop', 'api', 'fetch + cookies'],
    ['desktop', 'printer', 'F-Link files'], ['supplier', 'mailworker', 'email'], ['mailworker', 'api', 'POST /api/internal/bill-email'],
    ['api', 'db', 'Kysely / RLS'], ['api', 'anthropic', 'AI reads'], ['api', 'resend', 'email'], ['api', 'webpush', 'push'], ['api', 'google', 'token check'],
    ['api', 'sentry', 'errors'], ['browser', 'sentry', 'errors / CSP'], ['github', 'cfdash', 'deploy'], ['github', 'render', 'deploy hook'], ['render', 'api', 'runs'], ['render', 'db', 'hosts'],
    ['github', 'r2', 'backup'], ['github', 'db', 'pg_dump'], ['desktop', 'github', 'auto-update'],
  ].map(([from, to, label]) => ({ from, to, label })),
};

const tenancy = [
  'Every business table has business_id INT NOT NULL DEFAULT current_business_id(); exceptions in database/globalTables.ts.',
  'database/businessContext.ts keeps the current business in AsyncLocalStorage (enterBusiness, runAsBusiness, forEachBusiness, runAsSystem).',
  'database/businessGuard.ts sets app.business_id on every pooled connection when taken.',
  'Migration 081 forces row-level security (policy business_rows) on every business table; roleCheck.ts refuses a superuser/BYPASSRLS role in production.',
  'People (users) join businesses through memberships, each with its own role: main_admin, admin, owner, employee, family, accountant; developer = platform staff with recorded support visits.',
];

let commit = null;
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}

const data = {
  meta: {
    name: '4VD', generatedAt: new Date().toISOString(), commit, generator: 'docs/architecture-map/generate.mjs',
    sources: ['docs/ARCHITECTURE.md', 'backend/src/container.ts', 'backend/src/routes', 'backend/src/app.ts', 'backend/src/database/migrations', 'admin/src/App.tsx', 'admin/src/services', '.github/workflows', 'docs/architecture-map/flows.mjs'],
    missingRefs,
    coverage: { endpointsWithCalls: graph.stats.endpointsResolved, endpoints: graph.stats.endpointsTotal, methods: graph.stats.methods, calls: graph.stats.calls },
    howToQuery: "Don't read this file whole. Query it: node -e \"const d=require('./docs/architecture-map/architecture.json'); ...\" or grep for an endpoint, Class.method or table name.",
  },
  counts: {
    routeGroups: mounts.length,
    endpoints: mounts.reduce((s, m) => s + m.endpoints.length, 0),
    services: services.length,
    repositories: repositories.length,
    tables: tables.length,
    migrations: migrations.length,
    dashboardRoutes: routes.length,
    pages: pages.length,
    apiClients: apiClients.length,
  },
  system,
  tenancy,
  flows,
  // why it is built this way: basis 'stated' (written in `source`) or 'inferred' (a reading, not a fact)
  decisions,
  blindSpots: { ...blindSpots, measured: { ...blindSpots.measured, pagesWithoutApi: pages.filter((p) => !p.apis.length).map((p) => p.file) } },
  backend: { stack: 'Express 5 + TypeScript, Kysely, zod, Postgres 18', middlewareChain, mounts, services, repositories, serviceFolders, jobs, handoffs, scripts: pkgBackend.scripts },
  // Class.method or file#function -> { k: kind, f: file, l: line, d: doc, c: calls, r: tables read, w: tables written }
  methods: M,
  database: { tables, migrations, globalTables, triggers },
  dashboard: { stack: 'React + Vite + TanStack Query, plain CSS on tokens', routes, pages, apiClients, menu, uiKit, folders: adminFolders },
  desktop,
  mail,
  e2e,
  ci: { workflows },
};

// write to temp files, then rename, so a reader never sees half a file
// MAP_OUT_DIR: write somewhere else (the backend test that checks every edit writes its history entry uses a temp folder).
const OUT = process.env.MAP_OUT_DIR || HERE;
const put = (name, text) => { const tmp = join(OUT, `.${name}.${process.pid}.tmp`); writeFileSync(tmp, text); renameSync(tmp, join(OUT, name)); };
put('architecture.json', JSON.stringify(data, null, 1));
put('index.html', read(join(HERE, 'template.html')).replace('/*__DATA__*/null', JSON.stringify(data).replaceAll('</', '<\\/')));
rmSync(ERROR_FILE, { force: true });
console.log('wrote architecture.json + index.html', data.counts, data.meta.coverage, missingRefs.length ? { missingRefs } : '');
