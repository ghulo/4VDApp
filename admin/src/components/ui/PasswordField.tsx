import { Eye, EyeSlash } from '@phosphor-icons/react';
import { type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, useId, useState } from 'react';
import { useT } from '../../i18n/useT';
import { Tooltip } from './Tooltip';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  label: ReactNode;
  /** Shown at the end of the label row, e.g. a "Forgot your password?" link. */
  aside?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

/**
 * A password with an eye key to show what was typed, and a warning while
 * Caps Lock is on (the usual reason a right password is refused at a till).
 */
export function PasswordField({ label, aside, hint, error, ref, onKeyDown, onKeyUp, onBlur, ...input }: PasswordFieldProps) {
  const t = useT();
  const id = useId();
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const readCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'));
  const describedBy = [hint && `${id}-hint`, `${id}-caps`, error && `${id}-error`].filter(Boolean).join(' ');
  const toggleName = shown ? t.auth.hidePassword : t.auth.showPassword;

  return (
    <div className="field password-field">
      <span className="password-field__top">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {aside}
      </span>
      <span className="password-field__box">
        <input
          {...input}
          ref={ref}
          id={id}
          type={shown ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onKeyDown={(event) => {
            readCapsLock(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            readCapsLock(event);
            onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
        />
        <Tooltip label={toggleName}>
          <button
            type="button"
            className="password-field__eye"
            aria-label={toggleName}
            aria-controls={id}
            disabled={input.disabled}
            // Keep the caret in the field while the key is pressed.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setShown((now) => !now)}
          >
            {shown ? <EyeSlash size={18} weight="bold" aria-hidden="true" /> : <Eye size={18} weight="bold" aria-hidden="true" />}
          </button>
        </Tooltip>
      </span>
      {hint && (
        <span className="field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      <span className="password-field__caps" id={`${id}-caps`} aria-live="polite">
        {capsLock ? t.auth.capsLockOn : ''}
      </span>
      {error && (
        <span className="field__error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}
