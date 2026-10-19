import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { POWERS, type Grants, type Permissions, type Power, setPermissions } from '../auth/permissions';
import { useT } from '../i18n/useT';
import { NAV_GROUPS, usuallyShownTo } from '../navigation/sections';
import { permissionsApi } from '../services/api';
import type { UserRole } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDateTime } from '../utils/format';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card } from './ui';

const KEY = ['permissions'];
/** The roles that use the full dashboard menu; employees have their own four tabs and family has no dashboard. */
const MENU_ROLES: UserRole[] = ['admin', 'owner', 'accountant'];
const MENU_ITEMS = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.to !== '/');

/** Settings → Roles: what each role may do and which menu pages it sees. The developer's own tool. */
export function RolesPanel() {
  const permissions = useQuery({ queryKey: KEY, queryFn: permissionsApi.get });
  if (permissions.isPending) return <Loading />;
  if (permissions.isError) return <ErrorNotice error={permissions.error} onRetry={() => permissions.refetch()} />;
  return <RolesForm key={JSON.stringify(permissions.data)} initial={permissions.data} />;
}

function RolesForm({ initial }: { initial: Permissions }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [powers, setPowers] = useState<Grants>(initial.powers);
  const [pages, setPages] = useState(() => menuChoices(initial.pages));
  const [saved, setSaved] = useState(false);
  const roles = initial.editableRoles;

  const applied = (next: Permissions) => {
    setPermissions(next);
    queryClient.setQueryData(KEY, next);
    queryClient.invalidateQueries({ queryKey: [...KEY, 'history'] });
    setSaved(true);
  };
  const save = useMutation({ mutationFn: permissionsApi.save, onSuccess: applied });

  const togglePower = (power: Power, role: UserRole) => {
    setSaved(false);
    setPowers((current) => ({
      ...current,
      [power]: current[power].includes(role) ? current[power].filter((held) => held !== role) : [...current[power], role],
    }));
  };
  const togglePage = (path: string, role: UserRole) => {
    setSaved(false);
    setPages((current) => ({ ...current, [path]: { ...current[path]!, [role]: !current[path]![role] } }));
  };

  const changed = JSON.stringify(powers) !== JSON.stringify(initial.powers) || JSON.stringify(pageOverrides(pages)) !== JSON.stringify(initial.pages);
  const isDefault = POWERS.every((power) => sameRoles(initial.powers[power], initial.defaults[power])) && Object.keys(initial.pages).length === 0;

  return (
    <div className="roles-panel">
      <Card title={t.permissions.powersTitle} description={t.permissions.powersHint} flush>
        <RoleTable
          caption={t.permissions.powersTitle}
          firstHeader={t.permissions.power}
          roles={roles}
          rows={POWERS.map((power) => ({
            id: power,
            title: t.permissions.powers[power].title,
            hint: initial.lockedPowers.includes(power) ? t.permissions.locked : t.permissions.powers[power].hint,
            locked: initial.lockedPowers.includes(power),
            has: (role) => powers[power].includes(role),
            onToggle: (role) => togglePower(power, role),
          }))}
        />
      </Card>

      <Card title={t.permissions.pagesTitle} description={t.permissions.pagesHint} flush>
        <RoleTable
          caption={t.permissions.pagesTitle}
          firstHeader={t.permissions.page}
          roles={MENU_ROLES}
          rows={MENU_ITEMS.map((item) => ({
            id: item.to,
            title: t.nav.items[item.key],
            has: (role) => pages[item.to]![role] ?? false,
            onToggle: (role) => togglePage(item.to, role),
          }))}
        />
      </Card>

      <div className="roles-panel__actions" data-ui-actions>
        <Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate({ powers, pages: pageOverrides(pages) })}>
          {t.permissions.save}
        </Button>
        <Button
          variant="ghost"
          disabled={isDefault || save.isPending}
          onClick={() => {
            if (window.confirm(t.permissions.resetConfirm)) save.mutate({ powers: initial.defaults, pages: {} });
          }}
        >
          {t.permissions.reset}
        </Button>
        {saved && !changed && (
          <p className="form-success" role="status">
            {t.permissions.saved}
          </p>
        )}
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
      </div>

      <RoleHistory onRestored={applied} />
    </div>
  );
}

