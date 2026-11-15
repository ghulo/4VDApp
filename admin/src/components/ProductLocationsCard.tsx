import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { locationsApi } from '../services/api';
import type { ProductLocation, ProductUnit } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatQuantity } from '../utils/format';
import { useLocations } from '../utils/useLocations';
import { ErrorNotice, Loading } from './Feedback';
import { Button, Card, DataTable, Field, useToast } from './ui';

/**
 * How much of a product each location holds, and the shelf minimum where the
 * till sells (below it, the stock list offers to bring more from storage).
 * Nothing shows while the shop has one location.
 */
export function ProductLocationsCard({ productId, productName, unit }: { productId: number; productName: string; unit?: ProductUnit }) {
  const t = useT();
  const { several } = useLocations();
  const places = useQuery({ queryKey: ['locations', 'product', productId], queryFn: () => locationsApi.forProduct(productId), enabled: several });
  if (!several) return null;
  const floor = places.data?.find((place) => place.sellsHere);

  return (
    <Card title={t.locations.where}>
      {places.isPending && <Loading />}
      {places.isError && <ErrorNotice error={places.error} onRetry={() => places.refetch()} />}
      {places.data && (
        <>
          <DataTable
            caption={t.locations.whereCaption(productName)}
            rows={places.data}
            rowKey={(row) => row.id}
            columns={[
              { header: t.locations.field, title: true, cell: (row) => row.name },
              { header: t.moves.quantity, align: 'end', cell: (row) => formatQuantity(row.quantity, unit) },
            ]}
          />
          {floor && <ShelfMinimum productId={productId} productName={productName} floor={floor} />}
        </>
      )}
    </Card>
  );
}

function ShelfMinimum({ productId, productName, floor }: { productId: number; productName: string; floor: ProductLocation }) {
  const t = useT();
  const toast = useToast();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(floor.shelfMinimum === null ? '' : String(floor.shelfMinimum));
  const save = useMutation({
    mutationFn: () => locationsApi.setShelfMinimum(productId, floor.id, value.trim() === '' ? null : Number(value)),
    onSuccess: (rows) => {
      queryClient.setQueryData(['locations', 'product', productId], rows);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast({ title: t.locations.saved });
    },
  });
  const changed = (value.trim() === '' ? null : Number(value)) !== floor.shelfMinimum;
  const valid = value.trim() === '' || Number(value) >= 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (changed && valid) save.mutate();
  }

  if (!canOversee(role)) return null;
  return (
    <form className="adjust-form" onSubmit={handleSubmit}>
      <Field label={`${t.locations.shelfMinimum} (${floor.name})`} hint={t.locations.shelfMinimumHint} narrow>
        <input type="number" inputMode="numeric" min={0} step={1} aria-label={t.locations.shelfMinimumFor(productName)} value={value} onChange={(event) => setValue(event.target.value)} />
      </Field>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" disabled={!changed || !valid || save.isPending} loading={save.isPending}>
        {t.locations.save}
      </Button>
    </form>
  );
}
