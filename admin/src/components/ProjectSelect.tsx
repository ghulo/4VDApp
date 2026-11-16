import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../i18n/useT';
import { projectsApi } from '../services/api';
import type { ProjectTaggable } from '../services/types';
import { errorMessage } from '../utils/errors';
import { useFeatures } from '../utils/useFeatures';
import { Field } from './ui';

/** The open projects, read once and shared by every picker. */
function useProjects(enabled: boolean) {
  return useQuery({ queryKey: ['projects'], queryFn: projectsApi.list, staleTime: 60_000, enabled });
}

/**
 * "Project" on a new bill, expense, stock out or damage. Shows only once
 * Projects is switched on and at least one is open; a closed one stays
 * listed only when it is the one already picked.
 */
export function ProjectSelect({ value, onChange }: { value: number | null; onChange: (projectId: number | null) => void }) {
  const t = useT();
  const { projects: on } = useFeatures();
  const projects = useProjects(on);
  const shown = (projects.data ?? []).filter((project) => !project.closed || project.id === value);
  if (!on || shown.length === 0) return null;
  return (
    <Field label={t.projects.field} hint={t.projects.fieldHint}>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
        <option value="">{t.projects.noProject}</option>
        {shown.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * The project on a saved document: changeable in place by those who may, or
 * just named. Hidden while Projects is off, unless the document has one.
 */
export function ProjectTag({ kind, id, projectId: given, editable, invalidate }: { kind: ProjectTaggable; id: number; projectId?: number | null; editable: boolean; invalidate: unknown[][] }) {
  const t = useT();
  const projectId = given ?? null;
  const queryClient = useQueryClient();
  const { projects: on } = useFeatures();
  const projects = useProjects(on || projectId !== null);
  const save = useMutation({
    mutationFn: (next: number | null) => projectsApi.tag(kind, id, next),
    onSuccess: () => {
      for (const key of [...invalidate, ['projects'], ['activity']]) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  if (!on && projectId === null) return null;
  const list = projects.data ?? [];
  const current = list.find((project) => project.id === projectId) ?? null;
  const shown = list.filter((project) => !project.closed || project.id === projectId);
  if (!editable || !on) return current ? <p className="field-hint">{t.projects.project}: {current.name}</p> : null;
  if (shown.length === 0) return null;
  return (
    <Field label={t.projects.field} narrow error={save.isError ? errorMessage(save.error) : undefined}>
      <select value={projectId ?? ''} disabled={save.isPending} onChange={(event) => save.mutate(event.target.value ? Number(event.target.value) : null)}>
        <option value="">{t.projects.noProject}</option>
        {shown.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
