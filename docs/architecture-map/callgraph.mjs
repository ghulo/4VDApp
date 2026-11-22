// Method-level call graph of the backend: controller handler -> service methods -> repository
// methods -> tables (read / write). Plain text parsing, no TypeScript compiler: good enough to
// follow 4VD's own style (constructor injection, `repos.<key>` inside transactions).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const uniq = (a) => [...new Set(a)];

/** Index of the char after the `}` that closes the `{` at `open`; skips strings and comments. */
export function closeBrace(src, open, openCh = '{', closeCh = '}') {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) return src.length; continue; }
    if (c === "'" || c === '"') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '`') { // template: skip text, recurse into ${ }
      for (i++; i < src.length && src[i] !== '`'; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '$' && src[i + 1] === '{') i = closeBrace(src, i + 1) - 1;
      }
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i + 1;
  }
  return src.length;
}

/** From the `(` of a parameter list, the index of the body's `{` (skipping a return type). */
function bodyStart(src, parenOpen) {
  let i = closeBrace(src, parenOpen, '(', ')');
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === ';' && depth === 0) return -1; // overload / abstract signature
    if (c === '=' && src[i + 1] === '>' ) { i++; continue; }
    if ('<([' .includes(c)) depth++;
    else if ('>)]'.includes(c)) depth--;
    else if (c === '{') {
      if (depth > 0) { i = closeBrace(src, i) - 1; continue; }
      const prev = src.slice(0, i).trimEnd();
      const p = prev.at(-1);
      if (':|&,(<'.includes(p) || prev.endsWith('=>')) { i = closeBrace(src, i) - 1; continue; }
      return i;
    }
  }
  return -1;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

