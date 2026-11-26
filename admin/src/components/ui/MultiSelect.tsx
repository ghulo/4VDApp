import { X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useT } from '../../i18n/useT';
import { type ComboOption, matchOptions } from './Combobox';
import { Popover } from './Popover';

interface MultiSelectProps {
  /** What the choices are, e.g. "Category". */
  label: string;
  /** The key's words with nothing chosen, e.g. "Any category". */
  anyLabel: string;
  options: ComboOption[];
  values: string[];
  onChange: (values: string[]) => void;
}

/** Past this many choices the list gets a box to type in. */
const SEARCH_FROM = 8;

/**
 * A filter that takes several choices (Stock: three categories at once). The key
 * looks like the toolbar's selects and says what is chosen; it opens a short list
 * of ticks. Each choice then shows beside the key as a chip with its own ×, so
 * one can be dropped without opening the list again.
 */
export function MultiSelect({ label, anyLabel, options, values, onChange }: MultiSelectProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => options.filter((option) => values.includes(option.value)), [options, values]);
  const summary = chosen.length === 0 ? anyLabel : chosen.length === 1 ? chosen[0]!.label : t.kit.chosenCount(label, chosen.length);
  const shown = matchOptions(options, query);
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((one) => one !== value) : [...values, value]);

  return (
    <span className="multi-select">
      <Popover label={summary} title={label} variant="secondary">
        {() => (
          <div className="multi-select__panel">
            {options.length > SEARCH_FROM && (
              <input
                type="search"
                className="multi-select__search"
                aria-label={t.kit.narrowList(label)}
                placeholder={t.kit.narrowList(label)}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
            <ul className="multi-select__list" aria-label={label}>
              {shown.map((option) => (
                <li key={option.value}>
                  <label className="multi-select__option">
                    <input type="checkbox" checked={values.includes(option.value)} onChange={() => toggle(option.value)} />
                    <span>{option.label}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="multi-select__none">{t.kit.noMatch}</li>}
            </ul>
            {values.length > 0 && (
              <button type="button" className="multi-select__clear" onClick={() => onChange([])}>
                {t.kit.clearChoices}
              </button>
            )}
          </div>
        )}
      </Popover>
      {chosen.length > 1 &&
        chosen.map((option) => (
          <button key={option.value} type="button" className="multi-select__chip" aria-label={t.kit.removeChoice(option.label)} onClick={() => toggle(option.value)}>
            {option.label}
            <X size={12} weight="bold" aria-hidden="true" />
          </button>
        ))}
    </span>
  );
}
