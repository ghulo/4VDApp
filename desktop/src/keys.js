// The browser keys the app gives back (it has no menu bar): reload, full screen and zoom.
// Kept apart from main.js so it can be tested without Electron.

/**
 * What a key press does in the app window, or null to leave it to the page.
 * On the Counter F5 picks the customer, so it never reloads there (Ctrl+R still does,
 * for a screen that got stuck: a scanner never sends Ctrl, and the baskets survive a reload).
 * F10 (price check on the Counter) is not taken: with no menu bar Windows doesn't use it.
 * @param {{ type: string, key: string, control?: boolean }} input Electron's before-input-event input
 * @param {string} pathname the page's address path, e.g. "/counter"
 * @returns {'reload' | 'fullscreen' | 'zoomIn' | 'zoomOut' | 'zoomReset' | null}
 */
function keyAction(input, pathname) {
  if (input.type !== 'keyDown') return null;
  const key = input.key.toLowerCase();
  const onCounter = /^\/counter(\/|$)/.test(pathname);
  if (input.control && key === 'r') return 'reload';
  if (key === 'f5') return onCounter ? null : 'reload';
  if (key === 'f11') return 'fullscreen';
  if (input.control && (key === '=' || key === '+')) return 'zoomIn';
  if (input.control && key === '-') return 'zoomOut';
  if (input.control && key === '0') return 'zoomReset';
  return null;
}

/** The path of a page address, or "" for one that can't be read. */
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

module.exports = { keyAction, pathOf };
