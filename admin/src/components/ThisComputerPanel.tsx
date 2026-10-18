import { useNavigate } from 'react-router';
import { Segmented } from './BillLines';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, SettingRow } from './ui';
import { useDesktopSetup, useSaveDesktopSetup } from '../desktop/desktopSetup';
import { useT } from '../i18n/useT';

/** Settings, This computer (only inside the Windows app): what it opens at start, and starting with Windows. */
export function ThisComputerPanel() {
  const words = useT().desktop;
  const t = words.thisComputer;
  const navigate = useNavigate();
  const setup = useDesktopSetup();
  const save = useSaveDesktopSetup();

  if (setup.isPending) return <Loading />;
  if (setup.isError) return <ErrorNotice error={setup.error} onRetry={() => setup.refetch()} />;
  const current = setup.data;

  return (
    <Card
      title={t.title}
      description={t.description}
      footer={
        <>
          {save.isError && (
            <span className="form-error" role="alert">
              {words.welcome.saveFailed}
            </span>
          )}
          {save.isSuccess && (
            <span className="form-success" role="status">
              {t.saved}
            </span>
          )}
          <span className="this-computer__version">{t.version(current.version)}</span>
        </>
      }
    >
      <SettingRow title={t.role} description={t.roleHint}>
        <Segmented
          label={t.role}
          value={current.role}
          options={[
            { value: 'counter', label: t.counter },
            { value: 'office', label: t.office },
          ]}
          onChange={(role) => save.mutate({ role })}
        />
      </SettingRow>
      <SettingRow title={t.withWindows} description={current.canOpenAtLogin ? t.withWindowsHint : t.withWindowsUnavailable}>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          aria-label={t.withWindows}
          checked={current.openAtLogin}
          disabled={!current.canOpenAtLogin || save.isPending}
          onChange={(event) => save.mutate({ openAtLogin: event.target.checked })}
        />
      </SettingRow>
      <SettingRow title={t.welcome} description={t.welcomeHint}>
        <Button variant="secondary" onClick={() => navigate('/welcome')}>
          {t.welcomeAction}
        </Button>
      </SettingRow>
    </Card>
  );
}
