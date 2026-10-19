import { useNavigate } from 'react-router';
import { ScanBillForm } from '../../components/BillScanParts';
import { Card, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';

/** "A supplier brought goods": photograph their bill; it goes to the owner to check (no costs shown here). */
export function ScanBillPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title={t.staff.bill.title} description={t.scans.scanHint} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
      <Card>
        <ScanBillForm openCheck={false} onDone={() => navigate('/')} />
      </Card>
    </>
  );
}
