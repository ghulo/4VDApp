/**
 * Browsers have no Keychain, so the web build keeps the login in the
 * browser's own storage. Metro picks this file instead of secureStorage.ts
 * when building for the web.
 */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private windows or blocked storage: behave as if logged out.
    return null;
  }
}

function write(action: () => void): void {
  try {
    action();
  } catch {
    // Storage unavailable: the login lasts until the tab is closed.
  }
}

export const secureStorage = {
  getItem: async (key: string) => read(key),
  setItem: async (key: string, value: string) => write(() => window.localStorage.setItem(key, value)),
  removeItem: async (key: string) => write(() => window.localStorage.removeItem(key)),
};
