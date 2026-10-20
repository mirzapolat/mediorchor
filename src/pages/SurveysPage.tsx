import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  EyeOff,
  Globe,
  Link2,
  MessageSquareText,
  PencilLine,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { HeaderAction } from '@/components/HeaderAction';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { PageSpinner } from '@/components/Spinner';
import { LifecycleBadge } from '@/components/Lifecycle';
import { OverflowMenu } from '@/components/OverflowMenu';
import { useProjectContext } from '@/layouts/projectContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { formDate, templateStructure, type FormOverviewRow, type FormTemplate } from '@/lib/forms';
import type { FormState } from '@shared/forms';

interface ParticipantForm {
  id: string;
  title: string;
  token: string;
  state: FormState;
  opens_at: string | null;
  closes_at: string | null;
  identity: 'named' | 'confidential' | 'anonymous';
  my: 'none' | 'draft' | 'answered';
}

const TEMPLATES: { id: FormTemplate; label: TranslationKey; hint: TranslationKey }[] = [
  { id: 'blank', label: 'templateBlank', hint: 'templateBlankHint' },
  { id: 'dates', label: 'templateDates', hint: 'templateDatesHint' },
  { id: 'food', label: 'templateFood', hint: 'templateFoodHint' },
  { id: 'feedback', label: 'templateFeedback', hint: 'templateFeedbackHint' },
];

// "Umfragen": managers see every form of the project with its state,
// visibility, deadline and responses; participants the listed ones with
// their own state.
export const SurveysPage = () => {
  const { canManage } = useProjectContext();
  return canManage ? <ManagerSurveys /> : <ParticipantSurveys />;
};

