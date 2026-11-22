import type { Ref } from 'react';
import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from 'input-otp';

/**
 * A six-digit sign-in code as six inset boxes (3 · 3), like a field cut into
 * cells. One real input sits under them (input-otp), so paste, the phone's
 * "from Messages" and password-manager autofill, and screen readers all work.
 * `onComplete` fires on the sixth digit. On a wrong code the caller clears
 * the value and calls shake() on `boxRef` (DESIGN.md 12).
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  label,
  describedBy,
  boxRef,
  inputRef,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  label: string;
  describedBy?: string;
  boxRef?: Ref<HTMLDivElement>;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
}) {
  return (
    <div ref={boxRef} className="code-boxes" data-invalid={invalid || undefined}>
      <OTPInput
        ref={inputRef}
        maxLength={6}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        containerClassName="code-boxes__row"
        render={({ slots }) => (
          <>
            <div className="code-boxes__group">
              {slots.slice(0, 3).map((slot, index) => (
                <Box key={index} {...slot} />
              ))}
            </div>
            <span className="code-boxes__dash" aria-hidden="true" />
            <div className="code-boxes__group">
              {slots.slice(3).map((slot, index) => (
                <Box key={index} {...slot} />
              ))}
            </div>
          </>
        )}
      />
    </div>
  );
}

function Box({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div className="code-box" data-active={isActive || undefined} data-filled={char ? true : undefined}>
      {char}
      {hasFakeCaret && <span className="code-box__caret" aria-hidden="true" />}
    </div>
  );
}
