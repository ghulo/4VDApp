import { Plus } from '@phosphor-icons/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  BarList,
  Button,
  ButtonLink,
  Card,
  ColumnChart,
  DataTable,
  DateField,
  DayBars,
  EmptyState,
  Field,
  ShopSunrise,
  MetricCard,
  PageHeader,
  SettingRow,
  StatGrid,
  StatTile,
} from './index';
import { dayMonthYearToIso, isoToDayMonthYear } from './DateField';

const render = (element: ReactElement) => renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);

describe('Button', () => {
  it('should be a secondary, medium, type="button" button by default', () => {
    const html = render(<Button>Save</Button>);

    expect(html).toContain('type="button"');
    expect(html).toContain('button button--secondary');
    expect(html).not.toContain('button--sm');
  });

  it('should carry its variant, size and icon', () => {
    const html = render(
      <Button variant="primary" size="sm" icon={Plus} type="submit">
        Add
      </Button>,
    );

    expect(html).toContain('button--primary');
    expect(html).toContain('button--sm');
    expect(html).toContain('type="submit"');
    expect(html).toContain('<svg');
  });

  it('should mark icon-only buttons so they render square', () => {
    const html = render(<Button icon={Plus} aria-label="Add" />);

    expect(html).toContain('button--icon');
    expect(html).toContain('aria-label="Add"');
  });

  it('should render as a link with the same classes', () => {
    const html = render(
      <ButtonLink to="/products/new" variant="primary">
        Add product
      </ButtonLink>,
    );

    expect(html).toMatch(/<a [^>]*href="\/products\/new"/);
    expect(html).toContain('button button--primary');
  });
});

describe('PageHeader', () => {
  it('should show breadcrumbs, title, description and actions', () => {
    const html = render(
      <PageHeader
        title="Oak Chair"
        description="Edit the price and stock."
        crumbs={[{ label: 'Products', to: '/products' }]}
        actions={<Button>Delete</Button>}
      />,
    );

    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toMatch(/href="\/products"[^>]*>Products/);
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/<h1[^>]*>Oak Chair<\/h1>/);
    expect(html).toContain('Edit the price and stock.');
    expect(html).toContain('page-header__actions');
  });

  it('should leave out breadcrumbs when there are none', () => {
    expect(render(<PageHeader title="Products" />)).not.toContain('Breadcrumb');
  });
});

describe('Card', () => {
  it('should label the section by its title and show a footer strip', () => {
    const html = render(
      <Card title="Shop details" description="Shown in emails." footer={<Button>Save</Button>}>
        body
      </Card>,
    );

    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain('card__foot');
    expect(html).toContain('Shown in emails.');
  });

  it('should have no header without a title', () => {
    const html = render(<Card>body</Card>);

    expect(html).not.toContain('card__head');
    expect(html).not.toContain('aria-labelledby');
  });
});

describe('SettingRow', () => {
  it('should put the words on one side and the control on the other', () => {
    const html = render(
      <SettingRow title="Weekly report" description="Every Monday evening.">
        <input type="checkbox" />
      </SettingRow>,
    );

    expect(html).toContain('setting-row__text');
    expect(html).toContain('setting-row__control');
    expect(html).toContain('Every Monday evening.');
  });
});

describe('DataTable', () => {
  const columns = [
    { header: 'Name', cell: (row: { id: number; name: string }) => row.name },
    { header: 'Price', cell: () => '€1.00', align: 'end' as const },
  ];

  it('should render a row per item with right-aligned number columns', () => {
    const html = render(
      <DataTable
        caption="Products"
        columns={columns}
        rows={[
          { id: 1, name: 'Oak Chair' },
          { id: 2, name: 'Pine Table' },
        ]}
        rowKey={(row) => row.id}
      />,
    );

    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(html).toContain('Pine Table');
    expect(html).toContain('table__numeric');
    expect(html).toContain('<caption class="visually-hidden">Products</caption>');
  });

  it('should show the empty state instead of an empty table', () => {
    const html = render(
      <DataTable caption="Products" columns={columns} rows={[]} rowKey={(row) => row.id} empty={<p>Nothing yet</p>} />,
    );

    expect(html).not.toContain('<table');
    expect(html).toContain('Nothing yet');
  });
  it('should name each cell with its column so rows can stack on phones', () => {
    const html = render(
      <DataTable
        caption="Products"
        columns={[...columns, { header: <span className="visually-hidden">Actions</span>, cell: () => 'Edit' }]}
        rows={[{ id: 1, name: 'Oak Chair' }]}
        rowKey={(row) => row.id}
      />,
    );

    expect(html).toContain('class="table table--stack"');
    expect(html).toContain('data-label="Price"');
    // A hidden header gives no name, so the cell shows as a plain block.
    expect(html).toMatch(/<td role="cell">Edit<\/td>/);
  });

  it('should keep table roles so older Safari still reads stacked rows as a table', () => {
    const html = renderToStaticMarkup(
      <DataTable caption='Products' columns={[{ header: 'Name', cell: (r: { n: string }) => r.n }]} rows={[{ n: 'Oak Chair' }]} rowKey={(r) => r.n} />,
    );
    expect(html).toContain('role="table"');
    expect(html).toContain('<td role="cell"');
  });

  it('should mark the cell that heads the row on phones', () => {
    const html = render(
      <DataTable caption="Products" columns={[columns[1]!, { ...columns[0]!, title: true }]} rows={[{ id: 1, name: 'Oak Chair' }]} rowKey={(row) => row.id} />,
    );

    expect(html).toContain('class="table__title" data-label="Name">Oak Chair');
  });
});

