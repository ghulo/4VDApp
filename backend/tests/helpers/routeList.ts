import express, { type Express } from 'express';

/**
 * Express 5 keeps no mount path on a router's layers, so the access test
 * can't list routes from a finished app. This notes the path each router is
 * mounted at, once, before any app is built.
 */
type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle: { stack?: Layer[] }; mountPath?: string };
type RouterProto = { use: (...args: unknown[]) => unknown; stack: Layer[] };

let patched = false;
export function recordMountPaths(): void {
  if (patched) return;
  patched = true;
  const proto = (express.Router as unknown as { prototype: RouterProto }).prototype;
  const original = proto.use;
  proto.use = function use(this: RouterProto, ...args: unknown[]) {
    const before = this.stack.length;
    const result = original.apply(this, args);
    const path = typeof args[0] === 'string' ? args[0] : '';
    for (const layer of this.stack.slice(before)) layer.mountPath = path;
    return result;
  };
}

export interface RouteEntry {
  method: string;
  path: string;
}

/** Every method + path the app answers, e.g. { method: 'GET', path: '/api/products/:id' }. */
export function listRoutes(app: Express): RouteEntry[] {
  const out: RouteEntry[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const [method, on] of Object.entries(layer.route.methods)) {
          if (on && method !== '_all') out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
        }
      } else if (layer.handle.stack) {
        walk(layer.handle.stack, prefix + (layer.mountPath ?? ''));
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack, '');
  // One entry per method and path (a route listed twice is answered once).
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