function docAbove(src, idx) {
  const before = src.slice(Math.max(0, idx - 1200), idx);
  const m = before.match(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*(?:@\w+[^\n]*\s*)*$/);
  if (!m) return '';
  const t = m[1].replace(/^\s*\*\s?/gm, ' ').replace(/\s+/g, ' ').trim();
  return (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim().slice(0, 220);
}

const CHANGE_RE = /\b(?:updateTable|deleteFrom)\(\s*'([a-z_][a-z0-9_]*)|\b(?:UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)/g;
const WRITE_RE = /\b(?:insertInto|updateTable|deleteFrom|mergeInto|replaceInto)\(\s*'([a-z_][a-z0-9_]*)|\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)/g;
const READ_RE = /\b(?:selectFrom|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*'([a-z_][a-z0-9_]*)|\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/g;

/**
 * Build the graph. `root` = repo root. `instances` = container ids -> class (for inline arrow
 * handlers in route files). Returns { nodes, endpointsCalls, stats }.
 */
export function buildCallGraph(root, { knownTables, mounts, instanceClass }) {
  const B = join(root, 'backend', 'src');
  const rel = (p) => relative(root, p).replaceAll('\\', '/');
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'migrations' ? [] : walk(p);
    return /\.ts$/.test(n) && !/\.test\.ts$|\.d\.ts$/.test(n) ? [p] : [];
  });
  const files = walk(B);
  const srcOf = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));

  // TransactionalRepositories: key -> class
  const tmSrc = srcOf[join(B, 'repositories', 'TransactionManager.ts')] ?? '';
  const repoKeys = Object.fromEntries([...tmSrc.matchAll(/^\s+(\w+):\s*new\s+(\w+)\(/gm)].map((m) => [m[1], m[2]]));

  const nodes = {}; // id -> { id, kind, file, line, doc, calls:Set, reads:Set, writes:Set }
  const classes = {}; // class -> { file, fields: {name: Type}, methods: {name: id} }
  const funcs = {}; // file -> { name: id }
  const pending = []; // [id, body, ctx]

  const addNode = (id, kind, file, line, doc) => (nodes[id] ??= { id, kind, file, line, doc, calls: new Set(), reads: new Set(), writes: new Set() });
  const kindOfFile = (f) => (f.includes('/repositories/') ? 'repository' : f.includes('/controllers/') ? 'controller' : f.includes('/services/') ? 'service' : f.includes('/database/') ? 'database' : 'util');

  // 1. index classes and module functions
  for (const f of files) {
    const src = srcOf[f], file = rel(f), kind = kindOfFile(file);
    for (const cm of src.matchAll(/(?:^|\n)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)[^{\n]*\{/g)) {
      const open = cm.index + cm[0].length - 1, end = closeBrace(src, open), body = src.slice(open, end);
      const cls = { file, fields: {}, methods: {} };
      classes[cm[1]] = cls;
      for (const p of body.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\??\s*:\s*([A-Z]\w*)/g)) cls.fields[p[1]] = p[2];
      for (const p of body.matchAll(/^\s{2}(?:(?:private|public|protected|readonly)\s+)*(\w+)\s*=\s*new\s+([A-Z]\w*)\(/gm)) cls.fields[p[1]] = p[2];
      for (const p of body.matchAll(/^\s{2}(?:(?:private|public|protected|readonly)\s+)*(\w+)\s*[!?]?:\s*([A-Z]\w*)\s*;/gm)) cls.fields[p[1]] ??= p[2];
      for (const p of body.matchAll(/\bthis\.(\w+)\s*=\s*new\s+([A-Z]\w*)\(/g)) cls.fields[p[1]] ??= p[2];
      // methods at depth 1
      for (const mm of body.matchAll(/^\s{2}(?:(?:public|private|protected|static|async|override|get|set)\s+)*(\w+)\s*(?:<[^>()]*>)?\(/gm)) {
        const name = mm[1];
        if (['if', 'for', 'while', 'switch', 'return', 'constructor', 'catch', 'function'].includes(name)) continue;
        const paren = open + mm.index + mm[0].length - 1;
        const b = bodyStart(src, paren);
        if (b < 0) continue;
        const bEnd = closeBrace(src, b);
        const id = `${cm[1]}.${name}`;
        if (nodes[id]) continue;
        addNode(id, kind, file, lineOf(src, open + mm.index + 1), docAbove(src, open + mm.index));
        cls.methods[name] = id;
        pending.push([id, src.slice(b, bEnd), { cls: cm[1], file: f }]);
      }
    }
    // exported / top-level functions (not controllers: handled below)
    if (kind !== 'controller') {
      for (const fm of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>()]*>)?\(/gm)) {
        const b = bodyStart(src, fm.index + fm[0].length - 1);
        if (b < 0) continue;
        const id = `${file.replace('backend/src/', '')}#${fm[1]}`;
        addNode(id, kind === 'service' || kind === 'database' ? kind : 'function', file, lineOf(src, fm.index + 1), docAbove(src, fm.index));
        (funcs[f] ??= {})[fm[1]] = id;
        pending.push([id, src.slice(b, closeBrace(src, b)), { cls: null, file: f }]);
      }
      for (const fm of src.matchAll(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)[^=]*=>\s*\{/gm)) {
        const b = fm.index + fm[0].length - 1;
        const id = `${file.replace('backend/src/', '')}#${fm[1]}`;
        addNode(id, 'function', file, lineOf(src, fm.index + 1), docAbove(src, fm.index));
        (funcs[f] ??= {})[fm[1]] = id;
        pending.push([id, src.slice(b, closeBrace(src, b)), { cls: null, file: f }]);
      }
    }
  }

  // 2. controllers: factory(params: Type) { return { handler() {} } }
  const controllers = {}; // factory -> { handlers: {name: id} }
  for (const f of files.filter((x) => x.includes(`${join('src', 'controllers')}`))) {
    const src = srcOf[f], file = rel(f);
    for (const fm of src.matchAll(/export\s+function\s+(create\w+Controller)\s*\(/g)) {
      const paren = fm.index + fm[0].length - 1;
      const params = src.slice(paren + 1, closeBrace(src, paren, '(', ')') - 1);
      const types = Object.fromEntries([...params.matchAll(/(\w+)\??\s*:\s*([A-Z]\w*)/g)].map((m) => [m[1], m[2]]));
      const b = bodyStart(src, paren);
      if (b < 0) continue;
      const body = src.slice(b, closeBrace(src, b));
      const ctl = { handlers: {}, types };
      controllers[fm[1]] = ctl;
      for (const hm of body.matchAll(/^\s{4}(?:async\s+)?(\w+)\s*(?:<[^>()]*>)?\(/gm)) {
        const hb = bodyStart(body, hm.index + hm[0].length - 1);
        if (hb < 0) continue;
        const id = `${fm[1].replace(/^create/, '')}.${hm[1]}`;
        if (nodes[id]) continue;
        addNode(id, 'controller', file, lineOf(src, b + hm.index + 1), '');
        ctl.handlers[hm[1]] = id;
        pending.push([id, body.slice(hb, closeBrace(body, hb)), { cls: null, file: f, vars: types }]);
      }
    }
  }

  // imports per file: local name -> [file, exported name]
  const importsOf = (f) => {
    const src = srcOf[f], out = {};
    for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
      const target = resolve(dirname(f), m[2].replace(/\.js$/, '.ts'));
      for (const part of m[1].split(',')) {
        const [orig, alias] = part.replace(/\btype\b/, '').trim().split(/\s+as\s+/);
        if (orig) out[(alias ?? orig).trim()] = [target, orig.trim()];
      }
    }
    return out;
  };
  const importCache = {};

  // 3. resolve calls inside each body
  const resolveMember = (type, method) => classes[type]?.methods[method] ?? null;
  for (const [id, body, ctx] of pending) {
    const n = nodes[id];
    const cls = ctx.cls ? classes[ctx.cls] : null;
    const imports = (importCache[ctx.file] ??= importsOf(ctx.file));
    const add = (target) => { if (target && target !== id) n.calls.add(target); };
    // this.field.method(  /  this.repos.key.method(
    for (const m of body.matchAll(/\bthis\.(\w+)\.(\w+)\s*(?:<[^>()]*>)?\(/g)) {
      const type = cls?.fields[m[1]];
      const hit = type && resolveMember(type, m[2]);
      if (hit) add(hit);
      // a field typed by an interface (or a type we don't index): the call stops here
      else if (type && !classes[type] && m[1] !== 'repos' && !/^(Map|Set|Array|Promise|Date|Record|WeakMap|Pick|Omit|Partial|DatabaseClient|Kysely|Transaction)$/.test(type)) {
        (n.stops ??= new Set()).add(`${type}.${m[2]}`);
      }
    }
    // tables named by a variable: not counted
    for (const m of body.matchAll(/\b(?:selectFrom|insertInto|updateTable|deleteFrom)\(\s*(?!['"`\s])([\w.]+)/g)) (n.dynamic ??= new Set()).add(m[1]);
    for (const m of body.matchAll(/\b(?:this\.)?repos\.(\w+)\.(\w+)\s*\(/g)) if (repoKeys[m[1]]) add(resolveMember(repoKeys[m[1]], m[2]));
    // this.method(
    for (const m of body.matchAll(/\bthis\.(\w+)\s*\(/g)) if (cls?.methods[m[1]]) add(cls.methods[m[1]]);
    // `new XRepository(trx).method(` and `const r = new XRepository(trx); r.method(`
    for (const m of body.matchAll(/\bnew\s+([A-Z]\w*)\([^()]*\)\s*\.(\w+)\s*\(/g)) add(resolveMember(m[1], m[2]));
    const vars = { ...(ctx.vars ?? {}) };
    for (const m of body.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*new\s+([A-Z]\w*)\(/g)) if (classes[m[2]]) vars[m[1]] = m[2];
    // typed params / locals: param.method(
    for (const [v, type] of Object.entries(vars)) for (const m of body.matchAll(new RegExp(`(?<![.\\w])${v}\\.(\\w+)\\s*\\(`, 'g'))) add(resolveMember(type, m[1]));
    // `new Class(...)` used inline, then .method on it is rare: skip. Imported module functions:
    for (const m of body.matchAll(/(?<![.\w])(\w+)\s*(?:<[^>()]*>)?\(/g)) {
      const imp = imports[m[1]];
      if (imp) add(funcs[imp[0]]?.[imp[1]]);
      else if (funcs[ctx.file]?.[m[1]]) add(funcs[ctx.file][m[1]]);
    }
    // tables
    for (const m of body.matchAll(WRITE_RE)) { const t = m[1] ?? m[2]; if (knownTables.has(t)) n.writes.add(t); }
    // updates and deletes: how a job marks rows it has dealt with (an insert is not a pick-up)
    for (const m of body.matchAll(CHANGE_RE)) { const t = m[1] ?? m[2]; if (knownTables.has(t)) (n.changes ??= new Set()).add(t); }
    for (const m of body.matchAll(READ_RE)) { const t = m[1] ?? m[2]; if (knownTables.has(t) && !n.writes.has(t)) n.reads.add(t); }
  }

  // 4. endpoints -> handler ids
  const endpointCalls = {}; // "METHOD path" -> [ids]
  let resolved = 0, total = 0;
  for (const mount of mounts) {
    for (const ep of mount.endpoints) {
      total++;
      const calls = [];
      if (ep.handlerRef) {
        const [fac, h] = ep.handlerRef.split('.');
        const hid = controllers[fac]?.handlers[h];
        if (hid) calls.push(hid);
      }
      if (!calls.length && ep.inline) {
        for (const m of ep.inline.matchAll(/\b(\w+)\.(\w+)\s*\(/g)) {
          const type = instanceClass[m[1]];
          const t = type && resolveMember(type, m[2]);
          if (t) calls.push(t);
        }
      }
      if (calls.length) resolved++;
      endpointCalls[`${ep.method} ${ep.path}`] = uniq(calls);
    }
  }

  // drop nodes nobody reaches and that reach nothing interesting? keep all, but serialise compactly
  const out = {};
  for (const n of Object.values(nodes)) {
    out[n.id] = { k: n.kind, f: n.file, l: n.line, ...(n.doc ? { d: n.doc } : {}), ...(n.calls.size ? { c: [...n.calls] } : {}), ...(n.reads.size ? { r: [...n.reads] } : {}), ...(n.writes.size ? { w: [...n.writes] } : {}), ...(n.changes?.size ? { u: [...n.changes] } : {}), ...(n.stops?.size ? { s: [...n.stops] } : {}), ...(n.dynamic?.size ? { x: [...n.dynamic] } : {}) };
  }
  const callCount = Object.values(nodes).reduce((s, n) => s + n.calls.size, 0);
  return { methods: out, endpointCalls, repoKeys, classes, stats: { methods: Object.keys(out).length, calls: callCount, endpointsResolved: resolved, endpointsTotal: total } };
}

/** Every table a method touches, following calls (cycle-safe), up to `maxDepth` calls deep. */
export function reach(methods, id, maxDepth = Infinity) {
  const acc = { reads: new Set(), writes: new Set(), changes: new Set() };
  const seen = new Set();
  const go = (x, d) => {
    if (seen.has(x) || !methods[x] || d > maxDepth) return;
    seen.add(x);
    (methods[x].r ?? []).forEach((t) => acc.reads.add(t));
    (methods[x].w ?? []).forEach((t) => acc.writes.add(t));
    (methods[x].u ?? []).forEach((t) => acc.changes.add(t));
    (methods[x].c ?? []).forEach((c) => go(c, d + 1));
  };
  go(id, 0);
  return acc;
}
export { existsSync };
