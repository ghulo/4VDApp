import { CaretDown, Check } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { setPopover, useFloating } from './floating';

export interface ComboOption {
  value: string;
  label: string;
  /** Small words under the name, e.g. a code or a phone number. */
  hint?: string;
}

/** Lower case without accents, so "cokollate" finds "Çokollatë". */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The options whose name or hint holds every word typed, names that start with it first. */
export function matchOptions(options: ComboOption[], query: string): ComboOption[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  const hits = options.filter((option) => {
    const text = fold(`${option.label} ${option.hint ?? ''}`);
    return words.every((word) => text.includes(word));
  });
  const first = words[0]!;
  return [...hits.filter((option) => fold(option.label).startsWith(first)), ...hits.filter((option) => !fold(option.label).startsWith(first))];
}

interface ComboboxProps {
  /** The field's label, shown above it. */
  label: string;
  options: ComboOption[];
  /** The chosen option's value, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  /** How many matches to list at most; the rest are reached by typing more. */
  limit?: number;
  /** The form won't send until one is picked (typed words alone don't count). */
  required?: boolean;
  /** Empties the field after each pick, for adding one item after another. */
  resetAfterPick?: boolean;
}

/**
 * A field to type into and pick one from a long list (a customer, a
 * supplier, a product): the list narrows as you type, ignoring accents,
 * arrow keys walk it, Enter picks, Esc puts back the last choice.
 */
export function Combobox({ label, options, value, onChange, placeholder, hint, error, disabled, limit = 50, required, resetAfterPick }: ComboboxProps) {
  const t = useT();
  const id = useId();
  const listId = `${id}-list`;
  const chosen = options.find((option) => option.value === value);
  const [query, setQuery] = useState(chosen?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useFloating(inputRef, listRef, open, { align: 'start', matchWidth: true });

  // A choice made elsewhere (or cleared) shows in the field.
  const [shownValue, setShownValue] = useState(value);
  if (shownValue !== value) {
    setShownValue(value);
    setQuery(chosen?.label ?? '');
  }

  const typed = chosen && query === chosen.label ? '' : query;
  const matches = useMemo(() => matchOptions(options, typed).slice(0, limit), [options, typed, limit]);

  useEffect(() => setPopover(listRef.current, open), [open]);
  // Typed words that match nothing chosen don't fill a required field.
  useEffect(() => inputRef.current?.setCustomValidity(required && !value ? t.kit.pickFromList : ''), [required, value, t]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (option: ComboOption) => {
    onChange(option.value);
    setQuery(resetAfterPick ? '' : option.label);
    setOpen(false);
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (matches.length ? (index + step + matches.length) % matches.length : 0));
    } else if (event.key === 'Enter' && open && matches[active]) {
      event.preventDefault();
      pick(matches[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery(chosen?.label ?? '');
    }
  }

  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field combobox">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="combobox__box">
        <input
          ref={inputRef}
          id={id}
          className="combobox__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          autoComplete="off"
          placeholder={placeholder}
          disabled={disabled}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
            if (event.target.value === '') onChange('');
          }}
          onFocus={(event) => event.target.select()}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            setQuery(resetAfterPick ? '' : (chosen?.label ?? ''));
          }}
        />
        <CaretDown className="combobox__caret" size={14} weight="bold" aria-hidden="true" />
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label={label} popover="manual" className="combobox__list">
        {matches.length === 0 ? (
          <li className="combobox__empty" role="presentation">
            {t.kit.noMatch}
          </li>
        ) : (
          matches.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={index === active ? 'combobox__option combobox__option--active' : 'combobox__option'}
              // Pressing down would blur the field and close the list before the click lands.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              onPointerMove={() => setActive(index)}
            >
              <span className="combobox__name">
                {option.label}
                {option.hint && <span className="combobox__hint">{option.hint}</span>}
              </span>
              {option.value === value && <Check size={14} weight="bold" aria-hidden="true" />}
            </li>
          ))
        )}
      </ul>
      {hint && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}
