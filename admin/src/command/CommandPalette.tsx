import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { productsApi, usersApi } from '../services/api';
import { useT } from '../i18n/useT';
import { rankMatches, type Searchable } from './matching';
import { useCurrentUser } from '../auth/useAuth';
import { canManage } from '../auth/roles';
import { type Catalogue, en } from '../i18n/en';

type Group = keyof Catalogue['palette']['groups'];
type ActionKey = keyof Catalogue['palette']['actions'];
type PageKey = keyof Catalogue['palette']['pageKeywords'];

interface Command extends Searchable {
  id: string;
  group: Group;
  hint?: string;
  to: string;
  /** Only for the developer and admins. */
  managersOnly?: boolean;
}

const ACTIONS: Array<{ key: ActionKey; to: string; managersOnly?: boolean }> = [
  { key: 'addProduct', to: '/products/new', managersOnly: true },
  { key: 'invite', to: '/people', managersOnly: true },
  { key: 'sale', to: '/sales' },
  { key: 'promotion', to: '/promotions', managersOnly: true },
  { key: 'count', to: '/counts' },
  { key: 'ask', to: '/ask' },
];

const PAGES: Array<[PageKey, string]> = [
  ['overview', '/'],
  ['inbox', '/inbox'],
  ['report', '/report'],
  ['stock', '/inventory'],
  ['counts', '/counts'],
  ['products', '/products'],
  ['promotions', '/promotions'],
  ['orders', '/orders'],
  ['labels', '/labels'],
  ['categories', '/categories'],
  ['sales', '/sales'],
  ['documents', '/documents'],
  ['carwash', '/carwash'],
  ['cash', '/cash'],
  ['expenses', '/expenses'],
  ['tabs', '/tabs'],
  ['bills', '/bills'],
  ['reports', '/reports'],
  ['people', '/people'],
  ['activity', '/activity'],
  ['settings', '/settings'],
  ['profile', '/profile'],
];

const pageLabel = (t: Catalogue, key: PageKey) => (key === 'profile' ? t.palette.yourProfile : t.nav.items[key]);

/**
 * Commands in the reader's language. The English words are kept as extra
 * keywords, so "stock" still finds Stoku when the dashboard is in Albanian.
 */
function staticCommands(t: Catalogue): { actions: Array<Command>; pages: Command[] } {
  return {
    actions: ACTIONS.map(({ key, to, managersOnly }) => ({
      id: `action-${key}`,
      group: 'actions',
      label: t.palette.actions[key].label,
      keywords: `${t.palette.actions[key].keywords} ${en.palette.actions[key].label} ${en.palette.actions[key].keywords}`,
      to,
      managersOnly,
    })),
    pages: PAGES.map(([key, to]) => ({
      id: `page-${to}`,
      group: 'pages',
      label: pageLabel(t, key),
      keywords: `${t.palette.pageKeywords[key]} ${pageLabel(en, key)} ${en.palette.pageKeywords[key]}`,
      to,
    })),
  };
}

const GROUP_ORDER: Group[] = ['actions', 'pages', 'products', 'people'];
const MAX_PER_GROUP = 6;

/** Jump anywhere or start something, by typing. Ctrl/Cmd+K opens it. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const t = useT();
  const commands = useMemo(() => staticCommands(t), [t]);
  const { role } = useCurrentUser();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();

  // The text is part of the key, so a slow answer for "oa" can't replace the one for "oak".
  const products = useQuery({
    queryKey: ['command', 'products', trimmed],
    queryFn: () => productsApi.list({ page: 1, limit: MAX_PER_GROUP, search: trimmed }),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
  const people = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(1), staleTime: 60_000 });

  const results = useMemo(() => {
    const productCommands: Command[] = (trimmed.length >= 2 ? (products.data?.items ?? []) : []).map((product) => ({
      id: `product-${product.id}`,
      group: 'products',
      label: product.name,
      keywords: product.sku ?? undefined,
      hint: t.palette.inStock(product.stock.quantity),
      to: `/products/${product.id}`,
    }));
    const peopleCommands: Command[] = (people.data?.items ?? []).map((user) => ({
      id: `user-${user.id}`,
      group: 'people',
      label: user.name,
      keywords: user.email,
      hint: t.common.roles[user.role],
      to: '/people',
    }));
    const ranked = [
      ...rankMatches(trimmed, commands.actions.filter((action) => !action.managersOnly || canManage(role))),
      ...rankMatches(trimmed, commands.pages),
      // Products already come back filtered by the server's search.
      ...productCommands,
      ...(trimmed ? rankMatches(trimmed, peopleCommands) : []),
    ];
    return GROUP_ORDER.flatMap((group) => ranked.filter((command) => command.group === group).slice(0, MAX_PER_GROUP));
  }, [trimmed, products.data, people.data, role, t, commands]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  function run(command: Command | undefined) {
    if (!command) return;
    onClose();
    navigate(command.to);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t.palette.label}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={input}
          className="palette__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `palette-${results[active]!.id}` : undefined}
          placeholder={t.palette.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <ul id="palette-results" className="palette__results" role="listbox">
          {results.length === 0 && (
            <li className="palette__empty">{products.isFetching ? t.palette.searching : t.palette.nothing(trimmed)}</li>
          )}
          {results.map((command, index) => {
            const startsGroup = index === 0 || results[index - 1]!.group !== command.group;
            return (
              <li key={command.id} role="presentation">
                {startsGroup && <p className="palette__group">{t.palette.groups[command.group]}</p>}
                <button
                  id={`palette-${command.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className="palette__item"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span>{command.label}</span>
                  {command.hint && <span className="palette__hint">{command.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="palette__footer">
          <kbd>↑</kbd> <kbd>↓</kbd> {t.palette.toMove} <kbd>Enter</kbd> {t.palette.toOpen} <kbd>Esc</kbd> {t.palette.toClose}
        </p>
      </div>
    </div>
  );
}