interface Row {
  id: string;
  title: string;
  hint?: string;
  locked?: boolean;
  has: (role: UserRole) => boolean;
  onToggle: (role: UserRole) => void;
}

/** Rows of things, a column per role, a tick where the role has it. The developer's column is always ticked. */
function RoleTable({ caption, firstHeader, roles, rows }: { caption: string; firstHeader: string; roles: UserRole[]; rows: Row[] }) {
  const t = useT();
  return (
    <div className="roles-grid__scroll">
      <table className="table roles-grid">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{firstHeader}</th>
            <th scope="col" className="roles-grid__role">
              {t.common.roles.developer}
            </th>
            {roles.map((role) => (
              <th key={role} scope="col" className="roles-grid__role">
                {t.common.roles[role]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="roles-grid__what">
                <span className="roles-grid__title">{row.title}</span>
                {row.hint && <span className="table__secondary">{row.hint}</span>}
              </th>
              <td className="roles-grid__cell">
                <input type="checkbox" checked disabled aria-label={t.permissions.cell(t.common.roles.developer, row.title)} />
              </td>
              {roles.map((role) => (
                <td key={role} className="roles-grid__cell">
                  <input
                    type="checkbox"
                    checked={row.has(role)}
                    disabled={row.locked}
                    onChange={() => row.onToggle(role)}
                    aria-label={t.permissions.cell(t.common.roles[role], row.title)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The last changes, each with a key to put the rules back as they were before it. */
function RoleHistory({ onRestored }: { onRestored: (next: Permissions) => void }) {
  const t = useT();
  const history = useQuery({ queryKey: [...KEY, 'history'], queryFn: permissionsApi.history });
  const restore = useMutation({ mutationFn: permissionsApi.restore, onSuccess: onRestored });

  return (
    <Card title={t.permissions.historyTitle} flush>
      {history.isPending && <Loading />}
      {history.isError && <ErrorNotice error={history.error} onRetry={() => history.refetch()} />}
      {history.data?.length === 0 && <p className="roles-history__empty">{t.permissions.noHistory}</p>}
      {history.data && history.data.length > 0 && (
        <ul className="roles-history">
          {history.data.map((entry) => (
            <li key={entry.id} className="roles-history__row">
              <span className="roles-history__text">
                <span className="roles-grid__title">
                  {[
                    ...entry.changes.map((change) =>
                      t.permissions.change(t.common.roles[change.role], t.permissions.powers[change.power].title, change.on),
                    ),
                    ...(entry.pages > 0 ? [t.permissions.pagesChanged(entry.pages)] : []),
                  ].join('; ')}
                </span>
                <span className="table__secondary">
                  {formatDateTime(entry.at)}
                  {entry.by ? ` · ${entry.by}` : ''}
                </span>
              </span>
              <Button size="sm" variant="ghost" loading={restore.isPending && restore.variables === entry.id} disabled={restore.isPending} onClick={() => restore.mutate(entry.id)}>
                {t.permissions.putBack}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {restore.isError && (
        <p className="form-error" role="alert">
          {errorMessage(restore.error)}
        </p>
      )}
    </Card>
  );
}

type MenuChoices = Record<string, Partial<Record<UserRole, boolean>>>;

/** Who sees each menu page: the saved choice, or the usual rule. */
function menuChoices(saved: Permissions['pages']): MenuChoices {
  return Object.fromEntries(
    MENU_ITEMS.map((item) => [
      item.to,
      Object.fromEntries(MENU_ROLES.map((role) => [role, saved[item.to] ? saved[item.to]!.includes(role) : usuallyShownTo(role, item)])),
    ]),
  );
}

/** Only the pages that differ from the usual rule are saved. */
function pageOverrides(choices: MenuChoices): Permissions['pages'] {
  const overrides: Permissions['pages'] = {};
  for (const item of MENU_ITEMS) {
    const chosen = MENU_ROLES.filter((role) => choices[item.to]![role]);
    const usual = MENU_ROLES.filter((role) => usuallyShownTo(role, item));
    if (!sameRoles(chosen, usual)) overrides[item.to] = chosen;
  }
  return overrides;
}

const sameRoles = (a: UserRole[], b: UserRole[]) => a.length === b.length && a.every((role) => b.includes(role));
