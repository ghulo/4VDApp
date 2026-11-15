import { FileImage, FilePdf, Paperclip, Plus } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';
import { canManage } from '../auth/roles';
import { useCurrentUser } from '../auth/useAuth';
import { useT } from '../i18n/useT';
import { filesApi } from '../services/api';
import { mediaSrc } from '../services/apiClient';
import type { AttachmentEntity } from '../services/types';
import { errorMessage } from '../utils/errors';
import { formatDate } from '../utils/format';
import { Button, Card, RemoveButton } from './ui';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Files kept on a record: a contract, a delivery note, a photo of a receipt.
 * Drop them on the card or pick them; a removed one goes to the recycle bin.
 */
export function FilesCard({ on, id }: { on: AttachmentEntity; id: number }) {
  const t = useT();
  const { role } = useCurrentUser();
  const queryClient = useQueryClient();
  const key = ['files', on, id] as const;
  const files = useQuery({ queryKey: key, queryFn: () => filesApi.list(on, id) });
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const add = useMutation({
    // One at a time, so a big batch doesn't hit the server all at once.
    mutationFn: async (picked: File[]) => {
      for (const file of picked) await filesApi.add(on, id, file);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (fileId: number) => filesApi.remove(fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['bin'] });
    },
  });
  const list = files.data ?? [];

  function take(picked: File[]) {
    setProblem(null);
    const tooBig = picked.find((file) => file.size > MAX_BYTES);
    if (tooBig) {
      setProblem(t.files.tooBig(tooBig.name));
      return;
    }
    const wrong = picked.find((file) => !ACCEPT.split(',').includes(file.type));
    if (wrong) {
      setProblem(t.files.wrongKind(wrong.name));
      return;
    }
    if (picked.length > 0) add.mutate(picked);
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    take(picked);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    take(Array.from(event.dataTransfer.files));
  }

  const error = problem ?? (add.isError ? errorMessage(add.error) : remove.isError ? errorMessage(remove.error) : null);

  return (
    <div
      className={dragging ? 'files-drop files-drop--over' : 'files-drop'}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <Card
        title={t.files.title}
        description={list.length === 0 ? t.files.hint : undefined}
        actions={
          <>
            <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={pick} />
            <Button size="sm" icon={Plus} loading={add.isPending} disabled={add.isPending} onClick={() => input.current?.click()}>
              {t.files.add}
            </Button>
          </>
        }
      >
        {list.length > 0 && (
          <ul className="files-list">
            {list.map((file) => {
              const Icon = file.mime === 'application/pdf' ? FilePdf : FileImage;
              return (
                <li key={file.id}>
                  <Icon size={20} aria-hidden="true" className="files-list__icon" />
                  <span className="files-list__text">
                    <a href={mediaSrc(file.url)!} target="_blank" rel="noreferrer">
                      {file.name}
                      <span className="visually-hidden"> {t.firm.newTab}</span>
                    </a>
                    <span className="table__secondary">{[sizeText(file.size), file.addedBy, formatDate(file.addedAt)].filter(Boolean).join(' · ')}</span>
                  </span>
                  {canManage(role) && (
                    <RemoveButton aria-label={t.files.removeThis(file.name)} confirm={t.files.removeConfirm} pending={remove.isPending && remove.variables === file.id} onConfirm={() => remove.mutate(file.id)}>
                      {t.files.remove}
                    </RemoveButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {dragging && (
          <p className="files-drop__hint" aria-hidden="true">
            <Paperclip size={18} /> {t.files.dropHere}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}
