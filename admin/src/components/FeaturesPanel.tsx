import { Plus } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useT } from '../i18n/useT';
import { projectsApi, settingsApi } from '../services/api';
import type { Project, ShopFeatures, ShopRules } from '../services/types';
import { errorMessage } from '../utils/errors';
import { ErrorNotice, Loading } from './Feedback';
import { Badge, Button, Card, EmptyState, Field, SettingRow, useToast } from './ui';

const FEATURES: Array<keyof ShopFeatures> = ['projects', 'recipes', 'serials'];

/** Settings → Features: switch on the parts few shops need, and the projects list once Projects is on. */
export function FeaturesPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ['settings', 'rules'], queryFn: settingsApi.rules });
  const save = useMutation({
    mutationFn: (features: Partial<ShopFeatures>) => settingsApi.updateRules({ features }),
    onSuccess: (updated: ShopRules) => {
      queryClient.setQueryData(['settings', 'rules'], updated);
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  if (rules.isPending) return <Loading />;
  if (rules.isError) return <ErrorNotice error={rules.error} onRetry={() => rules.refetch()} />;
  const features = rules.data.features;
  const hints: Record<keyof ShopFeatures, string> = { projects: t.features.projectsHint, recipes: t.features.recipesHint, serials: t.features.serialsHint };

  return (
    <>
      <Card
        title={t.features.title}
        description={t.features.hint}
        footer={
          save.isError && (
            <span className="form-error" role="alert">
              {errorMessage(save.error)}
            </span>
          )
        }
      >
        {FEATURES.map((feature) => (
          <SettingRow key={feature} title={t.features[feature]} description={hints[feature]}>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              aria-label={t.features[feature]}
              checked={features[feature]}
              disabled={save.isPending}
              onChange={(event) => save.mutate({ [feature]: event.target.checked })}
            />
          </SettingRow>
        ))}
      </Card>
      {features.projects && <ProjectsPanel />}
    </>
  );
}

/** The projects: add one, close it when the job is over, remove one nothing is on yet. */
function ProjectsPanel() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['activity'] });
  };
  const add = useMutation({
    mutationFn: () => projectsApi.create({ name: name.trim(), note: note.trim() || null }),
    onSuccess: (project) => {
      refresh();
      toast({ title: t.projects.added(project.name) });
      setName('');
      setNote('');
    },
  });
  const change = useMutation({
    mutationFn: ({ id, closed }: { id: number; closed: boolean }) => projectsApi.update(id, { closed }),
    onSuccess: refresh,
    onError: (error) => toast({ title: errorMessage(error), tone: 'danger' }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => projectsApi.remove(id),
    onSuccess: refresh,
    onError: (error) => toast({ title: errorMessage(error), tone: 'danger' }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) add.mutate();
  }

  return (
    <Card title={t.projects.settingsTitle} description={t.projects.settingsHint}>
      <form className="settings-form" onSubmit={submit}>
        <div className="field-row">
          <Field label={t.projects.name}>
            <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t.projects.note}>
            <input maxLength={500} placeholder={t.projects.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        {add.isError && (
          <p className="form-error" role="alert">
            {errorMessage(add.error)}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" icon={Plus} disabled={!name.trim() || add.isPending} loading={add.isPending}>
            {t.projects.add}
          </Button>
        </div>
      </form>
      {projects.isPending && <Loading />}
      {projects.isError && <ErrorNotice error={projects.error} onRetry={() => projects.refetch()} />}
      {projects.data && projects.data.length === 0 && <EmptyState title={t.projects.none}>{t.projects.noneHint}</EmptyState>}
      {projects.data?.map((project: Project) => (
        <SettingRow
          key={project.id}
          title={
            <>
              {project.name} {project.closed && <Badge tone="neutral">{t.projects.closed}</Badge>}
            </>
          }
          description={[project.note, t.projects.documents(project.documents)].filter(Boolean).join(' · ')}
        >
          <div className="toolbar">
            <Button size="sm" variant="ghost" aria-label={project.closed ? t.projects.reopenLabel(project.name) : t.projects.closeLabel(project.name)} disabled={change.isPending} onClick={() => change.mutate({ id: project.id, closed: !project.closed })}>
              {project.closed ? t.projects.reopen : t.projects.close}
            </Button>
            {project.documents === 0 && (
              <Button size="sm" variant="danger-text" aria-label={t.projects.removeLabel(project.name)} disabled={remove.isPending} onClick={() => remove.mutate(project.id)}>
                {t.serials.removeShort}
              </Button>
            )}
          </div>
        </SettingRow>
      ))}
    </Card>
  );
}