describe('MetricCard', () => {
  it('should show a percent change with its meaning for screen readers', () => {
    const html = render(<MetricCard label="Revenue" value="€100" change={0.25} />);

    expect(html).toContain('25%');
    expect(html).toContain('up 25% on the period before');
  });

  it('should say a huge rise as a multiple, never just "much more"', () => {
    const html = render(<MetricCard label="Revenue" value="€100" change={770.9} />);

    // From ten times up the exact multiple is noise, so it reads "10×+".
    expect(html).toContain('10×+');
    expect(html).toContain('10×+ as much as the period before');
    expect(html).not.toContain('%');
  });

  it('should say when there was nothing the period before', () => {
    const html = render(<MetricCard label="Revenue" value="€100" change={null} />);

    expect(html).toContain('None before');
    expect(html).not.toContain('%');
  });
});

describe('Badge, StatTile and EmptyState', () => {
  it('should colour a badge by tone', () => {
    expect(render(<Badge tone="warn">Waiting</Badge>)).toContain('badge badge--warn');
    expect(render(<Badge>Draft</Badge>)).toContain('badge badge--neutral');
  });

  it('should show a figure with its label and turn into a link when given one', () => {
    const html = render(
      <StatGrid>
        <StatTile label="Sold today" value="€120.00" hint="3 sales" to="/sales" />
      </StatGrid>,
    );

    expect(html).toContain('€120.00');
    expect(html).toContain('Sold today');
    expect(html).toMatch(/<a [^>]*href="\/sales"/);
  });

  it('should show the empty state title, body and action', () => {
    const html = render(
      <EmptyState title="No products yet" action={<Button>Add product</Button>}>
        Add one to start selling.
      </EmptyState>,
    );

    expect(html).toContain('No products yet');
    expect(html).toContain('Add one to start selling.');
    expect(html).toContain('Add product');
  });

  it('should wrap a control with its label, hint and error', () => {
    const html = render(
      <Field label="Shop name" hint="Shown in emails." error="Required">
        <input />
      </Field>,
    );

    expect(html).toMatch(/<label class="field[^"]*">/);
    expect(html).toContain('Shown in emails.');
    expect(html).toContain('role="alert"');
  });

  it('should draw the shop at sunrise with four equal pillars, hidden from screen readers', () => {
    const html = render(<ShopSunrise />);

    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/x="\d+(\.\d+)?" y="76" width="11" height="38"/g)).toHaveLength(4);
  });
});

