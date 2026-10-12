import { Drop, RocketLaunch, Scales, Storefront, Warning } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { BusinessPanel } from '../components/BusinessPanel';
import { CarwashesPanel } from '../components/CarwashesPanel';
import { LaunchChecklist } from '../components/LaunchChecklist';
import { WipeDataPanel } from '../components/WipeDataPanel';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Button, Card, PageHeader, SettingRow, SettingsLayout } from '../components/ui';
import { settingsApi } from '../services/api';
import type { AppSettings } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ManagersOnly } from '../components/ManagersOnly';
import { useT } from '../i18n/useT';

export function SettingsPage() {
  const t = useT();
  const { role } = useCurrentUser();
  const isDeveloper = role === 'developer';
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const launch = useQuery({ queryKey: ['settings', 'launch-checklist'], queryFn: settingsApi.launchChecklist, enabled: isDeveloper });
  const launchDone = launch.data?.filter((step) => step.done).length;

  return (
    <>
      <PageHeader
        title={t.settings.title}
        description={t.settings.description}
      />
      <SettingsLayout
        base="/settings"
        sections={[
          {
            id: 'shop',
            label: t.business.title,
            icon: Storefront,
            content: (
              <ManagersOnly note={t.settings.managersOnly}>
                <BusinessPanel />
              </ManagersOnly>
            ),
          },
          {
            id: 'approvals',
            label: t.settings.approvals,
            icon: Scales,
            content: (
              <ManagersOnly>
                {settings.isPending && <Loading />}
                {settings.isError && <ErrorNotice error={settings.error} onRetry={() => settings.refetch()} />}
                {settings.data && <SettingsForm initial={settings.data} />}
              </ManagersOnly>
            ),
          },
          {
            id: 'carwashes',
            label: t.carwashes.title,
            icon: Drop,
            content: (
              <ManagersOnly>
                <CarwashesPanel />
              </ManagersOnly>
            ),
          },
          // The developer's own tools come last: the shop's settings are what the owner opens this page for.
          ...(isDeveloper
            ? [
                {
                  id: 'launch',
                  label: t.launch.title,
                  icon: RocketLaunch,
                  note: launch.data && `${launchDone}/${launch.data.length}`,
                  content: <LaunchChecklist />,
                },
                { id: 'wipe', label: t.wipe.title, icon: Warning, content: <WipeDataPanel /> },
              ]
            : []),
        ]}
      />
    </>
  );
}

function SettingsForm({ initial }: { initial: AppSettings }) {
  const queryClient = useQueryClient();
  const t = useT();
  const [limit, setLimit] = useState(String(initial.refundApprovalLimit));
  const [windowDays, setWindowDays] = useState(String(initial.returnWindowDays));
  const [minimumMargin, setMinimumMargin] = useState(String(initial.minimumMarginPercent));
  const [floatShop, setFloatShop] = useState(String(initial.cashFloatShop));
  const [discountLimit, setDiscountLimit] = useState(String(initial.employeeDiscountLimit));
  const [paymentTerms, setPaymentTerms] = useState(String(initial.paymentTermsDays));
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      settingsApi.update({
        refundApprovalLimit: Number(limit),
        returnWindowDays: Number(windowDays),
        minimumMarginPercent: Number(minimumMargin),
        cashFloatShop: Number(floatShop),
        employeeDiscountLimit: Number(discountLimit),
        paymentTermsDays: Number(paymentTerms),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated);
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setSaved(true);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  }

  const isValid =
    limit !== '' &&
    Number(limit) >= 0 &&
    windowDays !== '' &&
    Number.isInteger(Number(windowDays)) &&
    Number(windowDays) >= 0 &&
    minimumMargin !== '' &&
    Number(minimumMargin) >= 0 &&
    floatShop !== '' &&
    Number(floatShop) >= 0 &&
    discountLimit !== '' &&
    Number(discountLimit) >= 0 &&
    Number(discountLimit) <= 100 &&
    paymentTerms !== '' &&
    Number.isInteger(Number(paymentTerms)) &&
    Number(paymentTerms) >= 0 &&
    Number(paymentTerms) <= 365;
  // Save only turns orange once there's something to save, so one card at a time asks for action.
  const hasChanges =
    Number(limit) !== initial.refundApprovalLimit ||
    Number(windowDays) !== initial.returnWindowDays ||
    Number(minimumMargin) !== initial.minimumMarginPercent ||
    Number(floatShop) !== initial.cashFloatShop ||
    Number(discountLimit) !== initial.employeeDiscountLimit ||
    Number(paymentTerms) !== initial.paymentTermsDays;

  return (
    <form onSubmit={handleSubmit}>
      <Card
        title={t.settings.approvals}
        description={t.settings.approvalsHint}
        footer={
          <>
            {save.isError && (
              <span className="form-error" role="alert">
                {errorMessage(save.error)}
              </span>
            )}
            {saved && !save.isError && (
              <span className="form-success" role="status">
                {t.settings.saved}
              </span>
            )}
            <Button type="submit" variant={hasChanges ? 'primary' : 'secondary'} disabled={!isValid || save.isPending}>
              {save.isPending ? t.settings.saving : t.settings.saveChanges}
            </Button>
          </>
        }
      >
        <SettingRow
          title={t.settings.refundLimit}
          description={t.settings.refundLimitHint}
        >
          <span className="unit-input">
            <span aria-hidden="true">€</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              aria-label={t.settings.refundLimitLabel}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </span>
        </SettingRow>
        <SettingRow
          title={t.settings.window}
          description={t.settings.windowHint}
        >
          <span className="unit-input">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label={t.settings.windowLabel}
              value={windowDays}
              onChange={(event) => setWindowDays(event.target.value)}
            />
            <span aria-hidden="true">{t.settings.days}</span>
          </span>
        </SettingRow>
        <SettingRow
          title={t.settings.margin}
          description={t.settings.marginHint}
        >
          <span className="unit-input">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              aria-label={t.settings.marginLabel}
              value={minimumMargin}
              onChange={(event) => setMinimumMargin(event.target.value)}
            />
            <span aria-hidden="true">%</span>
          </span>
        </SettingRow>
        <SettingRow title={t.settings.floatShop} description={t.settings.floatShopHint}>
          <span className="unit-input">
            <span aria-hidden="true">€</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              aria-label={t.settings.floatShopLabel}
              value={floatShop}
              onChange={(event) => setFloatShop(event.target.value)}
            />
          </span>
        </SettingRow>
        <SettingRow title={t.settings.discountLimit} description={t.settings.discountLimitHint}>
          <span className="unit-input">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.5}
              aria-label={t.settings.discountLimitLabel}
              value={discountLimit}
              onChange={(event) => setDiscountLimit(event.target.value)}
            />
            <span aria-hidden="true">%</span>
          </span>
        </SettingRow>
        <SettingRow title={t.settings.paymentTerms} description={t.settings.paymentTermsHint}>
          <span className="unit-input">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              step={1}
              aria-label={t.settings.paymentTermsLabel}
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value)}
            />
            <span aria-hidden="true">{t.settings.days}</span>
          </span>
        </SettingRow>
      </Card>
    </form>
  );
}
