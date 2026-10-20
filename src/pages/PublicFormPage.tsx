import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  EyeOff,
  Info,
  LinkIcon,
  LockKeyhole,
  LogIn,
  PencilLine,
  ShieldCheck,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { AppLogo } from '@/components/AppLogo';
import { FormRenderer } from '@/components/FormRenderer';
import { ParticipantSummary } from '@/components/FormSummary';
import { LegalFooter, LegalLink } from '@/components/LegalLinks';
import { api } from '@/lib/api';
import { channels } from '@/lib/branding';
import { config } from '@/lib/config';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import {
  clearLocalDraft,
  formDate,
  formUrl,
  loadLocalDraft,
  markSent,
  saveLocalDraft,
  sentBefore,
  uploadFormFile,
  type FormSummary,
  type UploadedFile,
} from '@/lib/forms';
import type { AnswerProblem, Answers, FormIdentity, FormStructure, GuestFieldMode } from '@shared/forms';

interface BaseForm {
  title: string;
  image_url: string | null;
  accent: string | null;
  opens_at: string | null;
  closes_at: string | null;
  identity: FormIdentity;
}

interface OpenForm extends BaseForm {
  structure: FormStructure;
  access: 'members' | 'accounts' | 'guests';
  guest_name: GuestFieldMode;
  guest_email: GuestFieldMode;
  review_before_submit: boolean;
  show_progress: boolean;
  consent_required: boolean;
  consent_text: string;
  results_visibility: 'off' | 'after_submit' | 'after_close';
  one_per_account: boolean;
  allow_edit: boolean;
  guest_edit_link: boolean;
  copy_to: string | null;
}

type FormInfo =
  | { ok: false; state: 'invalid' | 'login_required' | 'not_allowed'; title?: string }
  | { state: 'scheduled'; form: BaseForm }
  | { state: 'closed' | 'answered'; form: BaseForm; summary: FormSummary | null }
  | {
      state: 'open';
      form: OpenForm;
      mode: 'account' | 'guest' | 'invite';
      me: { name: string; email: string } | null;
      invite: { label: string } | null;
      draft: { answers: Answers; page: number } | null;
      editing: { answers: Answers; files: { id: string; item_id: string; file_name: string; size: number }[] } | null;
      summary: FormSummary | null;
    };

interface SubmitResult {
  state: string;
  problems?: Record<string, AnswerProblem>;
  field?: 'name' | 'email';
  confirmation?: string;
  confirmation_url?: string;
  confirmation_url_label?: string;
  edit_token?: string | null;
  summary?: FormSummary | null;
}

