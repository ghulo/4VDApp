import { type ComponentType, lazy } from 'react';

/**
 * Loads a named component's code only when it is first shown.
 * After a new release, a tab left open asks for files that no longer exist: main.tsx then
 * reloads the page and the import comes back empty, so wait for that reload instead of failing.
 */
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => {
    const module = (await load()) as M | undefined;
    if (!module) return new Promise<never>(() => {});
    return { default: module[name] };
  });
}
