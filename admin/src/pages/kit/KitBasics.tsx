import { DownloadSimple, MagnifyingGlass, Package, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { ChipChoice } from '../../components/ChipChoice';
import { ErrorNotice } from '../../components/Feedback';
import { Pagination } from '../../components/Pagination';
import { PeriodPicker } from '../../components/PeriodPicker';
import { SearchInput } from '../../components/SearchInput';
import { StockTag } from '../../components/StockTag';
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
  MenuButton,
  MetricCard,
  MetricGrid,
  PasswordField,
  RemoveButton,
  Section,
  SettingRow,
  Sheet,
  StatGrid,
  StatTile,
  type Tone,
  Tooltip,
} from '../../components/ui';
import { formatMoney } from '../../utils/format';
import type { PeriodKey } from '../../utils/periods';

// The everyday kit pieces, with made-up data, so a change to one can be
// tried on /kit before it shows on every page. Buttons, fields, figures,
// tables, notices, panels and the smaller charts.

const TONES: Tone[] = ['neutral', 'ok', 'warn', 'danger', 'info', 'brand'];
// Real words for each tone, as pages use them.
const TONE_WORDS: Record<Tone, string> = { neutral: 'Draft', ok: 'Paid', warn: 'Due Friday', danger: 'Overdue', info: 'Imported', brand: 'Owner' };

interface Row {
  id: number;
  name: string;
  supplier: string;
  stock: number;
  price: number;
}

const ROWS: Row[] = [
  { id: 1, name: 'Cement 25 kg', supplier: 'Viva Fresh', stock: 42, price: 6.5 },
  { id: 2, name: 'Paint, white 10 L', supplier: 'Dekor', stock: 3, price: 32 },
  { id: 3, name: 'Water 1.5 L', supplier: 'Rugove', stock: 0, price: 0.45 },
  { id: 4, name: 'Tiles 30 × 30', supplier: 'Dekor', stock: 118, price: 14.9 },
];

const WEEK = [820, 1140, 960, 1310, 1720, 2140, 1480];

