import { Funnel, Info, PencilSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { Loading } from '../components/Feedback';
import {
  AreaChart,
  Board,
  type BoardCard,
  Button,
  Calendar,
  Card,
  Combobox,
  DonutChart,
  Field,
  FunnelChart,
  Heatmap,
  Kbd,
  PageHeader,
  Popover,
  Section,
  Skeleton,
  Steps,
  useToast,
} from '../components/ui';
import { formatHeadlineMoney } from '../utils/format';

// A developer's page (/kit) showing the newer kit pieces with made-up data,
// so they can be checked by eye in both themes and on a phone. Not in the menu.

const CUSTOMERS = [
  { value: '1', label: 'Arta Krasniqi', hint: '044 123 456' },
  { value: '2', label: 'Blerim Gashi', hint: '049 555 210' },
  { value: '3', label: 'Çlirim Berisha', hint: 'NUI 811234567' },
  { value: '4', label: 'Dafina Hoxha', hint: '045 778 900' },
  { value: '5', label: 'Ëndrit Morina', hint: '044 909 101' },
  { value: '6', label: 'Market Teuta', hint: 'NUI 810998877' },
];

const DAYS = Array.from({ length: 30 }, (_, index) => {
  const value = Math.round(900 + 400 * Math.sin(index / 3) + index * 18 + (index % 6 === 5 ? 600 : 0));
  return { key: index, label: `${index + 1} Oct`, value, description: `${index + 1} October: ${formatHeadlineMoney(value)}` };
});

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 14 }, (_, index) => String(index + 7).padStart(2, '0'));
const HEAT = WEEKDAYS.map((_, day) => HOURS.map((_, hour) => Math.max(0, Math.round((day >= 5 ? 60 : 30) * Math.sin((hour + 1) / 4.5) + (hour === 10 ? 25 : 0)))));

const START_CARDS: BoardCard[] = [
  { key: 'a', column: 'take', title: 'Arta: 2 sacks of cement', content: <><strong>Arta Krasniqi</strong><br />2 sacks of cement · collect €18</> },
  { key: 'b', column: 'take', title: 'Market Teuta: drinks', content: <><strong>Market Teuta</strong><br />12 crates of water · paid</> },
  { key: 'c', column: 'way', title: 'Blerim: paint', content: <><strong>Blerim Gashi</strong><br />Paint, 3 × 10 L · collect €96</> },
  { key: 'd', column: 'done', title: 'Dafina: tiles', content: <><strong>Dafina Hoxha</strong><br />Tiles, 14 m² · collected €210</> },
];