describe('DayBars', () => {
  it('should stand the days with sales on one baseline and leave empty days bare', () => {
    const html = render(<DayBars values={[0, 4, 10]} label="Sales per day" />);

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Sales per day"');
    // The baseline plus a bar for each day that sold; the empty day draws nothing.
    expect(html.match(/<rect/g)).toHaveLength(3);
    expect(html.match(/day-bars__base/g)).toHaveLength(1);
    expect(html.match(/day-bars__bar"|day-bars__bar /g)).toHaveLength(2);
    expect(html).toContain('day-bars__bar--latest');
    expect(html).not.toContain('day-bars__break');
  });

  it('should cap one huge day with a break mark so the other days stay readable', () => {
    const html = render(<DayBars values={[2, 3, 40]} label="Sales per day" />);

    expect(html.match(/day-bars__break/g)).toHaveLength(1);
  });
});

describe('BarList and ColumnChart', () => {
  const bars = (values: number[]) =>
    render(<BarList label="Top products" items={values.map((value, key) => ({ key, label: `P${key}`, value, display: String(value) }))} />);
  const columns = (values: number[]) =>
    render(<ColumnChart label="Weekdays" columns={values.map((value, key) => ({ key, label: `D${key}`, description: String(value), value }))} />);

  it('should cap one huge bar with a break so the others keep their size', () => {
    const html = bars([100, 10, 8]);

    expect(html.match(/bar-list__bar--capped/g)).toHaveLength(1);
    expect(html).toContain('inline-size:100%');
    // Scaled to the second-longest with headroom: 10 of 12.5.
    expect(html).toContain('inline-size:80%');
    expect(html).toContain('>100<');
  });

  it('should cap one huge column the same way, and leave an even chart alone', () => {
    expect(columns([5, 60, 4]).match(/column-chart__bar--capped/g)).toHaveLength(1);
    expect(columns([5, 6, 4])).not.toContain('--capped');
    expect(bars([5, 6, 4])).not.toContain('--capped');
  });
});

describe('DateField', () => {
  it('should read and write day/month/year whatever the language', () => {
    expect(isoToDayMonthYear('2026-10-13')).toBe('13/10/2026');
    expect(isoToDayMonthYear('')).toBe('');
    expect(dayMonthYearToIso('13/10/2026')).toBe('2026-10-13');
    expect(dayMonthYearToIso('1.2.26')).toBe('2026-02-01');
    expect(dayMonthYearToIso(' 5-11-2026 ')).toBe('2026-11-05');
  });

  it('should refuse text that is not a real day', () => {
    expect(dayMonthYearToIso('31/02/2026')).toBeNull();
    expect(dayMonthYearToIso('13/13/2026')).toBeNull();
    expect(dayMonthYearToIso('10/13')).toBeNull();
    expect(dayMonthYearToIso('tomorrow')).toBeNull();
  });

  it('should show the day as text with a calendar button', () => {
    const html = render(<DateField value="2026-10-13" onChange={() => undefined} max="2026-12-31" />);

    expect(html).toContain('value="13/10/2026"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('date-field__calendar');
    expect(html).toContain('tabindex="-1"');
  });
});

describe('newer kit pieces', () => {
  it('should float a panel below its anchor, or above when there is no room below', async () => {
    const { placeFloating } = await import('./floating');
    const view = { width: 1000, height: 800 };
    expect(placeFloating({ top: 100, left: 100, width: 40, height: 40 }, { width: 100, height: 50 }, view)).toEqual({ top: 146, left: 70, side: 'bottom' });
    expect(placeFloating({ top: 760, left: 100, width: 40, height: 30 }, { width: 100, height: 50 }, view).side).toBe('top');
    // Never past the window's edge.
    expect(placeFloating({ top: 100, left: 980, width: 20, height: 20 }, { width: 200, height: 50 }, view).left).toBe(792);
  });

  it('should match options without accents, names that start with the words first', async () => {
    const { matchOptions } = await import('./Combobox');
    const options = [
      { value: '1', label: 'Arta Çlirimi' },
      { value: '2', label: 'Çlirim Berisha', hint: '044 1' },
      { value: '3', label: 'Blerim' },
    ];
    expect(matchOptions(options, 'clirim').map((option) => option.value)).toEqual(['2', '1']);
    expect(matchOptions(options, '044').map((option) => option.value)).toEqual(['2']);
    expect(matchOptions(options, '  ')).toHaveLength(3);
  });

  it('should scale area points to the top value, with an outlier on the edge', async () => {
    const { areaPoints } = await import('./AreaChart');
    expect(areaPoints([0, 5, 10])).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0 },
    ]);
    expect(areaPoints([10, 12, 100])[2]!.y).toBe(0);
    expect(areaPoints([])).toEqual([]);
  });

  it('should keep the four biggest donut slices and add up the rest as Other', async () => {
    const { donutSlices } = await import('./DonutChart');
    const slices = [1, 2, 3, 4, 5, 6, 0].map((value) => ({ key: value, label: String(value), value, display: String(value) }));
    const shown = donutSlices(slices, 'Other', String);
    expect(shown.map((slice) => slice.label)).toEqual(['6', '5', '4', '3', 'Other']);
    expect(shown[4]!.value).toBe(3);
  });

  it('should work out heat levels and funnel drop-offs', async () => {
    const { heatLevel } = await import('./Heatmap');
    const { funnelSteps } = await import('./FunnelChart');
    expect([heatLevel(0, 10), heatLevel(5, 10), heatLevel(20, 10), heatLevel(3, 0)]).toEqual([0, 0.5, 1, 0]);
    expect(
      funnelSteps([
        { key: 1, label: 'Made', value: 40, display: '' },
        { key: 2, label: 'Yes', value: 30, display: '' },
        { key: 3, label: 'Paid', value: 0, display: '' },
      ]),
    ).toEqual([
      { share: 1, lost: null },
      { share: 0.75, lost: 0.25 },
      { share: 0, lost: 1 },
    ]);
  });

  it('should lay out a month Monday first and move by months without spilling over', async () => {
    const { addMonths, monthGrid } = await import('./Calendar');
    const weeks = monthGrid('2026-10-21');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]).toBe('2026-09-28');
    expect(weeks[0]![3]).toBe('2026-10-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('should link an icon-only button to a tooltip with its name', () => {
    const html = render(<Button icon={Plus} aria-label="Add a product" />);
    const id = /data-ui-tooltip="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}" role="tooltip"`);
    expect(html).toContain('Add a product</span>');
    expect(render(<Button icon={Plus}>Add</Button>)).not.toContain('role="tooltip"');
  });

  it('should draw shortcuts as keycaps and steps with the current one marked', async () => {
    const { Kbd, Steps, Skeleton } = await import('./index');
    expect(render(<Kbd keys={['Ctrl', 'K']} />)).toBe('<kbd class="kbd"><kbd>Ctrl</kbd><kbd>K</kbd></kbd>');
    const steps = render(<Steps label="Delivery" steps={['Basket', 'Delivery', 'Done']} current={1} />);
    expect(steps).toContain('Step 2 of 3');
    expect(steps).toContain('steps__step--done');
    expect(steps).toContain('aria-current="step"');
    expect(render(<Skeleton rows={2} />).match(/skeleton__bar/g)).toHaveLength(2);
  });
});
