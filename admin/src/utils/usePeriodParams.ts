import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useT } from '../i18n/useT';
import { type CompareKey, lastYearOf, type PeriodKey, resolvePeriod } from './periods';

/**
 * The period picked on a page, kept in the address (?period=&from=&to=) so a
 * refresh or a shared link shows the same figures.
 */
export function usePeriodParams(fallback: PeriodKey) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const period = (params.get('period') as PeriodKey | null) ?? fallback;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const compare: CompareKey = params.get('compare') === 'last-year' ? 'last-year' : 'before';
  // Work the range out once per selection: ranges ending "now" must not
  // change on every render, or queries keyed on them would refetch in a loop.
  const range = useMemo(() => resolvePeriod(period, { from, to }, undefined, t), [period, from, to, t]);
  const rangeKey = useMemo(() => ({ startDate: range.startDate, endDate: range.endDate }), [range]);
  const comparedRange = useMemo(
    () =>
      compare === 'last-year'
        ? { ...rangeKey, ...lastYearOf(rangeKey) }
        : { ...rangeKey, previousStartDate: range.previousStartDate, previousEndDate: range.previousEndDate },
    [range, rangeKey, compare],
  );

  function changePeriod(next: { period: PeriodKey; from: string; to: string }) {
    const nextParams = new URLSearchParams(params);
    nextParams.set('period', next.period);
    nextParams.delete('from');
    nextParams.delete('to');
    if (next.period === 'custom') {
      if (next.from) nextParams.set('from', next.from);
      if (next.to) nextParams.set('to', next.to);
    }
    setParams(nextParams, { replace: true });
  }

  function changeCompare(next: CompareKey) {
    const nextParams = new URLSearchParams(params);
    if (next === 'before') nextParams.delete('compare');
    else nextParams.set('compare', next);
    setParams(nextParams, { replace: true });
  }

  return { period, from, to, range, rangeKey, comparedRange, changePeriod, compare, changeCompare };
}
