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
        return (
          <li key={stage.key} className="funnel__stage">
            {lost !== null && (
              <p className="funnel__lost">
                <span>{t.kit.dropped(formatPercent(lost))}</span>
              </p>
            )}
            <div className="funnel__row">
              <span className="funnel__label">{stage.label}</span>
              <span className="funnel__track" aria-hidden="true">
                <span className="funnel__bar" style={{ inlineSize: `${Math.max(share * 100, stage.value > 0 ? 1.5 : 0)}%` }} />
              </span>
              <span className="funnel__value">{stage.display}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
