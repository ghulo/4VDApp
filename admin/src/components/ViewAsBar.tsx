import { Eye } from '@phosphor-icons/react';
import { useAuth } from '../auth/useAuth';
import { VIEWABLE_ROLES, startViewingAs, stopViewing } from '../auth/viewAs';
import { useT } from '../i18n/useT';
import { Button, MenuButton } from './ui';

/** Floats over every screen while the developer looks at 4VD as another role: who you are now, switch, or stop. */
export function ViewAsBar() {
  const t = useT();
  const { viewingAs } = useAuth();
  if (!viewingAs) return null;

  const role = t.common.roles[viewingAs];
  return (
    <div className="view-as" role="region" aria-label={t.viewAs.barLabel}>
      <Eye size={18} weight="bold" aria-hidden="true" className="view-as__icon" />
      <p className="view-as__text">
        <strong>{t.viewAs.seeing(role)}</strong>
        <span>{t.viewAs.nothingSavedShort}</span>
      </p>
      <div className="view-as__keys">
        <MenuButton
          label={t.viewAs.switch}
          items={VIEWABLE_ROLES.filter((other) => other !== viewingAs).map((other) => ({
            label: t.common.roles[other],
            onSelect: () => startViewingAs(other),
          }))}
        />
        <Button size="sm" variant="primary" onClick={stopViewing}>
          {t.viewAs.stop}
        </Button>
      </div>
    </div>
  );
}
