import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useT } from '../i18n/useT';

export const MAIN_ID = 'main';

/** The first thing Tab reaches: jumps past the top bar and menu to the page. */
export function SkipLink() {
  const t = useT();
  return (
    <a className="skip-link" href={`#${MAIN_ID}`}>
      {t.nav.skipToContent}
    </a>
  );
}

/** After moving to another page, puts focus on its heading so screen readers
    and keyboards start there, not at the menu link that was clicked. */
export function useFocusOnRouteChange() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let tries = 0;
    let frame = 0;
    const focusHeading = () => {
      const main = document.getElementById(MAIN_ID);
      if (!main) return;
      const heading = main.querySelector<HTMLElement>('h1');
      // Pages load lazily: wait a few frames for the heading before settling on the page itself.
      if (!heading && tries++ < 30) {
        frame = requestAnimationFrame(focusHeading);
        return;
      }
      const target = heading ?? main;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(focusHeading);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
}
