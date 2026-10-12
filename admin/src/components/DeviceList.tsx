import { AppWindow, DeviceMobile, Desktop, Question } from '@phosphor-icons/react';
import { useState } from 'react';
import { useT } from '../i18n/useT';
import type { Session } from '../services/types';
import { formatDateTime } from '../utils/format';
import { Badge, Button } from './ui';

export interface DeviceGroup {
  device: string;
  sessions: Session[];
  current: boolean;
  lastUsedAt: string | null;
}

const GROUPS_SHOWN = 5;

/**
 * Sessions on the same kind of device (every login from Chrome on Windows)
 * read as one row: a browser that logs in often shouldn't fill the page.
 * This device first, then the most recently used.
 */
function groupDevices(sessions: Session[]): DeviceGroup[] {
  const groups = new Map<string, DeviceGroup>();
  for (const session of sessions) {
    const key = session.current ? `current:${session.device}` : session.device;
    const group = groups.get(key) ?? { device: session.device, sessions: [], current: session.current, lastUsedAt: null };
    group.sessions.push(session);
    if ((session.lastUsedAt ?? '') > (group.lastUsedAt ?? '')) group.lastUsedAt = session.lastUsedAt;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.current) - Number(a.current) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''),
  );
}

function deviceIcon(device: string) {
  if (device === '4VD app') return AppWindow;
  if (/iPhone|iPad|Android/.test(device)) return DeviceMobile;
  if (device === 'Unknown device') return Question;
  return Desktop;
}

/** Devices logged in, grouped; with `onEnd`, each group can be logged out. */
export function DeviceList({ sessions, onEnd, busy }: { sessions: Session[]; onEnd?: (group: DeviceGroup) => void; busy?: boolean }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const groups = groupDevices(sessions);
  const shown = showAll ? groups : groups.slice(0, GROUPS_SHOWN);

  return (
    <>
      <ul id="device-list" className="device-list">
        {shown.map((group) => {
          const DeviceIcon = deviceIcon(group.device);
          const name = group.device === 'Unknown device' ? t.profile.unknownDevice : group.device;
          return (
            <li key={`${group.current}-${group.device}`} className="device-list__row">
              <span className="device-list__icon" aria-hidden="true">
                <DeviceIcon size={20} />
              </span>
              <span className="device-list__text">
                <span className="device-list__name">
                  {name} {group.current && <Badge tone="ok">{t.profile.thisDevice}</Badge>}
                </span>
                <span className="device-list__meta">
                  {group.sessions.length > 1 && `${t.profile.sessions(group.sessions.length)} · `}
                  {group.current ? t.profile.inUseNow : group.lastUsedAt ? t.profile.lastUsed(formatDateTime(group.lastUsedAt)) : t.profile.untracked}
                </span>
              </span>
              {onEnd && !group.current && (
                <Button size="sm" disabled={busy} aria-label={t.profile.logOutDevice(name)} onClick={() => onEnd(group)}>
                  {t.profile.logOut}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {groups.length > GROUPS_SHOWN && (
        <p className="device-list__more">
          <Button size="sm" variant="ghost" aria-expanded={showAll} aria-controls="device-list" onClick={() => setShowAll(!showAll)}>
            {showAll ? t.profile.showFewerDevices : t.profile.showAllDevices(groups.length)}
          </Button>
        </p>
      )}
    </>
  );
}
