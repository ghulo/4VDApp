import type { CSSProperties } from 'react';
import { useT } from '../../i18n/useT';
import { formatPercent } from '../../utils/format';

export interface FunnelStage {
  key: string | number;
  label: string;
  value: number;
  /** The value as shown, e.g. "42 offers". */
  display: string;
}

/** Each stage's share of the first, and how much was lost since the stage before. */
export function funnelSteps(stages: FunnelStage[]): Array<{ share: number; lost: number | null }> {
  const first = stages[0]?.value ?? 0;
  return stages.map((stage, index) => {
    const before = index > 0 ? stages[index - 1]!.value : null;
    return {
      share: first > 0 ? Math.max(0, Math.min(1, stage.value / first)) : 0,
      lost: before && before > 0 ? Math.max(0, 1 - stage.value / before) : null,
    };
  });
}

/**
 * Steps that fewer get through each time (offers made, accepted, invoiced,
 * paid): one ink bar per step against the first, and between steps how many
 * dropped off. A list, so screen readers read it in order.
 */
export function FunnelChart({ stages, label }: { stages: FunnelStage[]; label: string }) {
  const t = useT();
  const steps = funnelSteps(stages);
  return (
    <ol className="funnel" aria-label={label}>
      {stages.map((stage, index) => {
        const { share, lost } = steps[index]!;
        const width = (value: number, has: boolean) => `${Math.max(value * 100, has ? 1.5 : 0)}%`;
        const before = index > 0 ? steps[index - 1]!.share : null;
        return (
          <li key={stage.key} className="funnel__stage" style={{ '--i': index } as CSSProperties}>
            {lost !== null && (
              <p className="funnel__lost">
                <span>{t.kit.dropped(formatPercent(lost))}</span>
              </p>
            )}
            <div className="funnel__row">
              <span className="funnel__label">{stage.label}</span>
              <span className="funnel__track" aria-hidden="true">
                {/* A ghost of the step before, so what dropped off shows as the gap. */}
                {before !== null && <span className="funnel__ghost" style={{ inlineSize: width(before, before > 0) }} />}
                <span className="funnel__bar" style={{ inlineSize: width(share, stage.value > 0) }} />
              </span>
              <span className="funnel__value">{stage.display}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
