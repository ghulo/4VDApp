import { useEffect } from 'react';
import { isTypingTarget } from './matching';

/**
 * Ctrl/Cmd+K toggles the command palette anywhere. "/" jumps to the page's own
 * search box (or opens the palette when there isn't one), unless the person
 * is already typing in a field, where it should just type a slash.
 */
export function useShortcuts(togglePalette: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette();
        return;
      }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTypingTarget(event.target as HTMLElement | null)) return;
        event.preventDefault();
        const pageSearch = document.querySelector<HTMLInputElement>('[data-page-search]');
        if (pageSearch) pageSearch.focus();
        else togglePalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePalette]);
}
