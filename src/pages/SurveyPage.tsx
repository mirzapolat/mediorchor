import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Copy,
  Eye,
  Lock,
  Monitor,
  Send,
  Smartphone,
  Trash2,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { NoAccess } from '@/components/NoAccess';
import { LifecycleBadge } from '@/components/Lifecycle';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { Toast, useToast } from '@/components/Toast';
import { FormRenderer } from '@/components/FormRenderer';
import { SurveyBuilder } from '@/components/survey/SurveyBuilder';
import { SurveySettings } from '@/components/survey/SurveySettings';
import { SurveyShare } from '@/components/survey/SurveyShare';
import { SurveyResults } from '@/components/survey/SurveyResults';
import { useProjectContext } from '@/layouts/projectContext';
import { api } from '@/lib/api';
import { channels } from '@/lib/branding';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { STRUCTURE_PROBLEM_KEY, settingsSummary, type FormDetail, type FormSettingsRow } from '@/lib/forms';
import type { Answers, FormStructure } from '@shared/forms';

type Tab = 'questions' | 'settings' | 'share' | 'responses';

const TABS: { id: Tab; label: TranslationKey }[] = [
  { id: 'questions', label: 'surveyTabQuestions' },
  { id: 'settings', label: 'surveyTabSettings' },
  { id: 'share', label: 'surveyTabShare' },
  { id: 'responses', label: 'surveyTabResponses' },
];

