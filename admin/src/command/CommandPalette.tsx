import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { productsApi, usersApi } from '../services/api';
import { ROLE_LABEL } from '../utils/format';
import { rankMatches, type Searchable } from './matching';

interface Command extends Searchable {
  id: string;
  group: 'Actions' | 'Pages' | 'Products' | 'People';
  hint?: string;
  to: string;
}

const ACTIONS: Command[] = [
  { id: 'add-product', group: 'Actions', label: 'Add a product', keywords: 'new create item', to: '/products/new' },
  { id: 'invite', group: 'Actions', label: 'Invite someone', keywords: 'add person staff employee team', to: '/people' },
  { id: 'sale', group: 'Actions', label: 'Record a sale', keywords: 'sell new sale', to: '/sales' },
  { id: 'promotion', group: 'Actions', label: 'Start a promotion', keywords: 'discount sale offer', to: '/promotions' },
  { id: 'count', group: 'Actions', label: 'Start a stock count', keywords: 'count shelves inventory', to: '/counts' },
  { id: 'ask', group: 'Actions', label: 'Ask a question', keywords: 'ai assistant help', to: '/ask' },
];

const PAGES: Command[] = [
  ['Overview', '/', 'home dashboard today'],
  ['Approvals', '/approvals', 'requests waiting returns damage'],
  ['Alerts', '/alerts', 'notifications'],
  ['Stock', '/inventory', 'inventory levels reorder'],
  ['Counts', '/counts', 'stock count shelves'],
  ['Products', '/products', 'catalog items'],
  ['Promotions', '/promotions', 'discounts'],
  ['Categories', '/categories', 'groups'],
  ['Sales', '/sales', 'orders history'],
  ['Reports', '/reports', 'profit team revenue export'],
  ['People', '/people', 'users staff team invites'],
  ['Activity', '/activity', 'log history audit'],
  ['Settings', '/settings', 'shop business limits'],
  ['Your profile', '/profile', 'account password email photo devices'],
].map(([label, to, keywords]) => ({ id: `page-${to}`, group: 'Pages' as const, label: label!, to: to!, keywords }));

const GROUP_ORDER: Command['group'][] = ['Actions', 'Pages', 'Products', 'People'];
const MAX_PER_GROUP = 6;

/** Jump anywhere or start something, by typing. Ctrl/Cmd+K opens it. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
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
      group: 'Products',
      label: product.name,
      keywords: product.sku ?? undefined,
      hint: `${product.stock.quantity} in stock`,
      to: `/products/${product.id}`,
    }));
    const peopleCommands: Command[] = (people.data?.items ?? []).map((user) => ({
      id: `user-${user.id}`,
      group: 'People',
      label: user.name,
      keywords: user.email,
      hint: ROLE_LABEL[user.role],
      to: '/people',
    }));
    const ranked = [
      ...rankMatches(trimmed, ACTIONS),
      ...rankMatches(trimmed, PAGES),
      // Products already come back filtered by the server's search.
      ...productCommands,
      ...(trimmed ? rankMatches(trimmed, peopleCommands) : []),
    ];
    return GROUP_ORDER.flatMap((group) => ranked.filter((command) => command.group === group).slice(0, MAX_PER_GROUP));
  }, [trimmed, products.data, people.data]);

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
        aria-label="Search and jump"
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
          placeholder="Search pages, products, people, or type what to do"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <ul id="palette-results" className="palette__results" role="listbox">
          {results.length === 0 && (
            <li className="palette__empty">{products.isFetching ? 'Searching…' : `Nothing matches "${trimmed}".`}</li>
          )}
          {results.map((command, index) => {
            const startsGroup = index === 0 || results[index - 1]!.group !== command.group;
            return (
              <li key={command.id} role="presentation">
                {startsGroup && <p className="palette__group">{command.group}</p>}
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
          <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
