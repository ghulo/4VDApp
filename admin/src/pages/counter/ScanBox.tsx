import { Barcode, Tag } from '@phosphor-icons/react';
import { type KeyboardEvent, type RefObject, useState } from 'react';
import { useT } from '../../i18n/useT';
import { touchPhone } from '../../utils/touchPhone';

/**
 * The till's scan box. What is typed stays in here, so a scanner's dozen
 * keystrokes per code re-render only this box, not the whole till.
 */
export function ScanBox({
  inputRef,
  priceCheck,
  onEnter,
  onNudge,
  onType,
  onPriceCheckOff,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  priceCheck: boolean;
  /** Enter: the code typed or scanned (the box empties itself), or '' on an empty box. */
  onEnter: (code: string, timeStamp: number) => void;
  /** + or − on an empty box: one more or one less of the line. */
  onNudge: (by: 1 | -1) => void;
  /** Anything typed: an old message about the last scan goes. */
  onType: () => void;
  onPriceCheckOff: () => void;
}) {
  const t = useT();
  const [scan, setScan] = useState('');
  // On a phone the keyboard would cover the basket and Pay: the camera is the way in there, the box waits for a tap.
  const [phone] = useState(touchPhone);
  // "6*" typed and waiting for the scan: say so, so nobody wonders why six went in.
  const pending = /^(\d{1,4})\s*[*xX]$/.exec(scan.trim());
  const pendingCount = pending ? Math.max(1, Number(pending[1])) : null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const code = scan.trim() === '' ? '' : scan;
      if (code !== '') setScan('');
      onEnter(code, event.timeStamp);
      return;
    }
    if (scan === '' && (event.key === '+' || event.key === '-')) {
      event.preventDefault();
      onNudge(event.key === '+' ? 1 : -1);
    }
  };

  return (
    <label className={priceCheck ? 'counter-scan__field counter-scan__field--check' : 'counter-scan__field'}>
      <span className="counter-scan__icon" aria-hidden="true">
        {priceCheck ? <Tag size={24} weight="bold" /> : <Barcode size={24} weight="bold" />}
      </span>
      <span className="visually-hidden">{priceCheck ? t.counter.priceCheck : t.counter.scan}</span>
      <input
        ref={inputRef}
        name="code"
        autoFocus={!phone}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder={priceCheck ? t.counter.priceCheck : t.counter.scan}
        aria-describedby="counter-scan-hint"
        value={scan}
        onChange={(event) => {
          setScan(event.target.value);
          onType();
        }}
        onKeyDown={onKeyDown}
      />
      {pendingCount !== null && (
        <span className="counter-chip counter-chip--accent" role="status">
          {t.counter.multiplier(pendingCount)}
        </span>
      )}
      {scan.trim() !== '' && pendingCount === null && (
        <kbd className="counter-scan__enter" aria-hidden="true">
          Enter
        </kbd>
      )}
      {priceCheck && (
        <button type="button" className="counter-chip counter-chip--button" onClick={onPriceCheckOff}>
          {t.counter.priceCheckOff}
          <kbd aria-hidden="true">Esc</kbd>
        </button>
      )}
    </label>
  );
}