export function KitPage() {
  const { role } = useCurrentUser();
  const toast = useToast();
  const [customer, setCustomer] = useState('');
  const [step, setStep] = useState(1);
  const [cards, setCards] = useState(START_CARDS);
  const [day, setDay] = useState(() => new Date().toLocaleDateString('en-CA'));
  if (!canManage(role)) return <Navigate to="/" replace />;

  const month = day.slice(0, 7);
  return (
    <>
      <PageHeader title="Kit" description="The newer pieces of 4VD's component kit, with made-up data." />

      <Section title="Tooltips and keys">
        <Card>
          <div className="kit-row">
            <Button icon={PencilSimple} aria-label="Edit the product" />
            <Button icon={Trash} variant="danger" aria-label="Remove the line" />
            <Popover label="Filters" icon={Funnel} title="Show only">
              {(close) => (
                <>
                  <Field label="Supplier">
                    <select defaultValue="">
                      <option value="">Every supplier</option>
                      <option>Viva Fresh</option>
                    </select>
                  </Field>
                  <Button variant="primary" onClick={close}>
                    Apply
                  </Button>
                </>
              )}
            </Popover>
            <Popover label="What is this?" icon={Info} iconOnly side="top">
              The cost of sales is what the products you sold cost you, counted at the price you paid for them.
            </Popover>
            <span className="kit-note">
              Search <Kbd keys={['Ctrl', 'K']} /> · Pay <Kbd keys="F12" /> · Products <kbd>F3</kbd>
            </span>
          </div>
        </Card>
      </Section>

      <Section title="Pick from a long list">
        <Card>
          <Combobox label="Customer" options={CUSTOMERS} value={customer} onChange={setCustomer} placeholder="Type a name or phone" hint="Try “cl” for Çlirim: accents don't matter." />
        </Card>
      </Section>

      <Section title="Messages after an action">
        <Card>
          <div className="kit-row">
            <Button onClick={() => toast({ title: 'Bill saved', detail: 'Stock went up for 12 products.' })}>Saved</Button>
            <Button onClick={() => toast({ title: 'Product removed', tone: 'info', action: { label: 'Undo', onClick: () => toast({ title: 'Product is back' }) } })}>With Undo</Button>
            <Button onClick={() => toast({ title: 'Couldn’t print', detail: 'The printer isn’t answering. Check it is on.', tone: 'danger' })}>Problem</Button>
          </div>
        </Card>
      </Section>

      <Section title="Steps">
        <Card>
          <Steps label="New delivery" steps={['Basket', 'Delivery', 'Payment', 'Done']} current={step} onStep={setStep} />
          <div className="kit-row kit-row--gap">
            <Button size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            <Button size="sm" variant="primary" disabled={step === 3} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Loading">
        <div className="kit-grid">
          <Card title="Lines">
            <Skeleton />
          </Card>
          <Card title="Table rows">
            <Skeleton kind="table" rows={4} />
          </Card>
          <Card title="Loading (as pages use it)">
            <Loading />
          </Card>
        </div>
      </Section>

      <Section title="Charts">
        <div className="kit-grid">
          <Card title="Sales, last 30 days">
            <AreaChart label="Sales, last 30 days" points={DAYS} />
          </Card>
          <Card title="How customers paid">
            <DonutChart
              label="How customers paid"
              total={formatHeadlineMoney(18420)}
              formatOther={formatHeadlineMoney}
              slices={[
                { key: 'cash', label: 'Cash', value: 11200, display: formatHeadlineMoney(11200) },
                { key: 'card', label: 'Card', value: 4800, display: formatHeadlineMoney(4800) },
                { key: 'tab', label: 'On tab', value: 1500, display: formatHeadlineMoney(1500) },
                { key: 'bank', label: 'Bank transfer', value: 620, display: formatHeadlineMoney(620) },
                { key: 'cheque', label: 'Voucher', value: 200, display: formatHeadlineMoney(200) },
                { key: 'mix', label: 'Cash + card', value: 100, display: formatHeadlineMoney(100) },
              ]}
            />
          </Card>
          <Card title="Busy hours">
            <Heatmap
              label="Sales by weekday and hour"
              rows={WEEKDAYS}
              columns={HOURS}
              values={HEAT}
              labelEvery={2}
              describe={(r, c) => `${WEEKDAYS[r]} ${HOURS[c]}:00: ${HEAT[r]![c]} sales`}
            />
          </Card>
          <Card title="Offers this month">
            <FunnelChart
              label="Offers this month"
              stages={[
                { key: 'made', label: 'Offers made', value: 42, display: '42' },
                { key: 'yes', label: 'Accepted', value: 27, display: '27' },
                { key: 'invoiced', label: 'Invoiced', value: 25, display: '25' },
                { key: 'paid', label: 'Paid', value: 19, display: '19' },
              ]}
            />
          </Card>
        </div>
      </Section>

      <Section title="Board">
        <Board
          label="Deliveries"
          columns={[
            { key: 'take', title: 'To take' },
            { key: 'way', title: 'On the way' },
            { key: 'done', title: 'Delivered' },
          ]}
          cards={cards}
          onMove={(key, column) => setCards((list) => list.map((card) => (card.key === key ? { ...card, column } : card)))}
        />
      </Section>

      <Section title="Calendar">
        <Card>
          <Calendar
            label="Deliveries"
            selected={day}
            onSelect={setDay}
            events={[
              { key: 1, date: `${month}-03`, label: 'Arta, cement' },
              { key: 2, date: `${month}-12`, label: 'Teuta, water' },
              { key: 3, date: `${month}-12`, label: 'Blerim, paint' },
              { key: 4, date: `${month}-12`, label: 'Dafina, tiles' },
              { key: 5, date: `${month}-18`, label: 'Late: Ëndrit', late: true },
            ]}
          />
        </Card>
      </Section>
    </>
  );
}
