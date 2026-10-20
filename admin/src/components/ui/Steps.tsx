import { Check } from '@phosphor-icons/react';
import { useT } from '../../i18n/useT';
import { Tooltip } from './Tooltip';

/**
 * Where you are in a short flow (Basket, Delivery, Payment, Done): the
 * steps behind you ticked, the current one in ink with an amber ring, the
 * ones ahead quiet. On a phone only the current step's name shows beside
 * "Step 2 of 4". Finished steps can be gone back to when `onStep` is given.
 */
export function Steps({ steps, current, label, onStep }: { steps: string[]; current: number; label: string; onStep?: (index: number) => void }) {
  const t = useT();
  return (
    <nav className="steps" aria-label={label}>
      <p className="steps__count">{t.kit.stepOf(current + 1, steps.length)}</p>
      <ol className="steps__list">
        {steps.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'next';
          const mark = state === 'done' ? <Check size={12} weight="bold" aria-hidden="true" /> : index + 1;
          const words = (
            <>
              <span className="steps__mark">{mark}</span>
              <span className="steps__name">
                {step}
                {state === 'done' && <span className="visually-hidden"> {t.common.done}</span>}
              </span>
            </>
          );
          return (
            <li key={step} className={`steps__step steps__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              {state === 'done' && onStep ? (
                // On a phone only the mark shows, so its name shows on hover and focus too.
                <Tooltip label={step}>
                  <button type="button" className="steps__back" onClick={() => onStep(index)}>
                    {words}
                  </button>
                </Tooltip>
              ) : (
                words
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
