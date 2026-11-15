import type { KeyboardEvent } from 'react';

/** Chips that pick one thing: one tab stop, the arrow keys move the choice (like Segmented). */
export function ChipChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = (options.findIndex((option) => option.value === value) + step + options.length) % options.length;
    onChange(options[index]!.value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')[index]?.focus();
  }

  return (
    <div className={['segmented segmented--chips', className].filter(Boolean).join(' ')} role="radiogroup" aria-label={label} onKeyDown={handleKey}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className="segmented__option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