const ManagerSurveys = () => {
  const { t, lang } = useI18n();
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormOverviewRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<FormTemplate>('blank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.rpc('form_overview', { p_project_id: project.id });
    setForms((data as FormOverviewRow[] | null) ?? []);
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await api.rpc('form_create', {
      p_project_id: project.id,
      p_title: title.trim(),
      p_structure: templateStructure(template, t),
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    track('survey-create', { template });
    navigate((data as { id: string }).id);
  };

  const duplicate = async (form: FormOverviewRow) => {
    const { data } = await api.rpc('form_duplicate', { p_form_id: form.id, p_suffix: t('copySuffix') });
    if (data) navigate((data as { id: string }).id);
  };

  if (!forms) return <PageSpinner />;
  const active = forms.filter((f) => f.state !== 'archived');
  const archived = forms.filter((f) => f.state === 'archived');

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t('surveys')}
        inlineActions
        actions={
          <HeaderAction
            icon={Plus}
            label={t('newSurvey')}
            onClick={() => {
              setTitle('');
              setTemplate('blank');
              setError(null);
              setCreating(true);
            }}
          />
        }
      />

      {active.length === 0 ? (
        <EmptySurveys hint={t('noSurveysHintManager')} />
      ) : (
        <ul className="space-y-2">
          {active.map((f) => (
            <li key={f.id} className="group flex items-center gap-1 rounded-2xl border border-border bg-surface pr-2 transition-shadow hover:shadow-sm">
              <Link to={f.id} className="flex min-w-0 flex-1 items-center gap-3 p-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface-muted text-chart-1">
                  <ClipboardList size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate font-medium">{f.title}</span>
                    <LifecycleBadge state={f.state} />
                    {f.version_number != null && (f.changes === 'structural' || f.changes === 'editorial') && (
                      <span className="rounded bg-surface-muted px-1.5 py-px text-[10px] font-semibold text-text-secondary">
                        {t('surveyUnpublishedChanges')}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
                    <Meta icon={f.listed ? Globe : Link2} text={f.listed ? t('surveyListed') : t('surveyLinkOnly')} />
                    {f.identity === 'anonymous' && <Meta icon={EyeOff} text={t('identityAnonymous')} />}
                    {f.closes_at && <Meta icon={CalendarClock} text={t('surveyClosesShort').replace('{date}', formDate(f.closes_at, lang, false))} />}
                    <Meta icon={MessageSquareText} text={t('surveyResponsesCount').replace('{n}', String(f.responses))} />
                  </span>
                </span>
                <ChevronRight size={16} className="flex-shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
              </Link>
              <OverflowMenu
                label={t('moreActions')}
                items={[{ icon: Copy, label: t('duplicate'), onSelect: () => void duplicate(f) }]}
              />
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="mt-8 rounded-2xl border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-text-secondary">
            {t('lifecycleArchived')} ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-border">
            {archived.map((f) => (
              <li key={f.id}>
                <Link to={f.id} className="flex items-center gap-2 py-2 text-sm hover:underline">
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                  <span className="text-xs text-text-tertiary">{t('surveyResponsesCount').replace('{n}', String(f.responses))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal
        open={creating}
        title={t('newSurvey')}
        onClose={() => setCreating(false)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="survey-form" disabled={busy || !title.trim()}>
              {busy ? t('loading') : t('create')}
            </Button>
          </>
        }
      >
        <form id="survey-form" onSubmit={create} className="space-y-4">
          <Input label={t('title')} value={title} maxLength={200} required autoFocus onChange={(e) => setTitle(e.target.value)} />
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('surveyTemplate')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATES.map((tpl) => (
                <label
                  key={tpl.id}
                  className={cn(
                    'flex cursor-pointer flex-col rounded-xl border p-3 text-sm transition-colors',
                    template === tpl.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-subtle',
                  )}
                >
                  <input
                    type="radio"
                    name="template"
                    value={tpl.id}
                    checked={template === tpl.id}
                    onChange={() => setTemplate(tpl.id)}
                    className="sr-only"
                  />
                  <span className="font-medium">{t(tpl.label)}</span>
                  <span className="mt-0.5 text-xs text-text-secondary">{t(tpl.hint)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-text-tertiary">{t('surveyStartsAsDraft')}</p>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      </Modal>
    </div>
  );
};

const Meta = ({ icon: Icon, text }: { icon: LucideIcon; text: string }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <Icon size={12} />
    {text}
  </span>
);

const EmptySurveys = ({ hint }: { hint: string }) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
        <ClipboardList size={22} />
      </span>
      <p className="mt-3 font-semibold">{t('noSurveys')}</p>
      <p className="mt-1 text-sm text-text-secondary">{hint}</p>
    </div>
  );
};

const MY_STATUS: Record<ParticipantForm['my'], { label: TranslationKey; icon: LucideIcon; tone: string }> = {
  none: { label: 'surveyNotStarted', icon: ClipboardList, tone: 'bg-surface-muted text-text-secondary' },
  draft: { label: 'surveyDraftMine', icon: PencilLine, tone: 'bg-accent/15 text-text' },
  answered: { label: 'surveyAnswered', icon: CheckCircle2, tone: 'bg-success-soft text-success-strong' },
};

const ParticipantSurveys = () => {
  const { t, lang } = useI18n();
  const { project, reloadNav } = useProjectContext();
  const [forms, setForms] = useState<ParticipantForm[] | null>(null);

  useEffect(() => {
    void api.rpc('project_forms', { p_project_id: project.id }).then(({ data }) => setForms((data as ParticipantForm[] | null) ?? []));
    void reloadNav?.();
  }, [project.id, reloadNav]);

  if (!forms) return <PageSpinner />;
  // Unfinished open ones first.
  const rank = (f: ParticipantForm) => (f.state === 'open' ? (f.my === 'answered' ? 1 : 0) : 2);
  const sorted = [...forms].sort((a, b) => rank(a) - rank(b));

  return (
    <div className="max-w-3xl">
      <PageHeader title={t('surveys')} />
      {sorted.length === 0 ? (
        <EmptySurveys hint={t('noSurveysHint')} />
      ) : (
        <ul className="space-y-2">
          {sorted.map((f) => {
            const status = MY_STATUS[f.my];
            const soon = f.closes_at && Date.parse(f.closes_at) - Date.now() < 3 * 86_400_000 && f.state === 'open';
            return (
              <li key={f.id}>
                <Link
                  to={`/f/${f.token}`}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-shadow hover:shadow-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{f.title}</span>
                      {f.state !== 'open' && <LifecycleBadge state={f.state} />}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      {f.state === 'open' && (
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', status.tone)}>
                          <status.icon size={12} />
                          {t(status.label)}
                        </span>
                      )}
                      {f.closes_at && (
                        <span className={cn('inline-flex items-center gap-1', soon ? 'font-medium text-text' : 'text-text-tertiary')}>
                          <CalendarClock size={12} />
                          {t('surveyClosesShort').replace('{date}', formDate(f.closes_at, lang))}
                        </span>
                      )}
                      {f.identity === 'anonymous' && (
                        <span className="inline-flex items-center gap-1 text-text-tertiary">
                          <EyeOff size={12} />
                          {t('identityAnonymous')}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight size={16} className="flex-shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
