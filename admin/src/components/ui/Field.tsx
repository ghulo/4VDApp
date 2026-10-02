import type { ReactNode } from 'react';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Keeps short inputs (prices, counts) from stretching. */
  narrow?: boolean;
  children: ReactNode;
}

/** A label wrapped around its control, with an optional hint and error under it. */
export function Field({ label, hint, error, narrow, children }: FieldProps) {
  return (
    <label className={narrow ? 'field field--narrow' : 'field'}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
