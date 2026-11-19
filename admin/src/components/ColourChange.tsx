import { useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { businessApi } from '../services/api';
import type { StoredBrandTheme } from '../services/types';
import { ACCENT_PRESETS, BRAND_PRESETS, HOUSE_COLOUR } from '../theme/brandTheme';

/** A colour save as it is logged: the four stored values before and after (null = the business's default). */
const asTheme = (raw: unknown): StoredBrandTheme => {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<StoredBrandTheme>;
  return { colour: value.colour ?? null, accent: value.accent ?? null, gradient: value.gradient === true, greys: value.greys ?? null };
};

/**
 * One colour save in words, with a small swatch by each colour: only the parts
 * that changed, e.g. "Colours: main colour 4VD amber (default) → ■ Teal; accent
 * ■ Saffron → same as main; gradient on → off". Never the stored code.
 */
export function ColourChange({ from, to }: { from: unknown; to: unknown }) {
  const t = useT();
  const words = t.history.colours;
  const look = t.business.look;
  const business = useQuery({ queryKey: ['business'], queryFn: businessApi.get });
  const before = asTheme(from);
  const after = asTheme(to);
  const defaults = business.data?.brandDefault ?? { colour: HOUSE_COLOUR, greys: 'plain' as const };

  const named = (hex: string, presets: readonly { key: string; hex: string }[], names: Record<string, string>) => {
    if (hex === HOUSE_COLOUR) return look.presets.amber;
    const preset = presets.find((option) => option.hex === hex);
    return preset ? (names[preset.key] ?? hex) : hex;
  };
  const swatch = (hex: string, label: string) => (
    <span className="record-history__colour">
      <span className="record-history__swatch" style={{ background: hex }} aria-hidden="true" />
      {label}
    </span>
  );
  const main = (hex: string | null) => {
    const shown = hex ?? defaults.colour;
    const label = named(shown, BRAND_PRESETS, look.presets);
    return swatch(shown, hex === null ? words.byDefault(label) : label);
  };
  const accent = (hex: string | null) => (hex === null ? <span>{words.same}</span> : swatch(hex, named(hex, ACCENT_PRESETS, look.accentPresets)));
  const greys = (value: StoredBrandTheme['greys']) => {
    const label = look.greysWord[value ?? defaults.greys];
    return <span>{value === null ? words.byDefault(label) : label}</span>;
  };

  const parts: { key: string; name: string; from: ReactNode; to: ReactNode }[] = [];
  if (before.colour !== after.colour) parts.push({ key: 'main', name: words.main, from: main(before.colour), to: main(after.colour) });
  if (before.accent !== after.accent) parts.push({ key: 'accent', name: words.accent, from: accent(before.accent), to: accent(after.accent) });
  if (before.gradient !== after.gradient) parts.push({ key: 'gradient', name: words.gradient, from: <span>{before.gradient ? words.on : words.off}</span>, to: <span>{after.gradient ? words.on : words.off}</span> });
  if (before.greys !== after.greys) parts.push({ key: 'greys', name: words.greys, from: greys(before.greys), to: greys(after.greys) });

  return (
    <span className="record-history__change record-history__change--colours">
      <span>{words.title}:</span>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          <span className="record-history__colour-part">
            {part.name} {part.from} <span aria-label={words.becomes}>→</span> {part.to}
            {index < parts.length - 1 && ';'}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
