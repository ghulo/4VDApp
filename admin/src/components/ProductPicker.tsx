import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { productsApi } from '../services/api';
import type { Product } from '../services/types';
import { Combobox } from './ui';
import { PICKER_SHOWN, useProductSearch } from '../utils/useProductSearch';

interface ProductPickerProps {
  label: string;
  /** The chosen product's id, or '' for none. */
  value: string;
  onPick: (product: Product | null) => void;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  resetAfterPick?: boolean;
  /** Only products with stock. */
  inStock?: boolean;
  /** Products not to offer (already on the list, or not for sale). */
  exclude?: (product: Product) => boolean;
  inToolbar?: boolean;
}

/** Type to find a product among all of them; the server searches as you type. */
export function ProductPicker({ label, value, onPick, placeholder, hint, disabled, required, resetAfterPick, inStock, exclude, inToolbar }: ProductPickerProps) {
  const [text, setText] = useState('');
  const search = useProductSearch(text, { inStock });
  const id = Number(value) || null;
  const listed = id === null ? undefined : search.items.find((product) => product.id === id);
  // A product chosen earlier (or named in the address) that the search no longer lists.
  const chosen = useQuery({
    queryKey: ['products', 'one', id],
    queryFn: () => productsApi.get(id!),
    enabled: id !== null && listed === undefined,
    staleTime: 60_000,
  });
  const [picked, setPicked] = useState<Product | null>(null);
  const chosenProduct = listed ?? (picked?.id === id ? picked : undefined) ?? chosen.data;
  const items = exclude ? search.items.filter((product) => !exclude(product)) : search.items;
  return (
    <Combobox
      label={label}
      placeholder={placeholder}
      hint={hint}
      disabled={disabled}
      required={required}
      resetAfterPick={resetAfterPick}
      inToolbar={inToolbar}
      value={value}
      limit={PICKER_SHOWN}
      options={items.map((product) => ({ value: String(product.id), label: product.name, hint: product.barcode ?? product.sku ?? undefined }))}
      onChange={(next) => {
        const product = next ? (search.items.find((one) => String(one.id) === next) ?? null) : null;
        setPicked(product);
        onPick(product);
      }}
      onSearch={setText}
      searching={search.searching}
      more={search.total > search.items.length}
      chosenLabel={chosenProduct?.name}
    />
  );
}
