import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from 'react';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Keeps short inputs (prices, counts) from stretching. */
  narrow?: boolean;
  children: ReactNode;
}

type Described = ReactElement<{ 'aria-invalid'?: boolean | 'true' | 'false'; 'aria-describedby'?: string }>;

const NATIVE = new Set(['input', 'select', 'textarea']);

/**
 * A label wrapped around its control, with an optional hint and error under it.
 * A plain input, select or textarea is told about both, so a screen reader
 * reads the hint and the error with the field and hears that it is wrong.
 */
export function Field({ label, hint, error, narrow, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const ours = [hintId, errorId].filter(Boolean).join(' ');
  const control = Children.map(children, (child) => {
    if (!ours && !error) return child;
    if (!isValidElement(child) || typeof child.type !== 'string' || !NATIVE.has(child.type)) return child;
    const own = (child as Described).props;
    return cloneElement(child as Described, {
      'aria-invalid': error ? true : own['aria-invalid'],
      'aria-describedby': [own['aria-describedby'], ours].filter(Boolean).join(' ') || undefined,
    });
  });
  return (
    <label className={narrow ? 'field field--narrow' : 'field'}>
      <span className="field__label">{label}</span>
      {control}
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
