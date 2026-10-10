import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { errorMessage } from '../utils/errors';
import { categoriesApi } from '../services/api';
import type { Category } from '../services/types';
import { Button, Card, PageHeader } from '../components/ui';
import { ManagersOnly } from '../components/ManagersOnly';
import { useT } from '../i18n/useT';

export function CategoriesPage() {
  const t = useT();
  const query = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  return (
    <>
      <PageHeader
        title={t.nav.items.stock}
        description={t.categories.description}
      />

      <ManagersOnly note={t.categories.managersOnly}>
        <Card title={t.categories.new}>
          <CategoryForm />
        </Card>

        {query.isPending && <Loading />}
        {query.isError && <ErrorNotice error={query.error} onRetry={() => query.refetch()} />}
        {query.data && query.data.length === 0 && <EmptyState title={t.categories.none}>{t.categories.noneHint}</EmptyState>}
        {query.data && query.data.length > 0 && (
          <ul className="category-list">
            {query.data.map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
          </ul>
        )}
      </ManagersOnly>
    </>
  );
}

function useInvalidateCategories() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['categories'] });
}

function CategoryForm({ category, onDone }: { category?: Category; onDone?: () => void }) {
  const t = useT();
  const invalidate = useInvalidateCategories();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');

  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), description: description.trim() || null };
      return category ? categoriesApi.update(category.id, input) : categoriesApi.create(input);
    },
    onSuccess: () => {
      invalidate();
      if (!category) {
        setName('');
        setDescription('');
      }
      onDone?.();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="category-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">{t.categories.name}</span>
        <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{t.categories.description_}</span>
        <input maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="category-form__actions">
        <Button type="submit" disabled={save.isPending || !name.trim()} variant="primary">
          {category ? t.common.save : t.categories.add}
        </Button>
        {onDone && (
          <Button onClick={onDone}>
            {t.common.cancel}
          </Button>
        )}
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
    </form>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const t = useT();
  const invalidate = useInvalidateCategories();
  const [isEditing, setIsEditing] = useState(false);
  const remove = useMutation({ mutationFn: () => categoriesApi.remove(category.id), onSuccess: invalidate });
  const productCount = category.productCount ?? 0;

  if (isEditing) {
    return (
      <li className="category-list__row category-list__row--editing">
        <CategoryForm category={category} onDone={() => setIsEditing(false)} />
      </li>
    );
  }

  return (
    <li className="category-list__row">
      <div>
        <p className="category-list__name">{category.name}</p>
        {category.description && <p className="category-list__description">{category.description}</p>}
      </div>
      <span className="category-list__count">
        {t.categories.count(productCount)}
      </span>
      <span className="category-list__actions">
        <Button onClick={() => setIsEditing(true)}>
          {t.categories.rename}
        </Button>
        <Button
          variant="danger-text" disabled={productCount> 0 || remove.isPending}
          title={productCount > 0 ? t.categories.moveFirst : undefined}
          onClick={() => remove.mutate()}
        >
          {t.categories.delete}
        </Button>
      </span>
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
    </li>
  );
}
