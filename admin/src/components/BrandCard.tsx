import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { businessApi } from '../services/api';
import type { Brand, Business, BrandGreys } from '../services/types';
import { applyBrand, previewBrand, themeOf } from '../theme/applyBrand';
import { ACCENT_PRESETS, BRAND_PRESETS, HOUSE_COLOUR, brandInitials, isBrandHex, type BrandPreview } from '../theme/brandTheme';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { useT } from '../i18n/useT';
import { BrandMark } from './BrandMark';
import { Segmented } from './BillLines';
import { CopyButton } from './TwoStepCard';
import { SavedToast } from './Feedback';
import { LogoMark } from './LogoMark';
import { Button, Card, Field, Tooltip } from './ui';

/** The colours being tried: what the page previews and Save sends. */
interface Look {
  colour: string;
  accent: string | null;
  gradient: boolean;
  greys: BrandGreys;
}

const lookOf = (brand: Brand): Look => ({ colour: brand.colour, accent: brand.accent, gradient: brand.gradient, greys: brand.greys });
const sameLook = (a: Look, b: Look) => a.colour === b.colour && a.accent === b.accent && a.gradient === b.gradient && a.greys === b.greys;
/** "#0F766E", "0f766e" → "#0f766e", or null when it isn't a colour code. */
const parseHex = (value: string) => {
  const trimmed = value.trim();
  const hex = (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toLowerCase();
  return isBrandHex(hex) ? hex : null;
};

/**
 * Settings → Business look: the colours this business shows its people and
 * customers (main colour, accent, gradient, greys), and, for every business but
 * 4VD, the name shown and the lines under it on documents. Picking previews the
 * whole dashboard for the person editing only; nothing changes for the team
 * until "Save for everyone", and leaving without saving puts the saved colours
 * back. "Back to previous" undoes the last save; "Reset to default" goes back
 * to the starting colours (4VD: today's amber).
 */
export function BrandCard({ business }: { business: Business }) {
  const t = useT();
  const words = t.business.look;
  const queryClient = useQueryClient();
  const house = business.brand.house;
  const saved = lookOf(business.brand);
  const [look, setLook] = useState<Look>(saved);
  const [displayName, setDisplayName] = useState(business.displayName ?? '');
  const [receiptHeader, setReceiptHeader] = useState(business.receiptHeader ?? '');
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const savedBrand = useRef(business.brand);
  const resetPanel = useRef<HTMLDivElement>(null);
  const resetKey = useRef<HTMLButtonElement>(null);
  /** Close the reset question and give focus back to the key that opened it. */
  const keepMine = () => {
    setConfirmReset(false);
    requestAnimationFrame(() => resetKey.current?.focus());
  };
  useEffect(() => {
    savedBrand.current = business.brand;
  }, [business.brand]);

  // Only this person's page shows the colours being tried; the saved ones come back when the card goes.
  useEffect(() => previewBrand({ house, ...look }), [house, look]);
  useEffect(() => () => applyBrand(savedBrand.current), []);
  useEffect(() => {
    if (confirmReset) resetPanel.current?.querySelector('button')?.focus();
  }, [confirmReset]);

  const theme = useMemo(() => themeOf({ house, ...look }), [house, look]);
  const shownName = house ? business.brand.name : displayName.trim() || business.name;
  const lookChanged = !sameLook(look, saved);
  const hasChanges = lookChanged || (!house && ((displayName.trim() || null) !== business.displayName || (receiptHeader.trim() || null) !== business.receiptHeader));
  const atDefault = business.brandColour === null && business.brandAccent === null && !business.brandGradient && business.brandGreys === null;
  const defaultLook: Look = { colour: business.brandDefault.colour, accent: null, gradient: false, greys: business.brandDefault.greys };
  /** Saved colours go back after a question; colours only tried go back at once (nothing to save). */
  const resetNothing = atDefault && sameLook(look, defaultLook);
  const onReset = () => (atDefault ? setLook(defaultLook) : setConfirmReset(true));
  const previous = business.brandPrevious;
  const previousLook: Look | null = previous
    ? {
        colour: previous.colour ?? business.brandDefault.colour,
        accent: previous.accent,
        gradient: previous.gradient,
        greys: previous.greys ?? business.brandDefault.greys,
      }
    : null;

  /** What the server stores: null where the colour is the business's default, so Reset and "at default" stay true to it. */
  const stored = (next: Look) => ({
    brandColour: next.colour === business.brandDefault.colour ? null : next.colour,
    brandAccent: next.accent,
    brandGradient: next.accent ? next.gradient : false,
    brandGreys: next.greys === business.brandDefault.greys ? null : next.greys,
  });

  const save = useMutation({
    mutationFn: (input: { changes: Parameters<typeof businessApi.update>[0]; done: string }) => businessApi.update(input.changes),
    onSuccess: (updated: Business, input) => {
      queryClient.setQueryData(['business'], updated);
      applyBrand(updated.brand);
      setLook(lookOf(updated.brand));
      setConfirmReset(false);
      setNotice(input.done);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!hasChanges) return;
    save.mutate({
      changes: {
        ...stored(look),
        ...(!house && { displayName: displayName.trim() || null, receiptHeader: receiptHeader.trim() || null }),
      },
      done: words.saved,
    });
  }

  function cancel() {
    setLook(saved);
    setDisplayName(business.displayName ?? '');
    setReceiptHeader(business.receiptHeader ?? '');
  }

  const resetWhat = house ? words.resetHouse : words.resetOther(words.greysWord[business.brandDefault.greys]);
  // flatMark says all flatKey does and more, so only one of them shows.
  const notes = theme.notes.filter((note) => (note !== 'flatKey' && note !== 'flatMark') || (look.gradient && !(note === 'flatKey' && theme.notes.includes('flatMark'))));

  return (
    <form onSubmit={submit}>
      <Card
        id="look"
        title={words.title}
        description={house ? words.houseDescription : words.description}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {notice && !hasChanges && <SavedToast key={notice + business.brand.colour} message={notice} />}
            {!hasChanges && previousLook && !sameLook(previousLook, saved) && (
              <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ changes: stored(previousLook), done: words.previousDone })}>
                {words.previous}
              </Button>
            )}
            {/* Always here, so it is never missing when someone looks for it; greyed out once everything is the default. */}
            <Button
              ref={resetKey}
              type="button"
              variant="ghost"
              disabled={save.isPending || resetNothing}
              aria-expanded={atDefault ? undefined : confirmReset}
              aria-controls={atDefault ? undefined : 'brand-reset'}
              onClick={onReset}
            >
              {words.reset}
            </Button>
            {hasChanges && (
              <Button type="button" variant="ghost" onClick={cancel} disabled={save.isPending}>
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
          {confirmReset && (
            <div className="brand-card__reset" id="brand-reset" role="group" aria-labelledby="brand-reset-title" ref={resetPanel} onKeyDown={(event) => event.key === 'Escape' && keepMine()}>
              <span className="brand-card__reset-swatch" aria-hidden="true" style={{ background: business.brandDefault.colour }} />
              <div className="brand-card__reset-text">
                <strong id="brand-reset-title">{words.resetTitle}</strong>
                <span>{words.resetTo(resetWhat)}</span>
              </div>
              <div className="brand-card__reset-keys">
                <Button
                  type="button"
                  variant="primary"
                  loading={save.isPending}
                  onClick={() => save.mutate({ changes: { brandColour: null, brandAccent: null, brandGradient: false, brandGreys: null }, done: words.resetDone })}
                >
                  {words.resetConfirm}
                </Button>
                <Button type="button" variant="ghost" onClick={keepMine}>
                  {words.resetKeep}
                </Button>
              </div>
            </div>
          )}

          {/* The pieces customers and staff see first, light and dark, as they'd look once saved. */}
          <div className="brand-card__preview" role="group" aria-label={words.preview}>
            <p className="brand-card__preview-hint">{words.previewHint}</p>
            <div className="brand-previews">
              <MiniDashboard caption={words.light} tones={theme.preview.light} name={shownName} house={house} initials={brandInitials(shownName)} logoUrl={business.brand.logoUrl} />
              <MiniDashboard caption={words.dark} tones={theme.preview.dark} name={shownName} house={house} initials={brandInitials(shownName)} logoUrl={business.brand.logoUrl} />
              {!house && (
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
              )}
            </div>
          </div>

          <div className="brand-card__fields">
            {!house && (
              <Field label={words.name} hint={words.nameHint(business.name)}>
                <input maxLength={40} value={displayName} placeholder={business.name} onChange={(event) => setDisplayName(event.target.value)} />
              </Field>
            )}

            <ColourPicker
              label={words.colour}
              codeLabel={words.code}
              codeHint={words.codeHint}
              codeWrong={words.codeWrong}
              anyLabel={words.any}
              copyLabel={words.copy}
              options={[...(house ? [{ key: 'amber', label: words.presets.amber, hex: HOUSE_COLOUR }] : []), ...BRAND_PRESETS.map((preset) => ({ key: preset.key, label: words.presets[preset.key], hex: preset.hex }))]}
              value={look.colour}
              onChange={(colour) => setLook((now) => ({ ...now, colour: colour ?? now.colour }))}
              ramp={theme.ramp}
            />

            <ColourPicker
              label={words.accent}
              hint={words.accentHint}
              codeLabel={words.accentCode}
              codeHint={words.codeHint}
              codeWrong={words.codeWrong}
              anyLabel={words.accentAny}
              copyLabel={words.copy}
              options={[{ key: 'same', label: words.accentSame, hex: null }, ...ACCENT_PRESETS.map((preset) => ({ key: preset.key, label: words.accentPresets[preset.key], hex: preset.hex }))]}
              value={look.accent}
              onChange={(accent) => setLook((now) => ({ ...now, accent: accent && accent !== now.colour ? accent : null, gradient: accent ? now.gradient : false }))}
            />

            <div className="field">
              <span className="field__label" aria-hidden="true">
                {words.gradient}
              </span>
              <Segmented
                label={words.gradient}
                value={look.accent && look.gradient ? 'on' : 'off'}
                options={[
                  { value: 'off', label: words.gradientOptions.off },
                  { value: 'on', label: words.gradientOptions.on, disabled: !look.accent },
                ]}
                onChange={(value) => setLook((now) => ({ ...now, gradient: value === 'on' }))}
                describedBy="brand-gradient-hint"
              />
              <span className="field__hint" id="brand-gradient-hint">
                {look.accent ? words.gradientHint : words.gradientNeedsAccent}
              </span>
            </div>

            <div className="field">
              <span className="field__label" aria-hidden="true">
                {words.greys}
              </span>
              <Segmented
                label={words.greys}
                value={look.greys}
                options={(['plain', 'tinted'] as const).map((option) => ({ value: option, label: words.greysOptions[option] }))}
                onChange={(greys) => setLook((now) => ({ ...now, greys }))}
              />
            </div>

            <p className="brand-card__guard" role="status">
              {notes.length === 0 ? words.readsWell : notes.map((note) => words.notes[note]).join(' ')}
            </p>

            {!house && (
              <Field label={words.receiptHeader} hint={words.receiptHeaderHint}>
                <textarea rows={3} maxLength={200} value={receiptHeader} onChange={(event) => setReceiptHeader(event.target.value)} />
              </Field>
            )}

            {!house && business.shortName && (
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
        </div>
      </Card>
    </form>
  );
}

interface PickerOption {
  key: string;
  label: string;
  /** null: "same as main" (the accent only). */
  hex: string | null;
}

/**
 * Ready-made colours as keys (one tab stop, the arrow keys move the choice),
 * "any colour" through the system picker, and the code itself to paste or copy.
 */
function ColourPicker({
  label,
  hint,
  codeLabel,
  codeHint,
  codeWrong,
  anyLabel,
  copyLabel,
  options,
  value,
  onChange,
  ramp,
}: {
  label: string;
  hint?: string;
  codeLabel: string;
  codeHint: string;
  codeWrong: string;
  anyLabel: string;
  copyLabel: string;
  options: PickerOption[];
  value: string | null;
  onChange: (hex: string | null) => void;
  ramp?: Record<number, string>;
}) {
  const [typed, setTyped] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  const shownCode = editing ? typed : (value ?? '');
  const custom = value !== null && !options.some((option) => option.hex === value);
  const at = options.findIndex((option) => option.hex === value);

  function key(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || !(event.target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const next = (Math.max(at, step > 0 ? -1 : 0) + step + options.length) % options.length;
    onChange(options[next]!.hex);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
  }

  const codeOk = !editing || typed.trim() === '' || parseHex(typed) !== null;
  return (
    <fieldset className="brand-card__colour">
      <legend className="field__label">{label}</legend>
      {hint && <p className="field__hint brand-card__colour-hint">{hint}</p>}
      <div className="brand-swatches" role="radiogroup" aria-label={label} onKeyDown={key}>
        {options.map((option, index) => (
          <Tooltip key={option.key} label={option.label}>
            <button
              type="button"
              role="radio"
              aria-checked={option.hex === value}
              tabIndex={option.hex === value || (at < 0 && index === 0) ? 0 : -1}
              aria-label={option.label}
              className={option.hex ? 'brand-swatch' : 'brand-swatch brand-swatch--same'}
              style={option.hex ? { background: option.hex } : undefined}
              onClick={() => onChange(option.hex)}
            />
          </Tooltip>
        ))}
        <label className={custom ? 'brand-swatch brand-swatch--any brand-swatch--chosen' : 'brand-swatch brand-swatch--any'} style={custom && value ? { background: value } : undefined}>
          <span className="visually-hidden">{anyLabel}</span>
          <input type="color" value={value ?? '#808080'} onChange={(event) => onChange(event.target.value.toLowerCase())} />
        </label>
      </div>
      <div className="brand-card__code-row">
        <Field label={codeLabel} hint={codeOk ? codeHint : undefined} error={codeOk ? undefined : codeWrong} narrow>
          <input
            className="brand-card__code"
            value={shownCode}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            placeholder="#"
            onFocus={() => {
              setTyped(value ?? '');
              setEditing(true);
            }}
            onChange={(event) => {
              setTyped(event.target.value);
              const hex = parseHex(event.target.value);
              if (hex) onChange(hex);
            }}
            onBlur={() => setEditing(false)}
          />
        </Field>
        {value && (
          <span className="brand-card__copy" aria-label={copyLabel} role="group">
            <CopyButton text={value} />
          </span>
        )}
      </div>
      {ramp && (
        <div className="brand-ramp" aria-hidden="true">
          {Object.keys(ramp)
            .map(Number)
            .filter((step) => step % 100 === 0 || step === 50 || step === 950 || step === 975)
            .sort((a, b) => a - b)
            .map((step) => (
              <span key={step} style={{ background: ramp[step] }} />
            ))}
        </div>
      )}
    </fieldset>
  );
}

/** A small dashboard in one theme: the mark, the marker, a figure, a week of bars and the main key, in the colours being tried. */
function MiniDashboard({ caption, tones, name, house, initials, logoUrl }: { caption: string; tones: BrandPreview; name: string; house: boolean; initials: string; logoUrl: string | null }) {
  const t = useT();
  const words = t.business.look;
  const style = {
    '--p-bg': tones.bg,
    '--p-surface': tones.surface,
    '--p-sunk': tones.sunk,
    '--p-ink': tones.ink,
    '--p-muted': tones.muted,
    '--p-line': tones.line,
    '--p-word': tones.word,
    '--p-key': tones.keyFace,
    '--p-key-ink': tones.keyInk,
    '--p-key-edge': tones.keyEdge,
    '--p-mark-ink': tones.markInk,
    '--p-mark': tones.markFace,
    '--p-tick': tones.tick,
    '--p-data1': tones.data1,
    '--p-data3': tones.data3,
  } as CSSProperties;
  return (
    <figure className="brand-mini" style={style}>
      <figcaption className="brand-mini__caption">{caption}</figcaption>
      <div className="brand-mini__screen" aria-hidden="true">
        <div className="brand-mini__top">
          {house ? (
            <span className="brand-mini__logo" style={{ '--logo-from': tones.markFrom, '--logo-to': tones.markTo, '--logo-ink': tones.markInk } as CSSProperties}>
              <LogoMark size={22} />
            </span>
          ) : logoUrl ? <BrandMark brand={{ house: false, logoUrl, initials }} size={22} /> : <span className="brand-mini__mark" data-initials={initials} />}
          <span className="brand-mini__name">{name}</span>
        </div>
        <div className="brand-mini__body">
          <span className="brand-mini__nav">
            <span className="brand-mini__tick" />
            {t.nav.items.overview}
          </span>
          <span className="brand-mini__tile">
            <span className="brand-mini__label">{words.previewSales}</span>
            <strong>{formatMoney(1284)}</strong>
          </span>
          <span className="brand-mini__bars">
            {[42, 58, 35, 70, 64, 88, 51].map((height, index) => (
              <i key={index} className={index === 5 ? 'brand-mini__bar brand-mini__bar--hi' : 'brand-mini__bar'} style={{ height: `${height}%` }} />
            ))}
          </span>
          <span className="brand-mini__key">{words.previewNew}</span>
        </div>
      </div>
    </figure>
  );
}