// A survey for the people answering it (/f/<token>): no app navigation,
// just the form in its own branding. Who may answer, as whom and what
// happens with the answers is said up front; accounts keep unsent answers
// on the server, guests and anonymous forms in this browser.
export const PublicFormPage = () => {
  const { token = '' } = useParams();
  const [search] = useSearchParams();
  const invite = search.get('i');
  const edit = search.get('e');
  const location = useLocation();
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const [info, setInfo] = useState<FormInfo | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<Record<string, UploadedFile[]>>({});
  const [startPage, setStartPage] = useState(0);
  const [page, setPage] = useState(0);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [copy, setCopy] = useState(true);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState<Record<string, AnswerProblem> | null>(null);
  const [guestProblem, setGuestProblem] = useState<'name' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const opened = useRef(Date.now());
  const loadedFor = useRef<string | null>(null);

  const access = useMemo(() => ({ invite, edit }), [invite, edit]);

  useEffect(() => {
    let cancelled = false;
    void api.rpc('get_form', { p_token: token, p_invite: invite, p_edit: edit }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      const next = (rpcError ? { ok: false, state: 'invalid' } : data) as FormInfo;
      setInfo(next);
      // Answers to start from: the response being changed, the server
      // draft (accounts), or what this browser kept.
      const key = `${token}:${session?.user.id ?? ''}`;
      if (next && 'form' in next && next.state === 'open' && loadedFor.current !== key) {
        loadedFor.current = key;
        if (next.editing) {
          setAnswers(next.editing.answers);
          const byItem: Record<string, UploadedFile[]> = {};
          for (const f of next.editing.files) (byItem[f.item_id] ??= []).push({ id: f.id, name: f.file_name, size: f.size });
          setFiles(byItem);
        } else if (next.draft) {
          setAnswers(next.draft.answers);
          setStartPage(next.draft.page);
        } else if (next.mode !== 'account' || next.form.identity === 'anonymous') {
          const local = loadLocalDraft(token);
          if (local) {
            // Uploaded files aren't kept across visits (their proof is gone).
            const kept = Object.fromEntries(
              Object.entries(local.answers).filter(([id]) => next.form.structure.items.find((i) => i.id === id)?.type !== 'file'),
            );
            setAnswers(kept);
            setStartPage(local.page);
          }
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, invite, edit, session?.user.id]);

  const open = info && 'form' in info && info.state === 'open' ? info : null;
  const serverDrafts = Boolean(open && open.mode === 'account' && !open.editing && open.form.identity !== 'anonymous');

  // Unsent answers are kept while typing (a moment after the last change).
  useEffect(() => {
    if (!open || done || open.editing) return;
    const timer = window.setTimeout(() => {
      const kept = Object.fromEntries(
        Object.entries(answers).filter(([id]) => open.form.structure.items.find((i) => i.id === id)?.type !== 'file'),
      );
      if (Object.keys(kept).length === 0) return;
      if (serverDrafts) {
        void api.rpc('save_form_draft', { p_token: token, p_answers: kept, p_page: page }).then(({ error: saveError }) => {
          if (!saveError) setDraftSaved(true);
        });
      } else {
        saveLocalDraft(token, kept, page);
        setDraftSaved(true);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [answers, page, open, done, serverDrafts, token]);

  const onUpload = useCallback(
    async (itemId: string, file: File, onProgress: (share: number) => void) => {
      const result = await uploadFormFile(token, itemId, file, access, onProgress);
      if (!result.file) {
        return result.code === 'file_type' ? t('formFileWrongType') : result.code === 'file_size' ? t('formFileTooLargeShort') : t('uploadFailed');
      }
      const uploaded = result.file;
      setFiles((all) => ({ ...all, [itemId]: [...(all[itemId] ?? []), uploaded] }));
      setAnswers((a) => ({ ...a, [itemId]: [...((a[itemId] as string[] | undefined) ?? []), uploaded.id] }));
      return null;
    },
    [token, access, t],
  );

  const onRemoveFile = (itemId: string, fileId: string) => {
    setFiles((all) => ({ ...all, [itemId]: (all[itemId] ?? []).filter((f) => f.id !== fileId) }));
    setAnswers((a) => ({ ...a, [itemId]: ((a[itemId] as string[] | undefined) ?? []).filter((id) => id !== fileId) }));
  };

  if (!info) return <PageSpinner />;

  const form = 'form' in info ? info.form : null;
  const accent = form?.accent && /^#[0-9a-f]{6}$/i.test(form.accent) ? channels(form.accent) : null;
  const shellStyle = accent ? ({ '--c-accent': accent, '--c-tint': accent } as CSSProperties) : undefined;
  const title = form?.title ?? ('title' in info ? info.title : undefined) ?? t('formTitleFallback');

  const asksName = open && open.mode === 'guest' && !open.editing && open.form.identity !== 'anonymous' && open.form.guest_name !== 'off';
  const asksEmail = open && open.mode === 'guest' && !open.editing && open.form.identity !== 'anonymous' && open.form.guest_email !== 'off';
  const extrasValid = Boolean(
    open &&
      (!asksName || open.form.guest_name !== 'required' || guestName.trim()) &&
      (!asksEmail || open.form.guest_email !== 'required' || guestEmail.trim()) &&
      (!open.form.consent_required || consent),
  );

  const submit = async () => {
    if (!open) return;
    setSubmitting(true);
    setError(null);
    setGuestProblem(null);
    const secrets = Object.fromEntries(
      Object.values(files)
        .flat()
        .filter((f) => f.secret)
        .map((f) => [f.id, f.secret]),
    );
    const { data, error: rpcError } = await api.rpc('submit_form', {
      p_token: token,
      p_invite: invite,
      p_edit: edit,
      p_answers: answers,
      p_files: secrets,
      p_guest_name: guestName,
      p_guest_email: guestEmail,
      p_consent: consent,
      p_copy: copy,
      p_elapsed_ms: Date.now() - opened.current,
      p_website: website,
    });
    setSubmitting(false);
    if (rpcError) return setError(rpcError.status === 429 ? t('formTooManyRequests') : t('formSubmitError'));
    const result = data as SubmitResult;
    if (result.state === 'success') {
      clearLocalDraft(token);
      if (open.mode !== 'account') markSent(token);
      track('form-submit', { mode: open.mode, identity: open.form.identity, edited: Boolean(open.editing) });
      setDone(result);
      window.scrollTo({ top: 0 });
    } else if (result.state === 'invalid_answers') {
      setProblems(result.problems ?? {});
      setError(t('formFixProblems'));
    } else if (result.state === 'invalid_guest') {
      setGuestProblem(result.field ?? 'name');
    } else if (result.state === 'consent_required') {
      setError(t('formConsentMissing'));
    } else if (result.state === 'invalid_files') {
      setError(t('formFilesInvalid'));
    } else if (result.state === 'answered') {
      setInfo({ state: 'answered', form: open.form, summary: null });
    } else if (result.state === 'closed' || result.state === 'scheduled') {
      setInfo({ state: 'closed', form: open.form, summary: null });
    } else {
      setError(t('formSubmitError'));
    }
  };

  let body: ReactNode;
  if (done) {
    body = (
      <Done
        result={done}
        editUrl={done.edit_token ? formUrl(token, { e: done.edit_token }) : null}
        canEditAgain={Boolean(open?.form.allow_edit && open.mode === 'account')}
      />
    );
  } else if (!('form' in info)) {
    body =
      info.state === 'login_required' ? (
        <Notice icon={LockKeyhole} title={t('formLoginRequired')} text={t('formLoginRequiredHint')}>
          <Link to="/login" state={{ from: location.pathname + location.search }}>
            <Button className="mt-4">
              <LogIn size={16} />
              {t('signIn')}
            </Button>
          </Link>
        </Notice>
      ) : info.state === 'not_allowed' ? (
        <Notice icon={LockKeyhole} title={t('formNotAllowed')} text={t('formNotAllowedHint')} />
      ) : (
        <Notice icon={LinkIcon} title={t('formInvalid')} text={t('formInvalidHint')} />
      );
  } else if (info.state === 'scheduled') {
    body = (
      <Notice
        icon={CalendarClock}
        title={t('formScheduled')}
        text={info.form.opens_at ? t('formOpensAt').replace('{date}', formDate(info.form.opens_at, lang)) : undefined}
      />
    );
  } else if (info.state === 'closed' || info.state === 'answered') {
    body = (
      <div className="space-y-6">
        <Notice
          icon={info.state === 'closed' ? LockKeyhole : CheckCircle2}
          title={info.state === 'closed' ? t('formClosed') : t('formAlreadyAnswered')}
          text={info.state === 'closed' ? t('formClosedHint') : t('formAlreadyAnsweredHint')}
        />
        {info.summary && <ParticipantSummary summary={info.summary} />}
      </div>
    );
  } else {
    const o = open!;
    const guestHint = o.mode === 'guest' && !o.editing && sentBefore(token);
    body = (
      <div className="space-y-5">
        <AboutForm form={o.form} mode={o.mode} me={o.me} editing={Boolean(o.editing)} />
        {guestHint && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">{t('formSentBeforeHint')}</p>}
        {/* Left empty by people; filled in by bots. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
        <FormRenderer
          structure={o.form.structure}
          answers={answers}
          onAnswers={(next) => {
            setAnswers(next);
            setDraftSaved(false);
          }}
          startPage={startPage}
          onPageChange={setPage}
          showProgress={o.form.show_progress}
          review={o.form.review_before_submit}
          files={files}
          onUpload={onUpload}
          onRemoveFile={onRemoveFile}
          serverProblems={problems}
          submitting={submitting}
          submitLabel={o.editing ? t('formSaveChanges') : undefined}
          extrasValid={extrasValid}
          extras={
            <div className="space-y-4 rounded-2xl border border-border bg-surface-subtle p-4">
              {asksName && (
                <Input
                  label={`${t('formYourName')}${o.form.guest_name === 'optional' ? ` (${t('optional')})` : ''}`}
                  value={guestName}
                  maxLength={200}
                  autoComplete="name"
                  onChange={(e) => setGuestName(e.target.value)}
                />
              )}
              {guestProblem === 'name' && <p className="-mt-2 text-sm text-danger">{t('formErrorRequired')}</p>}
              {asksEmail && (
                <Input
                  type="email"
                  label={`${t('email')}${o.form.guest_email === 'optional' ? ` (${t('optional')})` : ''}`}
                  value={guestEmail}
                  maxLength={254}
                  autoComplete="email"
                  onChange={(e) => setGuestEmail(e.target.value)}
                />
              )}
              {guestProblem === 'email' && <p className="-mt-2 text-sm text-danger">{t('formErrorEmail')}</p>}
              {o.form.copy_to && (
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="mt-0.5 h-4 w-4 accent-accent" />
                  <span>{t('formCopyTo').replace('{email}', o.form.copy_to)}</span>
                </label>
              )}
              {o.form.consent_required && (
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span>
                    {o.form.consent_text || t('formConsentDefault')}{' '}
                    <LegalLink kind="privacy" className="font-medium underline underline-offset-2" />
                  </span>
                </label>
              )}
              {!asksName && !asksEmail && !o.form.copy_to && !o.form.consent_required && (
                <p className="text-sm text-text-secondary">{t('formReadyToSend')}</p>
              )}
            </div>
          }
          onSubmit={() => void submit()}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <p className="text-xs text-text-tertiary" aria-live="polite">
          {draftSaved ? (serverDrafts ? t('formDraftSavedServer') : t('formDraftSavedLocal')) : ' '}
        </p>
      </div>
    );
  }

  return (
    <main className="relative min-h-full overflow-hidden" style={shellStyle}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-tint/10 to-transparent" />
      <div className="relative mx-auto w-full max-w-2xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">
        <header className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold text-text-secondary">
          <AppLogo className="h-6 w-6" />
          {config.appName}
        </header>
        {form?.image_url && (
          <img src={form.image_url} alt="" className="mb-6 aspect-[3/1] w-full rounded-2xl border border-border object-cover" />
        )}
        <h1 className="mb-6 break-words text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">{body}</section>
        <LegalFooter className="mt-10" />
      </div>
    </main>
  );
};

// Identity, who sees the answers, editing, results and the deadline — said
// before anyone answers.
const AboutForm = ({
  form,
  mode,
  me,
  editing,
}: {
  form: OpenForm;
  mode: 'account' | 'guest' | 'invite';
  me: { name: string; email: string } | null;
  editing: boolean;
}) => {
  const { t, lang } = useI18n();
  const facts: { icon: LucideIcon; text: string }[] = [
    {
      icon: form.identity === 'anonymous' ? EyeOff : form.identity === 'confidential' ? ShieldCheck : UserRound,
      text:
        form.identity === 'anonymous'
          ? t('formAboutAnonymous')
          : form.identity === 'confidential'
            ? t('formAboutConfidential')
            : mode === 'account' && me
              ? t('formAboutNamedAccount').replace('{name}', me.name || me.email)
              : t('formAboutNamed'),
    },
    { icon: UsersRound, text: t('formAboutRecipients') },
    {
      icon: PencilLine,
      text: editing
        ? t('formAboutEditing')
        : form.allow_edit && mode === 'account'
          ? t('formAboutEditable')
          : form.guest_edit_link && mode === 'guest'
            ? t('formAboutEditLink')
            : t('formAboutFinal'),
    },
  ];
  if (form.results_visibility !== 'off') {
    facts.push({ icon: Info, text: form.results_visibility === 'after_submit' ? t('formAboutResultsSubmit') : t('formAboutResultsClose') });
  }
  if (form.closes_at) facts.push({ icon: CalendarClock, text: t('formAboutCloses').replace('{date}', formDate(form.closes_at, lang)) });
  return (
    <ul className="space-y-1.5 rounded-xl bg-surface-subtle px-3 py-2.5 text-sm text-text-secondary">
      {facts.map((f) => (
        <li key={f.text} className="flex items-start gap-2">
          <f.icon size={15} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
};

// After sending: the form's own words, its link, a guest's edit link and
// the summary when there is one.
const Done = ({ result, editUrl, canEditAgain }: { result: SubmitResult; editUrl: string | null; canEditAgain: boolean }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-6">
      <Notice icon={CheckCircle2} title={t('formThanks')} text={result.confirmation || t('formThanksHint')}>
        {result.confirmation_url && (
          <a href={result.confirmation_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block">
            <Button variant="secondary">{result.confirmation_url_label || t('formContinueLink')}</Button>
          </a>
        )}
      </Notice>
      {canEditAgain && <p className="text-center text-sm text-text-secondary">{t('formEditLaterAccount')}</p>}
      {editUrl && (
        <div className="space-y-2 rounded-2xl border border-accent/50 bg-accent/10 p-4">
          <p className="text-sm font-medium">{t('formEditLinkTitle')}</p>
          <p className="text-xs text-text-secondary">{t('formEditLinkHint')}</p>
          <div className="flex gap-2">
            <input readOnly value={editUrl} aria-label={t('formEditLinkTitle')} className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs" />
            <Button
              variant="secondary"
              className="h-9 flex-shrink-0 px-3"
              onClick={() => {
                void navigator.clipboard?.writeText(editUrl).then(() => setCopied(true));
              }}
            >
              <Copy size={14} />
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
        </div>
      )}
      {result.summary && <ParticipantSummary summary={result.summary} />}
    </div>
  );
};

const Notice = ({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text?: string; children?: ReactNode }) => (
  <div className="py-4 text-center">
    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted">
      <Icon size={22} className="text-text-secondary" />
    </span>
    <p className="mt-3 font-semibold">{title}</p>
    {text && <p className="mx-auto mt-1 max-w-md whitespace-pre-line text-sm text-text-secondary">{text}</p>}
    {children}
  </div>
);