export function KitBasics() {
  const [name, setName] = useState('Cement 25 kg');
  const [day, setDay] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'cards' | 'board'>('list');
  const [period, setPeriod] = useState<{ period: PeriodKey; from: string; to: string }>({ period: 'this-month', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [onTab, setOnTab] = useState(true);
  const [sheet, setSheet] = useState<'side' | 'center' | null>(null);
  const [removed, setRemoved] = useState(false);
  const rows = ROWS.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Section title="Buttons" description="Every look, both sizes, and the states: loading (with and without an icon), disabled, icon only, with a shortcut.">
        <Card>
          <div className="kit-row kit-row--gap">
            <Button variant="primary" icon={Plus}>
              Primary
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger-text" icon={Trash}>
              Remove
            </Button>
            <Button variant="danger">Yes, remove (only in a confirm)</Button>
          </div>
          <div className="kit-row kit-row--gap">
            <Button size="sm" variant="primary">
              Small
            </Button>
            <Button size="sm">Small secondary</Button>
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button variant="primary" icon={Plus} loading>
              Adding
            </Button>
            <Button disabled>Disabled</Button>
            <Button icon={PencilSimple} aria-label="Edit" />
            <ButtonLink to="/kit" icon={DownloadSimple} variant="secondary">
              A link like a button
            </ButtonLink>
          </div>
          <div className="kit-row kit-row--gap">
            <Button variant="primary" shortcut="F12">
              Pay
            </Button>
            <Button shortcut="Ctrl S">Save</Button>
            <MenuButton
              label="Export"
              icon={DownloadSimple}
              variant="secondary"
              items={[
                { label: 'Excel', shortcut: 'E', onSelect: () => undefined },
                { label: 'PDF', shortcut: 'P', onSelect: () => undefined },
              ]}
            />
            {removed ? (
              <Button size="sm" onClick={() => setRemoved(false)}>
                Bring it back
              </Button>
            ) : (
              <RemoveButton confirm="Remove this line?" onConfirm={() => setRemoved(true)}>
                Remove
              </RemoveButton>
            )}
            <Tooltip label="Opens the product search" shortcut="F3">
              <Button icon={MagnifyingGlass}>With a tooltip</Button>
            </Tooltip>
          </div>
        </Card>
      </Section>

      <Section title="Badges and tags">
        <Card>
          <div className="kit-row kit-row--gap">
            {TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {TONE_WORDS[tone]}
              </Badge>
            ))}
          </div>
          <div className="kit-row kit-row--gap">
            <StockTag quantity={42} reorderLevel={10} />
            <StockTag quantity={3} reorderLevel={10} />
            <StockTag quantity={0} reorderLevel={10} />
          </div>
          <div className="kit-row kit-row--gap">
            <Avatar name="Arta Krasniqi" url={null} />
            <Avatar name="Blerim Gashi" url={null} />
            <Avatar name="Çlirim Berisha" url={null} />
            <Avatar name="Dafina Hoxha" url={null} />
            <Avatar name="Ëndrit Morina" url={null} size={28} />
            <Avatar name="Teuta Krasniqi" url={null} size={28} />
          </div>
          <div className="stock-hero">
            <StockTag quantity={118} reorderLevel={10} size="large" />
            <p className="stock-hero__note">Alert when it drops to 10</p>
          </div>
          <div className="stock-hero">
            <StockTag quantity={4} reorderLevel={10} size="large" />
            <p className="stock-hero__warning">
              <Badge tone="warn">Stock is at or below the reorder level (10)</Badge>
            </p>
          </div>
        </Card>
      </Section>

      <Section title="Fields" description="A hint, an error, disabled, and the special fields.">
        <div className="kit-grid">
          <Card title="Text">
            <Field label="Product name" hint="As it shows on the receipt.">
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Price" error="Write a price above 0.">
              <input inputMode="decimal" defaultValue="0" aria-invalid="true" />
            </Field>
            <Field label="Barcode (disabled)">
              <input disabled defaultValue="3800123456789" />
            </Field>
            <Field label="Notes">
              <textarea rows={3} defaultValue="Ask the supplier about the bigger sacks." />
            </Field>
          </Card>
          <Card title="Choices">
            <Field label="Supplier">
              <select defaultValue="dekor">
                <option value="viva">Viva Fresh</option>
                <option value="dekor">Dekor</option>
              </select>
            </Field>
            <DateField value={day} onChange={setDay} aria-label="Day" />
            <label className="toggle">
              <input type="checkbox" checked={onTab} onChange={(event) => setOnTab(event.target.checked)} />
              On the customer's tab
            </label>
            <ChipChoice
              label="Show as"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List' },
                { value: 'cards', label: 'Cards' },
                { value: 'board', label: 'Board' },
              ]}
            />
            <PasswordField label="Password" hint="At least 8 characters." autoComplete="new-password" />
          </Card>
        </div>
        <Card>
          <PeriodPicker period={period.period} from={period.from} to={period.to} onChange={setPeriod} />
        </Card>
      </Section>

      <Section title="Figures">
        <StatGrid>
          <StatTile label="Takings today" value={formatMoney(1482.4)} hint="34 sales" />
          <StatTile label="Low on stock" value="7" tone="warn" to="/kit" />
          <StatTile label="Out of stock" value="2" tone="danger" />
          <StatTile label="Shop till" named value={formatMoney(312.5)} />
        </StatGrid>
        <MetricGrid title="This month">
          <MetricCard label="Sales" value={formatMoney(38420)} change={0.12} />
          <MetricCard label="Profit" value={formatMoney(6120)} change={-0.04} />
          <MetricCard label="Customers" value="412" change={null} hint="Who paid by name or card" />
        </MetricGrid>
      </Section>

      <Section title="Table">
        <Card flush>
          <DataTable
            caption="Products"
            rows={rows}
            rowKey={(row) => row.id}
            toolbar={<SearchInput value={search} onChange={setSearch} label="Search products" />}
            empty={<EmptyState title="No product matches" icon={Package}>Try fewer letters.</EmptyState>}
            columns={[
              { header: 'Product', cell: (row) => row.name, title: true, sortValue: (row) => row.name },
              { header: 'Supplier', cell: (row) => row.supplier, sortValue: (row) => row.supplier },
              { header: 'Stock', align: 'end', sortValue: (row) => row.stock, cell: (row) => <StockTag quantity={row.stock} reorderLevel={10} /> },
              { header: 'Price', align: 'end', sortValue: (row) => row.price, sortFirst: 'desc', cell: (row) => formatMoney(row.price) },
            ]}
            totals={['Total', '', String(rows.reduce((sum, row) => sum + row.stock, 0)), '']}
          />
          <Pagination meta={{ page, limit: 4, total: 37 }} onPageChange={setPage} itemLabel="products" />
        </Card>
      </Section>

      <Section title="Notices and empty states">
        <div className="kit-grid">
          <Card>
            <div className="notice notice--warn">
              <p>The fiscal printer isn't answering. Sales still save; receipts print when it's back.</p>
            </div>
            <ErrorNotice error={new Error('The server didn’t answer. Check the internet.')} onRetry={() => undefined} />
            <p className="form-error" role="alert">
              This barcode is already on another product.
            </p>
          </Card>
          <Card>
            <EmptyState title="No bills yet" art action={<Button variant="primary">Add a bill</Button>}>
              Bills you add or scan show here.
            </EmptyState>
          </Card>
        </div>
      </Section>

      <Section title="Cards and settings">
        <Card
          title="Shop details"
          description="On every receipt and bill."
          actions={<Button size="sm">Edit</Button>}
          footer={<span className="kit-note">Changed by Arta, yesterday</span>}
        >
          <SettingRow title="Print a receipt for every sale" description="Customers can still say no.">
            <input type="checkbox" role="switch" className="switch" aria-label="Print a receipt for every sale" defaultChecked />
          </SettingRow>
          <SettingRow title="Ask for the customer at the till" description="Off: sales go to walk-in customers.">
            <input type="checkbox" role="switch" className="switch" aria-label="Ask for the customer at the till" />
          </SettingRow>
          <SettingRow title="Language">
            <select defaultValue="sq" aria-label="Language">
              <option value="sq">Shqip</option>
              <option value="en">English</option>
            </select>
          </SettingRow>
        </Card>
        <Card className="card--danger" title="Wipe the shop's data" description="Sales, bills and stock go. Products and people stay. This can't be undone.">
          <Button variant="danger-text">Wipe the data…</Button>
        </Card>
      </Section>

      <Section title="Panels">
        <Card>
          <div className="kit-row kit-row--gap">
            <Button onClick={() => setSheet('side')}>Form card</Button>
            <Button onClick={() => setSheet('center')}>Centred question</Button>
          </div>
        </Card>
        <Sheet open={sheet === 'side'} onClose={() => setSheet(null)} title="New product" description="Grows out of the key that opened it; on a phone it rises from the bottom and pulls back down. Ctrl Enter saves.">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSheet(null);
            }}
          >
            <Field label="Name">
              <input defaultValue="Cement 25 kg" />
            </Field>
            <div className="field-row">
              <Field label="Price">
                <input inputMode="decimal" defaultValue="6.50" />
              </Field>
              <Field label="Cost">
                <input inputMode="decimal" defaultValue="4.80" />
              </Field>
            </div>
            <Field label="Barcode">
              <input inputMode="numeric" defaultValue="5310000000017" />
            </Field>
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setSheet(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </Sheet>
        <Sheet open={sheet === 'center'} onClose={() => setSheet(null)} title="Remove this bill?" description="Stock goes back down. This can't be undone." placement="center">
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setSheet(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => setSheet(null)}>
              Yes, remove
            </Button>
          </div>
        </Sheet>
      </Section>

      <Section title="Smaller charts">
        <div className="kit-grid">
          <Card title="Best sellers">
            <BarList
              label="Best sellers"
              items={ROWS.map((row) => ({ key: row.id, label: row.name, value: row.stock * row.price, display: formatMoney(row.stock * row.price) }))}
            />
          </Card>
          <Card title="This week">
            <ColumnChart
              label="Takings this week"
              columns={WEEK.map((value, index) => ({ key: index, label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index], description: formatMoney(value), value }))}
            />
          </Card>
          <Card title="Day by day">
            <DayBars label="Sales day by day" values={[...WEEK, ...WEEK, ...WEEK, ...WEEK]} />
          </Card>
        </div>
      </Section>
    </>
  );
}
