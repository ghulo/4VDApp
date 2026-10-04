import { Plus } from '@phosphor-icons/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
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
    expect(html).toMatch(/<td>Edit<\/td>/);
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

  it('should say "Much more" instead of a huge percent', () => {
    const html = render(<MetricCard label="Revenue" value="€100" change={770.9} />);

    expect(html).toContain('Much more');
    expect(html).toContain('much more than the period before');
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
  it('should draw one bar per day and keep quiet days visible', () => {
    const html = render(<DayBars values={[0, 1, 10]} label="Sales per day" />);

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Sales per day"');
    expect(html.match(/<rect/g)).toHaveLength(3);
    // A faint tick for the empty day, real bars for the others, the latest in ink.
    expect(html.match(/day-bars__empty/g)).toHaveLength(1);
    expect(html).toContain('day-bars__bar--latest');
  });
});
