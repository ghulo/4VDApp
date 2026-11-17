import { Hammer } from '@phosphor-icons/react';
import { useT } from '../../i18n/useT';

/**
 * Marks the 4VD developer (4VD's own staff, above every business) wherever a
 * name or role shows. full: hammer + "4VD developer" (top bar, account menu);
 * compact: hammer + "4VD" (people lists); glyph: the hammer alone, for dense
 * tables, named for screen readers and in a tooltip.
 */
export function DeveloperMark({ size = 'full' }: { size?: 'full' | 'compact' | 'glyph' }) {
  const t = useT();
  if (size === 'glyph') {
    return (
      <span className="devmark devmark--glyph" role="img" aria-label={t.kit.developer} title={t.kit.developerHint}>
        <Hammer className="devmark__hammer" weight="bold" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={`devmark devmark--${size}`} title={t.kit.developerHint}>
      <Hammer className="devmark__hammer" weight="bold" aria-hidden="true" />
      <span className="devmark__label">{size === 'full' ? t.kit.developer : t.kit.developerShort}</span>
    </span>
  );
}
