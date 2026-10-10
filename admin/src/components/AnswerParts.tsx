import { ArrowRight } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import type { AnswerExtras } from '../services/types';
import { formatMoney } from '../utils/format';
import { DataTable } from './ui';

const formatNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * An answer's text: plain lines, with lines starting "- " gathered into a list.
 */
export function AnswerText({ text }: { text: string }) {
  const blocks: Array<{ kind: 'p'; text: string } | { kind: 'ul'; items: string[] }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^[-•*]\s+(.*)$/.exec(line)?.[1];
    const last = blocks.at(-1);
    if (item === undefined) blocks.push({ kind: 'p', text: line });
    else if (last?.kind === 'ul') last.items.push(item);
    else blocks.push({ kind: 'ul', items: [item] });
  }
  return (
    <div className="answer-text">
      {blocks.map((block, index) =>
        block.kind === 'p' ? (
          <p key={index}>{block.text}</p>
        ) : (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

export function AnswerTable({ table }: { table: AnswerExtras['tables'][number] }) {
  // A column is numeric when every filled cell in it is a number, so it lines up on the right.
  const numeric = table.columns.map((_, column) =>
    table.rows.every((row) => row[column] === undefined || row[column] === '' || typeof row[column] === 'number'),
  );
  return (
    <section className="answer-part">
      <h3 className="answer-part__title">{table.title}</h3>
      <DataTable<{ index: number; cells: Array<string | number> }>
        caption={table.title}
        rows={table.rows.map((cells, index) => ({ index, cells }))}
        rowKey={(row) => row.index}
        columns={table.columns.map((header, column) => ({
          header,
          title: column === 0,
          align: numeric[column] ? 'end' : 'start',
          cell: (row) => {
            const value = row.cells[column];
            return typeof value === 'number' ? formatNumber(value) : (value ?? '');
          },
        }))}
      />
    </section>
  );
}

/**
 * One series as labelled horizontal bars: reads at phone width, and each value
 * is printed at its bar's end, so nothing depends on colour or hover.
 */
export function AnswerChart({ chart }: { chart: AnswerExtras['charts'][number] }) {
  const t = useT();
  const format = chart.unit === 'eur' ? formatMoney : formatNumber;
  const max = Math.max(...chart.bars.map((bar) => Math.abs(bar.value)), 0);
  return (
    <figure className="answer-part answer-chart">
      <figcaption className="answer-part__title">{chart.title}</figcaption>
      <ul className="answer-chart__bars" aria-label={t.ask.chartLabel(chart.title)}>
        {chart.bars.map((bar, index) => (
          <li key={index} className="answer-chart__row">
            <span className="answer-chart__label">{bar.label}</span>
            <span className="answer-chart__track" aria-hidden="true">
              <span
                className={`answer-chart__bar${bar.value < 0 ? ' answer-chart__bar--negative' : ''}`}
                style={{ inlineSize: max > 0 && bar.value !== 0 ? `${Math.max(1, (Math.abs(bar.value) / max) * 100)}%` : '0%' }}
              />
            </span>
            <span className="answer-chart__value">{format(bar.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function AnswerLinks({ links }: { links: AnswerExtras['links'] }) {
  const t = useT();
  return (
    <nav className="answer-links" aria-label={t.ask.seeAlso}>
      {links.map((link) => (
        <Link key={`${link.to}-${link.label}`} to={link.to} className="answer-link">
          {link.label}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      ))}
    </nav>
  );
}
