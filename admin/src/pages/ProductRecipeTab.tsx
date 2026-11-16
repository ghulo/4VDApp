import { Hammer, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { canOversee } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { ErrorNotice, Loading } from '../components/Feedback';
import { Button, ButtonLink, Card, Combobox, Field, useToast } from '../components/ui';
import { useT } from '../i18n/useT';
import { counterApi, makesApi } from '../services/api';
import type { ProductUnit, RecipePart } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatMoney } from '../utils/format';
import { allowsParts } from '../utils/units';
import { useWarnBeforeLeaving } from '../utils/useWarnBeforeLeaving';

interface DraftPart {
  productId: number;
  name: string;
  unit: ProductUnit;
  quantity: string;
  cost: number | null;
}

const readQuantity = (text: string) => Number(text.replace(',', '.'));
const toDraft = (part: RecipePart): DraftPart => ({ productId: part.productId, name: part.name, unit: part.unit, quantity: String(part.quantity), cost: part.cost });

/** Made from: what goes into one of this product, with what one costs in parts. */
export function ProductRecipeTab() {
  const productId = Number(useParams().id);
  const recipe = useQuery({ queryKey: ['makes', 'recipe', productId], queryFn: () => makesApi.recipe(productId) });
  if (recipe.isPending) return <Loading />;
  if (recipe.isError) return <ErrorNotice error={recipe.error} onRetry={() => recipe.refetch()} />;
  // Keyed by what was saved, so a save starts the editor again from the stored parts.
  return <RecipeEditor key={JSON.stringify(recipe.data)} productId={productId} saved={recipe.data} />;
}

function RecipeEditor({ productId, saved }: { productId: number; saved: RecipePart[] }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const editable = canOversee(role);
  const [parts, setParts] = useState<DraftPart[]>(() => saved.map(toDraft));
  const shelf = useQuery({ queryKey: ['products', 'counter-shelf'], queryFn: counterApi.products, staleTime: 60_000, enabled: editable });
  const changed = JSON.stringify(parts.map((part) => [part.productId, readQuantity(part.quantity)])) !== JSON.stringify(saved.map((part) => [part.productId, part.quantity]));
  useWarnBeforeLeaving(changed);

  const options = useMemo(
    () =>
      (shelf.data ?? [])
        .filter((product) => product.id !== productId && !parts.some((part) => part.productId === product.id))
        .map((product) => ({ value: String(product.id), label: product.name, hint: product.barcode ?? product.sku ?? undefined })),
    [shelf.data, parts, productId],
  );

  const problemOf = (part: DraftPart): string | null => {
    const quantity = readQuantity(part.quantity);
    if (!(quantity > 0)) return t.makes.quantityError;
    if (!allowsParts(part.unit) && !Number.isInteger(quantity)) return t.makes.wholeError;
    return null;
  };
  const problems = parts.map(problemOf);
  const valid = changed && problems.every((problem) => problem === null);
  const noCost = parts.filter((part) => part.cost === null).map((part) => part.name);
  const costOfOne = noCost.length === 0 && parts.length > 0 ? parts.reduce((sum, part) => sum + readQuantity(part.quantity) * (part.cost ?? 0), 0) : null;

  const save = useMutation({
    mutationFn: () => makesApi.setRecipe(productId, parts.map((part) => ({ productId: part.productId, quantity: readQuantity(part.quantity) }))),
    onSuccess: (stored) => {
      queryClient.setQueryData(['makes', 'recipe', productId], stored);
      queryClient.invalidateQueries({ queryKey: ['makes', 'products'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      toast({ title: t.makes.recipeSaved });
    },
  });

  function add(picked: string | null) {
    const product = (shelf.data ?? []).find((one) => String(one.id) === picked);
    if (!product) return;
    setParts((now) => [...now, { productId: product.id, name: product.name, unit: product.unit, quantity: '1', cost: product.costPrice ?? null }]);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <Card
      title={t.makes.recipeTitle}
      description={t.makes.recipeHint}
      actions={
        editable &&
        saved.length > 0 &&
        !changed && (
          <ButtonLink size="sm" icon={Hammer} to={`/makes?new=1&product=${productId}`}>
            {t.makes.makeSome}
          </ButtonLink>
        )
      }
    >
      <form className="settings-form" onSubmit={handleSubmit}>
        {editable && <Combobox label={t.makes.addPart} placeholder={t.makes.findPart} value="" resetAfterPick options={options} onChange={add} />}
        {parts.length === 0 ? (
          <p className="field-hint">{t.makes.noParts}</p>
        ) : (
          <ul className="stock-doc-lines">
            {parts.map((part, index) => (
              <li key={part.productId} className="stock-doc-lines__row">
                <span className="stock-doc-lines__name">
                  {part.name}
                  <span className="table__secondary">{part.cost === null ? '–' : formatMoney(part.cost)}</span>
                </span>
                <Field label={t.makes.partQuantityFor(part.name)} narrow error={problems[index] ?? undefined}>
                  <input
                    type="number"
                    inputMode={allowsParts(part.unit) ? 'decimal' : 'numeric'}
                    min={allowsParts(part.unit) ? 0.001 : 1}
                    step={allowsParts(part.unit) ? 0.001 : 1}
                    required
                    disabled={!editable}
                    value={part.quantity}
                    onChange={(event) => setParts((now) => now.map((one) => (one.productId === part.productId ? { ...one, quantity: event.target.value } : one)))}
                  />
                </Field>
                {editable && <Button variant="ghost" icon={X} aria-label={t.makes.removePart(part.name)} onClick={() => setParts((now) => now.filter((one) => one.productId !== part.productId))} />}
              </li>
            ))}
          </ul>
        )}
        {costOfOne !== null && <p className="notice">{t.makes.costOfOne(formatMoney(Math.round(costOfOne * 100) / 100))}</p>}
        {noCost.length > 0 && <p className="field-hint">{t.makes.costUnknown(noCost.join(', '))}</p>}
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        {editable && (
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={!valid || save.isPending} loading={save.isPending}>
              {t.makes.saveRecipe}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
