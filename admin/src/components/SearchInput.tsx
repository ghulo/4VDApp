import { useEffect, useState } from 'react';

const DEBOUNCE_MS = 300;

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

/** Waits until typing pauses before searching, so each keystroke isn't a request. */
export function SearchInput({ value, onChange, label }: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);

  // The search changed from outside (back button, link): show the new value.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => onChange(draft.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <input
      type="search"
      className="search-input"
      placeholder={label}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}
