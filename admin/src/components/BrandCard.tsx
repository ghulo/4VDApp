import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { businessApi } from '../services/api';
import type { Business, BrandGreys } from '../services/types';
import { applyBrand, previewBrand } from '../theme/applyBrand';
import { BRAND_PRESETS, brandInitials, brandTheme, isBrandHex } from '../theme/brandTheme';
import { errorMessage } from '../utils/errors';
import { useT } from '../i18n/useT';
import { BrandMark } from './BrandMark';
import { CopyButton } from './TwoStepCard';
import { SavedToast } from './Feedback';
import { Button, Card, Field } from './ui';

/**
 * Settings → Business look: the name, colour and greys this business shows
 * its people and customers, and the lines under its name on documents. The
 * whole dashboard previews a colour as it's picked; leaving without saving
 * puts the saved one back. 4VD's own business keeps 4VD's look, so it has no
 * such card (BusinessPanel leaves it out).
 */
export function BrandCard({ business }: { business: Business }) {
  const t = useT();
  const words = t.business.look;
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(business.displayName ?? '');
  const [colour, setColour] = useState(business.brand.colour);
  const [typed, setTyped] = useState(business.brand.colour);
  const [greys, setGreys] = useState<BrandGreys>(business.brandGreys);
  const [receiptHeader, setReceiptHeader] = useState(business.receiptHeader ?? '');
  const saved = useRef(business.brand);
  useEffect(() => {
    saved.current = business.brand;
  }, [business.brand]);

  // The page shows the colour being picked; the saved one comes back when the card goes.
  useEffect(() => previewBrand(colour, greys), [colour, greys]);
  useEffect(() => () => applyBrand(saved.current), []);

  const theme = useMemo(() => brandTheme(colour, greys), [colour, greys]);
  const shownName = displayName.trim() || business.name;
  const hasChanges =
    (displayName.trim() || null) !== business.displayName ||
    colour !== business.brand.colour ||
    greys !== business.brandGreys ||
    (receiptHeader.trim() || null) !== business.receiptHeader;

  const save = useMutation({
    mutationFn: () =>
      businessApi.update({
        displayName: displayName.trim() || null,
        brandColour: colour,
        brandGreys: greys,
        receiptHeader: receiptHeader.trim() || null,
      }),
    onSuccess: (updated: Business) => {
      queryClient.setQueryData(['business'], updated);
      applyBrand(updated.brand);
    },
  });

  function pick(hex: string) {
    const value = hex.toLowerCase();
    setColour(value);
    setTyped(value);
  }

  function type(value: string) {
    setTyped(value);
    const hex = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
    if (isBrandHex(hex)) setColour(hex.toLowerCase());
  }

  function reset() {
    setDisplayName(business.displayName ?? '');
    pick(business.brand.colour);
    setGreys(business.brandGreys);
    setReceiptHeader(business.receiptHeader ?? '');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (hasChanges) save.mutate();
  }

  const typedOk = isBrandHex(typed.trim().startsWith('#') ? typed.trim() : `#${typed.trim()}`);
  const custom = !BRAND_PRESETS.some((preset) => preset.hex === colour);

  return (
    <form onSubmit={submit}>
      <Card
        id="look"
        title={words.title}
        description={words.description}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {save.isSuccess && !hasChanges && <SavedToast message={t.settings.saved} />}
            {hasChanges && (
              <Button type="button" variant="ghost" onClick={reset} disabled={save.isPending}>
                {words.undo}
              </Button>
            )}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!hasChanges || save.isPending} loading={save.isPending}>
              {words.save}
            </Button>
          </>
        }
      >
        <div className="brand-card">
          <div className="brand-card__fields">
            <Field label={words.name} hint={words.nameHint(business.name)}>
              <input maxLength={40} value={displayName} placeholder={business.name} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>

            <fieldset className="brand-card__colour">
              <legend className="field__label">{words.colour}</legend>
              <div className="brand-swatches" role="radiogroup" aria-label={words.colour}>
                {BRAND_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    role="radio"
                    aria-checked={colour === preset.hex}
                    aria-label={words.presets[preset.key]}
                    className="brand-swatch"
                    style={{ background: preset.hex }}
                    onClick={() => pick(preset.hex)}
                  />
                ))}
                <label className={custom ? 'brand-swatch brand-swatch--any brand-swatch--chosen' : 'brand-swatch brand-swatch--any'} style={custom ? { background: colour } : undefined}>
                  <span className="visually-hidden">{words.any}</span>
                  <input type="color" value={colour} onChange={(event) => pick(event.target.value)} />
                </label>
              </div>
              <Field label={words.code} hint={typedOk ? words.codeHint : undefined} error={typedOk ? undefined : words.codeWrong} narrow>
                <input className="brand-card__code" value={typed} spellCheck={false} autoComplete="off" maxLength={7} onChange={(event) => type(event.target.value)} onBlur={() => setTyped(colour)} />
              </Field>
              <div className="brand-ramp" aria-hidden="true">
                {Object.keys(theme.ramp)
                  .map(Number)
                  .filter((step) => step % 100 === 0 || step === 50 || step === 950 || step === 975)
                  .sort((a, b) => a - b)
                  .map((step) => (
                    <span key={step} style={{ background: theme.ramp[step] }} />
                  ))}
              </div>
            </fieldset>

            <div className="field">
              <span className="field__label" id="brand-greys">
                {words.greys}
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="brand-greys">
                {(['plain', 'tinted'] as const).map((option) => (
                  <button key={option} type="button" role="radio" aria-checked={greys === option} className="segmented__option" onClick={() => setGreys(option)}>
                    {words.greysOptions[option]}
                  </button>
                ))}
              </div>
            </div>

            <p className="brand-card__guard" role="status">
              {theme.notes.length === 0 ? words.readsWell : theme.notes.map((note) => words.notes[note]).join(' ')}
            </p>

            <Field label={words.receiptHeader} hint={words.receiptHeaderHint}>
              <textarea rows={3} maxLength={200} value={receiptHeader} onChange={(event) => setReceiptHeader(event.target.value)} />
            </Field>

            {business.shortName && (
              <div className="brand-card__links">
                <span className="field__label">{words.links}</span>
                <p className="field-hint">{words.linksHint}</p>
                {[
                  { key: 'signIn', url: `${window.location.origin}/login?b=${business.shortName}` },
                  { key: 'portal', url: `${window.location.origin}/portal?b=${business.shortName}` },
                ].map((link) => (
                  <div key={link.key} className="brand-card__link">
                    <span className="brand-card__link-label">{words.linkNames[link.key as 'signIn' | 'portal']}</span>
                    <code className="brand-card__link-url">{link.url}</code>
                    <CopyButton text={link.url} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* The page itself previews the colour; this shows the pieces customers see first. */}
          <div className="brand-card__preview" aria-label={words.preview} role="group">
            <div className="brand-preview__signin">
              <BrandMark brand={{ house: false, logoUrl: business.logoUrl, initials: brandInitials(shownName) }} size={48} />
              <strong className="brand-preview__name">{shownName}</strong>
              <span className="brand-preview__key" aria-hidden="true">
                {words.signIn}
              </span>
              <small className="brand-preview__runs">{t.nav.runsOn}</small>
            </div>
            <div className="brand-preview__receipt" aria-hidden="true">
              <span className="brand-preview__receipt-name">{shownName.toLocaleUpperCase()}</span>
              {receiptHeader
                .split('\n')
                .filter((line) => line.trim())
                .slice(0, 4)
                .map((line, index) => (
                  <span key={index}>{line}</span>
                ))}
            </div>
          </div>
        </div>
      </Card>
    </form>
  );
}
