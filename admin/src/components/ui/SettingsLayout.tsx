import { type ReactNode, useEffect, useState } from 'react';
import { useT } from '../../i18n/useT';

export interface SettingsSection {
  id: string;
  label: string;
  content: ReactNode;
}

const anchor = (id: string) => `section-${id}`;

/**
 * A long settings page as sections with a list of them beside it: the list
 * stays in view, jumps to a section and marks the one you're reading. On a
 * phone the list becomes a row of chips under the top bar.
 */
export function SettingsLayout({ sections }: { sections: SettingsSection[] }) {
  const t = useT();
  const [active, setActive] = useState(sections[0]?.id);
  const ids = sections.map((section) => section.id).join(' ');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    // A section counts as read once its top passes the upper third of the window.
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.slice(anchor('').length));
      },
      { rootMargin: '-96px 0px -60% 0px' },
    );
    for (const id of ids.split(' ')) {
      const element = document.getElementById(anchor(id));
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);

  function jump(id: string) {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(anchor(id))?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    setActive(id);
  }

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t.common.onThisPage}>
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${anchor(section.id)}`}
            className="settings-nav__link"
            aria-current={active === section.id ? 'true' : undefined}
            onClick={(event) => {
              event.preventDefault();
              jump(section.id);
            }}
          >
            {section.label}
          </a>
        ))}
      </nav>
      <div className="settings-layout__body">
        {sections.map((section) => (
          <div key={section.id} id={anchor(section.id)} className="settings-section">
            {section.content}
          </div>
        ))}
      </div>
    </div>
  );
}
