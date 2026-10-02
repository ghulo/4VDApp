import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand';

/** A small status label. The tone adds colour; the words carry the meaning. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
