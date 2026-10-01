import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { errorMessage } from '../utils/errors';
import { categoriesApi } from '../services/api';
import type { Category } from '../services/types';

export function CategoriesPage() {
  const query = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Categories</h1>
        <p className="page-intro">Every product belongs to one category. People filter by these in the mobile app.</p>
      </header>

      <section className="panel">
        <h2 className="panel__title">New category</h2>
        <CategoryForm />
      </section>

      {query.isPending && <Loading />}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => query.refetch()} />}
      {query.data && query.data.length === 0 && <EmptyState title="No categories yet">Add one above to start your catalog.</EmptyState>}
      {query.data && query.data.length > 0 && (
        <ul className="category-list">
          {query.data.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ul>
      )}
    </>
  );
}

function useInvalidateCategories() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['categories'] });
}

function CategoryForm({ category, onDone }: { category?: Category; onDone?: () => void }) {
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
        <span className="field__label">Name</span>
        <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Description (optional)</span>
        <input maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="category-form__actions">
        <button type="submit" className="button button--primary" disabled={save.isPending || !name.trim()}>
          {category ? 'Save' : 'Add category'}
        </button>
        {onDone && (
          <button type="button" className="button button--quiet" onClick={onDone}>
            Cancel
          </button>
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
        {productCount} {productCount === 1 ? 'product' : 'products'}
      </span>
      <span className="category-list__actions">
        <button type="button" className="button button--quiet" onClick={() => setIsEditing(true)}>
          Rename
        </button>
        <button
          type="button"
          className="button button--quiet button--danger-text"
          disabled={productCount > 0 || remove.isPending}
          title={productCount > 0 ? 'Move or delete its products first' : undefined}
          onClick={() => remove.mutate()}
        >
          Delete
        </button>
      </span>
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
    </li>
  );
}