// One survey for its managers: build it, set who may answer how, share it
// and read the responses. Publishing says in everyday words what will
// apply; any change to questions after that becomes a new version.
export const SurveyPage = () => {
  const { t, lang } = useI18n();
  const { project, canManage, reloadNav } = useProjectContext();
  const { formId = '' } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const tab = (TABS.find((x) => x.id === search.get('tab'))?.id ?? 'questions') as Tab;
  const [detail, setDetail] = useState<FormDetail | null | undefined>(undefined);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const { data, error: rpcError } = await api.rpc('form_detail', { p_form_id: formId });
    setDetail(rpcError ? null : (data as FormDetail));
  }, [formId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!canManage) return <NoAccess />;
  if (detail === undefined) return <PageSpinner />;
  if (detail === null) return <NoAccess />;

  const { form, state } = detail;
  const base = `/projects/${project.id}/surveys`;

  const setState = async (action: 'unpublish' | 'close' | 'reopen' | 'archive' | 'restore', undo?: 'reopen' | 'close' | 'restore' | 'archive') => {
    setBusy(true);
    const { error: rpcError } = await api.rpc('form_set_state', { p_form_id: form.id, p_action: action });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    await load();
    void reloadNav?.();
    const texts: Record<string, TranslationKey> = {
      unpublish: 'surveyUnpublishedToast',
      close: 'surveyClosedToast',
      reopen: 'surveyReopenedToast',
      archive: 'surveyArchivedToast',
      restore: 'surveyRestoredToast',
    };
    toast.show(t(texts[action]), undo ? () => void setState(undo) : undefined);
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await api.rpc('form_publish', { p_form_id: form.id });
    setBusy(false);
    setPublishing(false);
    if (rpcError) return setError(rpcError.message);
    const result = data as { version: number; new_version: boolean };
    track('survey-publish', { new_version: result.new_version });
    toast.show(
      result.new_version ? t('surveyPublishedNewVersion').replace('{n}', String(result.version)) : t('surveyPublishedToast'),
    );
    await load();
    void reloadNav?.();
  };

  const patchForm = async (patch: Partial<FormSettingsRow>) => {
    setError(null);
    const { error: saveError } = await api.from('forms').update(patch).eq('id', form.id);
    if (saveError) {
      setError(saveError.code === 'identity_locked' ? t('surveyIdentityLocked') : `${t('saveFailed')} (${saveError.message})`);
      return false;
    }
    await load();
    void reloadNav?.();
    return true;
  };

  const duplicate = async () => {
    const { data } = await api.rpc('form_duplicate', { p_form_id: form.id, p_suffix: t('copySuffix') });
    if (data) navigate(`${base}/${(data as { id: string }).id}`);
  };

  const remove = async () => {
    setConfirmDelete(false);
    const { error: deleteError } = await api.from('forms').delete().eq('id', form.id);
    if (deleteError) return setError(deleteError.message);
    void reloadNav?.();
    navigate(base, { replace: true });
  };

  const hasChanges = detail.changes === 'structural' || detail.changes === 'editorial';
  const canPublish = state === 'draft' || hasChanges;
  const more: OverflowMenuItem[] = [
    ...(state === 'open' || state === 'scheduled' ? [{ icon: Lock, label: t('lifecycleClose'), onSelect: () => void setState('close', 'reopen') }] : []),
    ...(state === 'closed' ? [{ icon: Unlock, label: t('lifecycleReopen'), onSelect: () => void setState('reopen', 'close') }] : []),
    ...(state !== 'draft' && state !== 'archived'
      ? [{ icon: Undo2, label: t('lifecycleUnpublish'), onSelect: () => void setState('unpublish', 'reopen') }]
      : []),
    state === 'archived'
      ? { icon: ArchiveRestore, label: t('lifecycleRestore'), onSelect: () => void setState('restore') }
      : { icon: Archive, label: t('lifecycleArchive'), onSelect: () => void setState('archive', 'restore') },
    { icon: Copy, label: t('duplicate'), onSelect: () => void duplicate(), separated: true },
    { icon: Trash2, label: t('deletePermanently'), onSelect: () => setConfirmDelete(true) },
  ];

  return (
    <div className="max-w-5xl space-y-5">
      <Link
        to={base}
        className="hidden items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text md:inline-flex"
      >
        <ArrowLeft size={16} />
        {t('surveys')}
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <TitleInput value={form.title} onSave={(title) => void patchForm({ title })} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
            <LifecycleBadge state={state} />
            {detail.version && <span>{t('surveyVersion').replace('{n}', String(detail.version.number))}</span>}
            {detail.version && hasChanges && (
              <span className="rounded bg-accent/15 px-1.5 py-px font-semibold text-text">{t('surveyUnpublishedChanges')}</span>
            )}
            <span>{t('surveyResponsesCount').replace('{n}', String(detail.responses))}</span>
          </div>
          <p className="mt-1.5 text-sm text-text-secondary">{settingsSummary(form, t, lang)}</p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setPreview(true)}>
            <Eye size={16} />
            {t('lifecyclePreview')}
          </Button>
          {canPublish && state !== 'archived' && (
            <Button onClick={() => setPublishing(true)} disabled={busy}>
              <Send size={16} />
              {state === 'draft' ? t('lifecyclePublish') : t('surveyPublishChanges')}
            </Button>
          )}
          <OverflowMenu label={t('moreActions')} items={more} />
        </div>
      </header>

      {error && <p className="text-sm text-danger">{error}</p>}

      <nav aria-label={t('pageNavigation')} className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-current={tab === x.id ? 'page' : undefined}
            onClick={() => setSearch(x.id === 'questions' ? {} : { tab: x.id }, { replace: true })}
            className={cn(
              '-mb-px flex h-11 flex-shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors',
              tab === x.id ? 'border-black text-text' : 'border-transparent text-text-secondary hover:text-text',
            )}
          >
            {t(x.label)}
            {x.id === 'responses' && detail.responses > 0 && (
              <span className="rounded-full bg-surface-muted px-1.5 text-xs tabular-nums">{detail.responses}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'questions' && (
        <SurveyBuilder
          detail={detail}
          onSaved={(saved) => setDetail((d) => (d ? { ...d, ...saved } : d))}
        />
      )}
      {tab === 'settings' && <SurveySettings detail={detail} onPatch={patchForm} />}
      {tab === 'share' && <SurveyShare detail={detail} onRotated={load} />}
      {tab === 'responses' && <SurveyResults detail={detail} onChanged={load} />}

      <Modal
        open={publishing}
        title={state === 'draft' ? t('lifecyclePublish') : t('surveyPublishChanges')}
        onClose={() => setPublishing(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPublishing(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void publish()} disabled={busy || detail.problems.length > 0}>
              <Send size={16} />
              {t('lifecyclePublish')}
            </Button>
          </>
        }
      >
        {detail.problems.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle size={15} />
              {t('surveyFixFirst')}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
              {detail.problems.map((p, i) => {
                const item = detail.draft.items.find((x) => x.id === p.itemId);
                return (
                  <li key={i}>
                    {item ? `${item.title || t('formUntitled')}: ` : ''}
                    {t(STRUCTURE_PROBLEM_KEY[p.code])}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="rounded-xl bg-surface-subtle px-3 py-2.5 font-medium">{settingsSummary(form, t, lang)}</p>
            <p className="text-text-secondary">
              {detail.changes === 'structural' && detail.version
                ? t('surveyPublishNewVersionHint').replace('{n}', String(detail.version.number + 1))
                : detail.changes === 'editorial'
                  ? t('surveyPublishEditorialHint')
                  : t('surveyPublishFirstHint')}
            </p>
            <p className="text-text-tertiary">{t('surveyPublishSettingsHint')}</p>
          </div>
        )}
      </Modal>

      {preview && <PreviewOverlay structure={detail.draft} form={form} onClose={() => setPreview(false)} />}

      <ConfirmDialog
        open={confirmDelete}
        title={t('deletePermanently')}
        message={t('surveyDeleteConfirm').replace('{name}', form.title).replace('{n}', String(detail.responses))}
        confirmLabel={t('deletePermanently')}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

// The form's title, edited in place (saved when left).
const TitleInput = ({ value, onSave }: { value: string; onSave: (title: string) => void }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      maxLength={200}
      aria-label={t('title')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="-ml-1 w-full rounded-md border border-transparent bg-transparent px-1 text-xl font-bold hover:border-border focus:border-black focus:outline-none sm:text-2xl"
    />
  );
};

// The draft as respondents will see it, on a phone or a desktop width.
// Answers stay in the preview; nothing is sent.
const PreviewOverlay = ({ structure, form, onClose }: { structure: FormStructure; form: FormSettingsRow; onClose: () => void }) => {
  const { t } = useI18n();
  const [device, setDevice] = useState<'mobile' | 'desktop'>('desktop');
  const [answers, setAnswers] = useState<Answers>({});
  const [sent, setSent] = useState(false);
  const accent = structure.settings.accent ? channels(structure.settings.accent) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('lifecyclePreview')} className="fixed inset-0 z-[70] flex flex-col bg-bg">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t('lifecyclePreview')}: {form.title}
        </span>
        <div className="flex rounded-lg bg-surface-muted p-0.5">
          {(['mobile', 'desktop'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              aria-label={d === 'mobile' ? t('surveyPreviewMobile') : t('surveyPreviewDesktop')}
              onClick={() => setDevice(d)}
              className={cn('flex h-8 w-9 items-center justify-center rounded-md', device === d && 'bg-surface shadow-sm')}
            >
              {d === 'mobile' ? <Smartphone size={15} /> : <Monitor size={15} />}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-hover"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div
          className={cn(
            'mx-auto rounded-2xl border border-border bg-surface p-4 shadow-sm transition-[max-width] sm:p-6',
            device === 'mobile' ? 'max-w-[390px]' : 'max-w-2xl',
          )}
          style={accent ? ({ '--c-accent': accent } as React.CSSProperties) : undefined}
        >
          {structure.settings.image_url && (
            <img src={structure.settings.image_url} alt="" className="mb-4 aspect-[3/1] w-full rounded-xl object-cover" />
          )}
          <h1 className="mb-4 text-2xl font-bold">{form.title}</h1>
          {sent ? (
            <div className="space-y-3 py-6 text-center">
              <p className="font-semibold">{t('formThanks')}</p>
              <p className="text-sm text-text-secondary">{structure.settings.confirmation || t('formThanksHint')}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setAnswers({});
                  setSent(false);
                }}
              >
                {t('surveyPreviewAgain')}
              </Button>
            </div>
          ) : (
            <FormRenderer
              key={String(sent)}
              structure={structure}
              answers={answers}
              onAnswers={setAnswers}
              showProgress={form.show_progress}
              review={form.review_before_submit}
              files={{}}
              onSubmit={() => setSent(true)}
              submitLabel={t('surveyPreviewSend')}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
